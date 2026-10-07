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
    """Holds the LTX pipelines on the GPU. `progress(stage, step, total)` reports what it is doing.

    Everything, including the T5 text encoder, lives on the GPU: on an M4 that encodes a prompt in
    about 2 s instead of about 22 s on the CPU, at the cost of holding about 14 GB while loaded
    (the app unloads the worker when idle). Prompt embeddings are cached, so re-running a prompt
    with a new seed skips encoding entirely.
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
        self.text_to_video = LTXPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16)
        self.progress('Moving model to the GPU')
        self.text_to_video.to(self.device)
        self.text_to_video.vae.enable_tiling()
        # Shares the same modules, so image-to-video costs no extra memory.
        self.image_to_video = LTXImageToVideoPipeline(**self.text_to_video.components)
        self.loaded = True
        self.timings['load'] = time.monotonic() - started

    def sync(self):
        """Waits for queued GPU work. MPS runs asynchronously, so without this, step progress
        races ahead and the real time shows up later as a long 'Encoding MP4'."""
        if self.device == 'mps':
            self.torch.mps.synchronize()
        elif self.device == 'cuda':
            self.torch.cuda.synchronize()

    def encode(self, prompt):
        """Prompt embeddings, kept on the CPU in a small cache so seed variations skip encoding."""
        if prompt in self.embeddings:
            self.embeddings.move_to_end(prompt)
            return self.embeddings[prompt]
        self.progress('Encoding prompt')
        with self.torch.inference_mode():
            embeddings = self.text_to_video.encode_prompt(
                prompt=prompt,
                negative_prompt=NEGATIVE_PROMPT,
                do_classifier_free_guidance=True,
                device=self.torch.device(self.device),
                max_sequence_length=128,
            )
        embeddings = tuple(tensor.cpu() for tensor in embeddings)
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
            self.sync()
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
