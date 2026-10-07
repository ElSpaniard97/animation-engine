import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAppServer } from './server/app.mjs';
import { JobRunner } from './server/jobs.mjs';

export { validate } from './server/validate.mjs';

// The Mac app expects 5173; another port lets a second copy run alongside it.
const PORT = Number(process.env.ANIMATION_ENGINE_PORT) || 5173;
const jobsDir = resolve('.jobs');
await mkdir(jobsDir, { recursive: true });

const runner = new JobRunner({
  jobsDir,
  python: resolve('.venv/bin/python'),
  script: resolve('engine/worker.py'),
  env: { HF_HOME: resolve('.models'), PYTORCH_ENABLE_MPS_FALLBACK: '1' },
  // The model stays loaded between generations and is unloaded after this long without one.
  idleMs: (Number(process.env.ANIMATION_ENGINE_IDLE_MINUTES) || 10) * 60 * 1000,
});
await runner.load();
const server = createAppServer({ port: PORT, publicDir: resolve('public'), runner });

server.listen(PORT, '127.0.0.1', () => console.log(`Animation Engine: http://127.0.0.1:${PORT}`));
process.on('SIGINT', () => {
  runner.killAll();
  server.close(() => process.exit());
});
