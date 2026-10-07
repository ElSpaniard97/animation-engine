"""Local LTX worker. One process per job releases GPU memory after completion."""
import json, sys, os, gc
from pathlib import Path
root = Path(__file__).resolve().parents[1]
os.environ.setdefault('HF_HOME', str(root / '.models'))
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')
job_path = Path(sys.argv[1])
job = json.loads(job_path.read_text())
def progress(stage, step=None, total=None):
    print(json.dumps({'stage': stage, 'step': step, 'total': total}), flush=True)
try:
    progress('Loading local runtime')
    import torch
    from diffusers import LTXPipeline, LTXImageToVideoPipeline
    from diffusers.utils import export_to_video
    from PIL import Image
    device = 'mps' if torch.backends.mps.is_available() else ('cuda' if torch.cuda.is_available() else None)
    if not device:
        raise RuntimeError('No supported GPU found. Apple Metal or NVIDIA CUDA is required.')
    dtype = torch.bfloat16
    progress('Loading model weights (first run downloads them)')
    klass = LTXImageToVideoPipeline if job.get('image_path') else LTXPipeline
    pipe = klass.from_pretrained('Lightricks/LTX-Video', torch_dtype=dtype)
    # Encode text on the CPU and release the large encoder before GPU denoising.
    progress('Encoding prompt')
    with torch.inference_mode():
        prompt_embeds, prompt_attention_mask, negative_prompt_embeds, negative_prompt_attention_mask = pipe.encode_prompt(
            prompt=job['prompt'], negative_prompt='blurry, distorted, low quality', do_classifier_free_guidance=True,
            device=torch.device('cpu'), max_sequence_length=128)
    pipe.text_encoder = None
    gc.collect()
    pipe.to(device)
    pipe.vae.enable_tiling()
    def callback(pipeline, step, timestep, kwargs):
        progress('Generating frames', step + 1, job['steps'])
        return kwargs
    args = dict(prompt_embeds=prompt_embeds.to(device), prompt_attention_mask=prompt_attention_mask.to(device),
        negative_prompt_embeds=negative_prompt_embeds.to(device), negative_prompt_attention_mask=negative_prompt_attention_mask.to(device),
        width=job['width'], height=job['height'], num_frames=job['frames'], frame_rate=24, num_inference_steps=job['steps'],
        guidance_scale=3.0, generator=torch.Generator(device='cpu').manual_seed(job['seed']),
        callback_on_step_end=callback)
    if job.get('image_path'):
        args['image'] = Image.open(job['image_path']).convert('RGB').resize((job['width'], job['height']))
    frames = pipe(**args).frames[0]
    progress('Encoding MP4')
    export_to_video(frames, job['output_path'], fps=24)
    progress('Complete')
except Exception as exc:
    progress('Failed: ' + str(exc))
    sys.exit(1)
