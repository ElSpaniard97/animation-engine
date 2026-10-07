import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAppServer } from './server/app.mjs';
import { JobRunner } from './server/jobs.mjs';

export { validate } from './server/validate.mjs';

const PORT = 5173;
const jobsDir = resolve('.jobs');
await mkdir(jobsDir, { recursive: true });

const runner = new JobRunner({
  jobsDir,
  python: resolve('.venv/bin/python'),
  script: resolve('engine/generate.py'),
  env: { HF_HOME: resolve('.models'), PYTORCH_ENABLE_MPS_FALLBACK: '1' },
});
const server = createAppServer({ port: PORT, publicDir: resolve('public'), runner });

server.listen(PORT, '127.0.0.1', () => console.log(`Animation Engine: http://127.0.0.1:${PORT}`));
process.on('SIGINT', () => {
  runner.killAll();
  server.close(() => process.exit());
});
