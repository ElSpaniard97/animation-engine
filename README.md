# Animation Engine

Independent local AI video and artwork animation workspace. No Runway connection, cloud generation API, or account required.

## Run the editor

Node.js 20+:

```sh
npm run dev
```

Open http://127.0.0.1:5173. Upload an image to begin. The local checkout includes sample artwork excluded from Git.

## Install the local GPU engine

Python 3.12 and Apple Silicon with Metal, or an NVIDIA GPU with CUDA:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r engine/requirements.txt
npm run dev
```

Enter a prompt, choose text-to-video or current-image-to-video, and click Generate on my GPU. The first generation downloads the Lightricks/LTX-Video model into `.models/`; allow roughly 27 GB for the initial model weights and substantial download time. Subsequent generations reuse that cache. Inference is local. The server listens only on loopback, validates request origin, and runs one GPU job at a time. Jobs and generated MP4s are saved under `.jobs/`. Cancel stops the worker. Generation status is held in memory; restart clears the job list, while files remain on disk.

The current checkout already has its isolated Python environment installed. It uses PyTorch's MPS backend on the M4 Mac. The text encoder runs on CPU and is released before GPU denoising to reduce memory pressure. Preview presets are intentionally small (256×448, 448×256, or 448×448; 9, 25, or 49 frames at 24 fps). Generation performance and quality depend on hardware and model; this is an initial application, not feature parity with Runway.

## Editor features

- Image import; six camera movements; embers, snow, rain and mist.
- Portrait, landscape and square formats; 5–15 second animated image shots.
- Live preview, playback and scrubbing; titles and vignette.
- WebM export using browser MediaRecorder; silent, 30 fps, real-time recording.
- Download and reopen self-contained JSON image projects.
- Generated MP4 playback in the editor and direct MP4 download.

Image projects save their artwork and settings. Generated video projects do not yet support JSON saving; download their MP4 instead. WebM export records a short source clip repeatedly for the selected edit duration. Chrome or Edge provides the broadest export support.

## Verification

```sh
npm run check
.venv/bin/python -m py_compile engine/generate.py
```

JavaScript and Python syntax checked; local HTTP response, playback, camera/effect controls, and GPU availability checked. The editor completed its browser WebM export. Full AI inference remains pending the initial model download.

## Model documentation

- https://github.com/Lightricks/LTX-Video
- https://huggingface.co/docs/diffusers/api/pipelines/ltx_video
- https://huggingface.co/Lightricks/LTX-Video (model license and weights)

Model weights, private artwork, jobs, and environments are excluded from Git.
