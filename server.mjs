import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAppServer } from './server/app.mjs';
import { JobRunner } from './server/jobs.mjs';
import { DEFAULT_PORT, listenOnFreePort } from './server/listen.mjs';

export { validate } from './server/validate.mjs';

// 5173 unless another program has it, then the next free port. ANIMATION_ENGINE_PORT pins one.
const pinned = Number(process.env.ANIMATION_ENGINE_PORT);
// 13B distilled with disk offloading by default; 2B distilled and classic remain available.
const model = process.env.ANIMATION_ENGINE_MODEL || 'distilled-13b';
if (!['distilled-13b', 'distilled', 'classic'].includes(model)) throw Error('Unknown ANIMATION_ENGINE_MODEL');
const jobsDir = resolve('.jobs');
await mkdir(jobsDir, { recursive: true });

const runner = new JobRunner({
  jobsDir,
  python: resolve('.venv/bin/python'),
  script: resolve('engine/worker.py'),
  env: { HF_HOME: resolve('.models'), PYTORCH_ENABLE_MPS_FALLBACK: '1', ANIMATION_ENGINE_MODEL: model },
  // The model stays loaded between generations and is unloaded after this long without one.
  idleMs: (Number(process.env.ANIMATION_ENGINE_IDLE_MINUTES) || 10) * 60 * 1000,
});
await runner.load();
const { server, port } = await listenOnFreePort(
  (port) => createAppServer({ port, publicDir: resolve('public'), runner, model }),
  { port: pinned || DEFAULT_PORT, fixed: Boolean(pinned) },
);
console.log(`Animation Engine: http://127.0.0.1:${port}`);
// The desktop app finds a running server through this file, or the message when it started it.
await writeFile(resolve(jobsDir, 'server.json'), JSON.stringify({ port, pid: process.pid }));
process.parentPort?.postMessage({ port });
process.on('SIGINT', () => {
  runner.killAll();
  server.close(() => process.exit());
});
