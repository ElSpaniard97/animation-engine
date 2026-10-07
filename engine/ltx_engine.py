"""LTX-Video on the local GPU, loaded once and reused across generations."""
import gc
import os
import time
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault('HF_HOME', str(ROOT / '.models'))
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')

MODEL = 'Lightricks/LTX-Video'
NEGATIVE_PROMPT = 'blurry, distorted, low quality'
FPS = 24
PROMPT_CACHE_SIZE = 16


class Cancelled(Exception):
    pass


class Engine:
    """Holds the LTX pipelines. `progress(stage, step, total)` reports what it is doing.

    The text encoder (T5, the largest part) stays on the CPU and runs only for prompts it hasn't
    seen; the transformer and VAE stay on the GPU. Re-running a prompt with a new seed skips
    encoding entirely.
    """

    def __init__(self, progress):
        self.progress = progress
        self.loaded = False
        self.embeddings = OrderedDict()
        self.timings = {}

    def load(self):
        if self.loaded:
            return
        started = time.monotonic()
        self.progress('Loading local runtime')
        import torch
        from diffusers import LTXImageToVideoPipeline, LTXPipeline

        self.torch = torch
        if torch.backends.mps.is_available():
            self.device = 'mps'
        elif torch.cuda.is_available():
            self.device = 'cuda'
        else:
            raise RuntimeError('No supported GPU found. Apple Metal or NVIDIA CUDA is required.')
        self.progress('Loading model weights (first run downloads them)')
        self.encoder = LTXPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16)
        self.progress('Moving model to the GPU')
        self.encoder.transformer.to(self.device)
        self.encoder.vae.to(self.device)
        self.encoder.vae.enable_tiling()
        # Generation pipelines share the GPU modules but have no text encoder, so diffusers runs
        # them on the GPU rather than on the CPU where the encoder lives.
        parts = {**self.encoder.components, 'text_encoder': None}
        self.text_to_video = LTXPipeline(**parts)
        self.image_to_video = LTXImageToVideoPipeline(**parts)
        self.loaded = True
        self.timings['load'] = time.monotonic() - started

    def encode(self, prompt):
        """Prompt embeddings on the CPU, cached so seed variations skip the text encoder."""
        if prompt in self.embeddings:
            self.embeddings.move_to_end(prompt)
            return self.embeddings[prompt]
        self.progress('Encoding prompt')
        with self.torch.inference_mode():
            embeddings = self.encoder.encode_prompt(
                prompt=prompt,
                negative_prompt=NEGATIVE_PROMPT,
                do_classifier_free_guidance=True,
                device=self.torch.device('cpu'),
                max_sequence_length=128,
            )
        self.embeddings[prompt] = embeddings
        if len(self.embeddings) > PROMPT_CACHE_SIZE:
            self.embeddings.popitem(last=False)
        return embeddings

    def generate(self, job, should_cancel=lambda: False):
        """Renders one job to job['output_path']. Raises Cancelled if should_cancel() turns true."""
        from diffusers.utils import export_to_video
        from PIL import Image, ImageOps

        self.load()
        timings = {}
        started = time.monotonic()
        prompt_embeds, prompt_mask, negative_embeds, negative_mask = self.encode(job['prompt'])
        timings['encode'] = time.monotonic() - started

        def callback(pipeline, step, timestep, kwargs):
            if should_cancel():
                raise Cancelled()
            self.progress('Generating frames', step + 1, job['steps'])
            return kwargs

        device = self.device
        args = dict(
            prompt_embeds=prompt_embeds.to(device),
            prompt_attention_mask=prompt_mask.to(device),
            negative_prompt_embeds=negative_embeds.to(device),
            negative_prompt_attention_mask=negative_mask.to(device),
            width=job['width'],
            height=job['height'],
            num_frames=job['frames'],
            frame_rate=FPS,
            num_inference_steps=job['steps'],
            guidance_scale=3.0,
            generator=self.torch.Generator(device='cpu').manual_seed(job['seed']),
            callback_on_step_end=callback,
        )
        pipe = self.text_to_video
        if job.get('image_path'):
            pipe = self.image_to_video
            # Crop to the target aspect like the editor preview instead of stretching.
            image = Image.open(job['image_path']).convert('RGB')
            args['image'] = ImageOps.fit(image, (job['width'], job['height']), Image.LANCZOS)
        started = time.monotonic()
        try:
            frames = pipe(**args).frames[0]
        finally:
            gc.collect()
            if device == 'mps':
                self.torch.mps.empty_cache()
        timings['generate'] = time.monotonic() - started
        started = time.monotonic()
        self.progress('Encoding MP4')
        export_to_video(frames, job['output_path'], fps=FPS)
        timings['export'] = time.monotonic() - started
        return timings
