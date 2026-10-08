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

Open http://127.0.0.1:5173. If another program already uses port 5173, the server takes the next free port and prints the address it chose; the desktop app finds it on its own. Upload an image to begin. The local checkout includes sample artwork excluded from Git.

## Install the local GPU engine

Python 3.12 and Apple Silicon with Metal, or an NVIDIA GPU with CUDA:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r engine/requirements.txt
npm run dev
```

Enter a prompt, choose text-to-video or current-image-to-video, and click Generate on my GPU. The first generation downloads the model into `.models/`: the T5 text encoder from Lightricks/LTX-Video plus the 2B distilled LTX-Video 0.9.8 checkpoint (about 6 GB). Allow roughly 30 GB and substantial download time. The distilled model animates still images far better than the original 0.9 release and runs a fixed 8-step schedule, so it is several times faster; Quality and the Advanced settings are hidden while it is in use. Set `ANIMATION_ENGINE_MODEL=classic` to go back to the original 0.9 model, which brings them back. Subsequent generations reuse that cache. Inference is local. The server listens only on loopback, validates request origin, and runs one GPU job at a time. You can keep pressing Generate while a job runs: up to 10 more wait in a queue and run in order, each joining the timeline as it finishes. Cancel generation stops the running job, and Cancel on a queued card in the gallery drops that one. The queue does not survive a restart. Jobs and generated MP4s are saved under `.jobs/`, one folder per job, and Cancel stops the worker. Every generation appears in the Generations gallery under the timeline, including after a restart. A finished generation is added to the timeline as a new shot. From the gallery you can put a clip in the selected shot, add it as another shot, reuse its prompt and settings, or delete it along with its files.

The model stays loaded between generations, so only the first one after starting the app pays the loading cost. Re-running a prompt with a new seed also skips prompt encoding. Quality picks the number of denoising steps (Draft 12, Standard 20, High 32), and generation time grows roughly in step with it. Under Advanced, Prompt strength sets the guidance scale (default 3) and Avoid sets the negative prompt. The dice button picks a random seed, and Reuse in the gallery restores all of these. The model is unloaded after 10 idle minutes to give memory back; set `ANIMATION_ENGINE_IDLE_MINUTES` to change that. `ANIMATION_ENGINE_PORT` pins the server to one port instead of picking the first free one from 5173. To run a single job outside the app, use `.venv/bin/python engine/generate.py .jobs/<id>/job.json`.

The current checkout already has its isolated Python environment installed. It uses PyTorch's MPS backend on the M4 Mac. The whole model, text encoder included, runs on the GPU while loaded. Resolution picks the generation size: Preview (448×256, 256×448 or 448×448), Medium (640×352, 352×640 or 576×576) or Large (832×480, 480×832 or 704×704); clips are 9, 25, 49, 121 or 241 frames at 24 fps (0.4 to 10 seconds). Longer clips take longer and need more memory. On the 24 GB M4 with the distilled model, a 10-second clip takes about 1.5 minutes at Preview and about 4 minutes at Medium, where it swaps heavily, so close other apps first. Large clips stop at 5 seconds. High detail (512×896, 896×512 or 768×768) generates at half size, upscales 2x with the 0.5 GB LTX spatial upscaler (downloaded on first use) and refines in 4 more steps. It is the sharpest option and the slowest: on the 24 GB M4 a 5-second clip took about 5 minutes and filled swap, so it stops at 5 seconds and needs the distilled model. Larger sizes take longer and need more memory, so start with Preview to find a shot and re-run it with Reuse at a larger size. Animating your own image starts at Medium, because still images barely move at Preview size. The model follows descriptions of the scene as it plays out ("The knight slowly turns his head to the left") much better than instructions ("Make the knight turn his head"), and the panel shows a tip when a prompt reads like an instruction. When animating an image, More images adds up to 3 keyframes: your artwork starts the clip and the others are spread evenly to its end, so one clip can move between poses or camera angles (distilled model only; each image needs its own 8 frames, so 0.4-second clips take two). Generation performance and quality depend on hardware and model; this is an initial application, not feature parity with Runway.

## Editor features

- A timeline of shots played back to back: add, reorder and delete shots, each with its own artwork or generated clip, camera, atmosphere, length (2–15 seconds), title, and a cut, crossfade or fade from black into it (half a second).
- A music track under the whole video, with volume and a fade-out at the end. It plays with the preview and is mixed into MP4 exports (AAC where the browser supports it, otherwise Opus); WebM fallback exports stay silent.
- Image import; six camera movements; embers, snow, rain and mist.
- Portrait, landscape and square formats for the whole video.
- Live preview, playback and scrubbing; titles and vignette.
- MP4 export (H.264 where the browser supports it, otherwise VP9), rendered frame by frame with WebCodecs, so it's exact and usually faster than real time. It's 30 fps, with the music track when there is one. Browsers without WebCodecs fall back to real-time WebM recording.
- Download and reopen JSON projects with every shot and the music track.
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

- `server.mjs`: starts the local server on 127.0.0.1:5173, or the next free port, and records it in `.jobs/server.json`.
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
