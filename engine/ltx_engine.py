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
# LTX-Video 0.9.8, 2B parameters, distilled to 8 steps without guidance. It animates still images
# far better than the original 0.9 release and is faster. One ~6 GB file holds the transformer and
# VAE; the T5 text encoder is shared with the original model, so it isn't downloaded again.
DISTILLED_FILE = 'ltxv-2b-0.9.8-distilled.safetensors'
DISTILLED_TIMESTEPS = [1000, 993, 987, 981, 975, 909, 725, 0.03]
# 'distilled' (default) or 'classic' for the original 0.9 model with quality, guidance and Avoid.
MODEL_KIND = os.environ.get('ANIMATION_ENGINE_MODEL', 'distilled')
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
        if MODEL_KIND == 'classic':
            self.text_to_video = LTXPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16)
            # Shares the same modules, so image-to-video costs no extra memory.
            self.image_to_video = LTXImageToVideoPipeline(**self.text_to_video.components)
        else:
            self.text_to_video = self.image_to_video = load_distilled(torch)
        self.progress('Moving model to the GPU')
        self.text_to_video.to(self.device)
        self.text_to_video.vae.enable_tiling()
        self.loaded = True
        self.timings['load'] = time.monotonic() - started

    def sync(self):
        """Waits for queued GPU work. MPS runs asynchronously, so without this, step progress
        races ahead and the real time shows up later as a long 'Encoding MP4'."""
        if self.device == 'mps':
            self.torch.mps.synchronize()
        elif self.device == 'cuda':
            self.torch.cuda.synchronize()

    def encode(self, prompt, negative_prompt):
        """Prompt embeddings, kept on the CPU in a small cache so seed variations skip encoding."""
        key = (prompt, negative_prompt)
        if key in self.embeddings:
            self.embeddings.move_to_end(key)
            return self.embeddings[key]
        self.progress('Encoding prompt')
        with self.torch.inference_mode():
            embeddings = self.text_to_video.encode_prompt(
                prompt=prompt,
                negative_prompt=negative_prompt,
                do_classifier_free_guidance=MODEL_KIND == 'classic',
                device=self.torch.device(self.device),
                max_sequence_length=128,
            )
        embeddings = tuple(None if tensor is None else tensor.cpu() for tensor in embeddings)
        self.embeddings[key] = embeddings
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
        prompt_embeds, prompt_mask, negative_embeds, negative_mask = self.encode(
            job['prompt'], job.get('negative_prompt', NEGATIVE_PROMPT)
        )
        timings['encode'] = time.monotonic() - started

        total = job['steps'] if MODEL_KIND == 'classic' else len(DISTILLED_TIMESTEPS)

        def callback(pipeline, step, timestep, kwargs):
            self.sync()
            if should_cancel():
                raise Cancelled()
            self.progress('Generating frames', step + 1, total)
            return kwargs

        device = self.device
        args = dict(
            prompt_embeds=prompt_embeds.to(device),
            prompt_attention_mask=prompt_mask.to(device),
            width=job['width'],
            height=job['height'],
            num_frames=job['frames'],
            frame_rate=FPS,
            generator=self.torch.Generator(device='cpu').manual_seed(job['seed']),
            callback_on_step_end=callback,
        )
        if MODEL_KIND == 'classic':
            args.update(
                negative_prompt_embeds=negative_embeds.to(device),
                negative_prompt_attention_mask=negative_mask.to(device),
                num_inference_steps=job['steps'],
                guidance_scale=job.get('guidance', 3.0),
            )
        else:
            # The distilled model's own schedule; quality, guidance and Avoid don't apply to it.
            args.update(
                timesteps=DISTILLED_TIMESTEPS,
                guidance_scale=1.0,
                decode_timestep=0.05,
                decode_noise_scale=0.025,
                image_cond_noise_scale=0.0,
            )
        pipe = self.text_to_video
        if job.get('image_path'):
            pipe = self.image_to_video
            paths = [job['image_path'], *job.get('keyframe_paths', [])]
            if MODEL_KIND == 'classic':
                paths = paths[:1]  # The original pipeline takes one starting image.
            # Crop to the target aspect like the editor preview instead of stretching.
            size = (job['width'], job['height'])
            images = [ImageOps.fit(Image.open(path).convert('RGB'), size, Image.LANCZOS) for path in paths]
            if len(images) == 1:
                args['image'] = images[0]
            else:
                args['image'] = images
                args['frame_index'] = keyframe_indices(len(images), job['frames'])
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


def keyframe_indices(count, frames):
    """Frames where `count` keyframe images go: the first at the start, the last at the end, the
    rest evenly between, each on an 8-frame boundary (one latent frame) as LTX-Video needs."""
    steps = (frames - 1) // 8
    return [round(i * steps / (count - 1)) * 8 for i in range(count)]


def distilled_checkpoint():
    """Local path of the distilled checkpoint, downloading it into .models on first use."""
    from huggingface_hub import hf_hub_download

    return hf_hub_download(MODEL, DISTILLED_FILE)


def load_distilled(torch):
    """LTXConditionPipeline for the distilled 0.9.8 model, reusing the original model's text encoder."""
    from diffusers import (
        AutoencoderKLLTXVideo,
        FlowMatchEulerDiscreteScheduler,
        LTXConditionPipeline,
        LTXVideoTransformer3DModel,
    )
    from safetensors.torch import load_file
    from transformers import T5EncoderModel, T5Tokenizer

    checkpoint = load_file(distilled_checkpoint())
    transformer = LTXVideoTransformer3DModel.from_single_file(checkpoint, torch_dtype=torch.bfloat16)
    vae = AutoencoderKLLTXVideo.from_single_file(checkpoint, torch_dtype=torch.bfloat16)
    del checkpoint
    return LTXConditionPipeline(
        # Default flow-matching settings, so the distilled timesteps are used exactly as trained.
        scheduler=FlowMatchEulerDiscreteScheduler(),
        vae=vae,
        text_encoder=T5EncoderModel.from_pretrained(MODEL, subfolder='text_encoder', torch_dtype=torch.bfloat16),
        tokenizer=T5Tokenizer.from_pretrained(MODEL, subfolder='tokenizer'),  # The slow one needs no protobuf.
        transformer=transformer,
    )
