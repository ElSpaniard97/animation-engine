# Animation Engine

Independent local AI video and artwork animation workspace. No Runway connection, cloud generation API, or account required.

## Launch the Mac application

The installed local application is `mac-build/Animation Engine-darwin-arm64/Animation Engine.app`. Double-click it in Finder. It opens its own desktop window and starts the local server when needed. You can drag the app into the Dock for convenient access.

Keep this project folder in place: the Mac launcher uses its local Python environment, downloaded model weights, and output folders. The built application records this checkout location in a local `workspace.json` file. Rebuild after moving the checkout. The build is unsigned and intended for this laptop, not distribution.

To build the launcher on another Mac:

```sh
npm ci
npm run build:mac
```

To run the desktop window directly from the source:

```sh
npm start
```

## Run the browser editor

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

Enter a prompt, choose text-to-video or current-image-to-video, and click Generate on my GPU. The first generation downloads the Lightricks/LTX-Video model into `.models/`; allow roughly 27 GB for the initial model weights and substantial download time. Subsequent generations reuse that cache. Inference is local. The server listens only on loopback, validates request origin, and runs one GPU job at a time. Jobs and generated MP4s are saved under `.jobs/`, one folder per job, and Cancel stops the worker. Every generation appears in the Generations gallery under the timeline, including after a restart. A finished generation is added to the timeline as a new shot. From the gallery you can put a clip in the selected shot, add it as another shot, reuse its prompt and settings, or delete it along with its files.

The model stays loaded between generations, so only the first one after starting the app pays the loading cost. Re-running a prompt with a new seed also skips prompt encoding. Quality picks the number of denoising steps (Draft 12, Standard 20, High 32), and generation time grows roughly in step with it. Under Advanced, Prompt strength sets the guidance scale (default 3) and Avoid sets the negative prompt. The dice button picks a random seed, and Reuse in the gallery restores all of these. The model is unloaded after 10 idle minutes to give memory back; set `ANIMATION_ENGINE_IDLE_MINUTES` to change that. `ANIMATION_ENGINE_PORT` runs the server on a port other than 5173. To run a single job outside the app, use `.venv/bin/python engine/generate.py .jobs/<id>/job.json`.

The current checkout already has its isolated Python environment installed. It uses PyTorch's MPS backend on the M4 Mac. The whole model, text encoder included, runs on the GPU while loaded. Preview presets are intentionally small (256×448, 448×256, or 448×448; 9, 25, or 49 frames at 24 fps). Generation performance and quality depend on hardware and model; this is an initial application, not feature parity with Runway.

## Editor features

- A timeline of shots played back to back: add, reorder and delete shots, each with its own artwork or generated clip, camera, atmosphere, length (2–15 seconds) and title.
- Image import; six camera movements; embers, snow, rain and mist.
- Portrait, landscape and square formats for the whole video.
- Live preview, playback and scrubbing; titles and vignette.
- MP4 export (H.264 where the browser supports it, otherwise VP9), rendered frame by frame with WebCodecs, so it's exact and usually faster than real time. It's silent and 30 fps. Browsers without WebCodecs fall back to real-time WebM recording.
- Download and reopen JSON projects with every shot.
- Generated MP4 playback in the editor and direct MP4 download.
- A gallery of past generations that survives restarts, with use in a shot, add as a shot, reuse settings and delete.

Projects embed image artwork, but only link to generated clips, which stay in `.jobs/`; deleting a generation removes it from projects that use it. A generated clip shorter than its shot loops. Projects saved before the timeline open as a single shot. Chrome or Edge provides the broadest export support.

## Development

```sh
npm ci              # once: installs Electron, the packager and Prettier
npm test            # unit tests and server tests with a stand-in GPU worker
npm run check       # syntax check
npm run format      # Prettier
.venv/bin/python -m py_compile engine/*.py
```

The tests need no GPU or Python: `test/fixtures/fake-worker.mjs` speaks the same progress protocol as `engine/generate.py`.

Code layout:

- `server.mjs`: starts the local server on 127.0.0.1:5173.
- `server/`: request routing and host/origin checks (`app.mjs`), the one-at-a-time GPU job runner (`jobs.mjs`), request validation (`validate.mjs`), and JSON and byte-range file helpers (`http.mjs`).
- `engine/ltx_engine.py`: loads LTX-Video and renders a job. `engine/worker.py` keeps it loaded and takes jobs from the server (`server/worker.mjs`), and `engine/generate.py` runs one job from the command line.
- `public/js/`: the editor. `main.js` holds state and wires the controls, `shots.js` does the timeline math, `renderer.js` draws frames, `project.js` saves and opens projects, `ai.js` runs the generation panel, and `export.js` renders MP4 (with `public/vendor/mp4-muxer`) or records WebM.
- `desktop.cjs` and `scripts/build-mac.mjs`: the Mac app.

Local text-to-video inference succeeded on the M4 GPU: the MP4 decoded correctly at 448×256, 24 fps, 9 frames. Longer clips and image-to-video inference remain unverified.

## Model documentation

- https://github.com/Lightricks/LTX-Video
- https://huggingface.co/docs/diffusers/api/pipelines/ltx_video
- https://huggingface.co/Lightricks/LTX-Video (model license and weights)

Model weights, private artwork, jobs, and environments are excluded from Git.
