// Runs the real engine/worker.py with a stand-in Engine to check the protocol the app relies on.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkerProcess } from '../server/worker.mjs';

const bootstrap = [
  'import sys, runpy',
  "sys.path.insert(0, 'test/fixtures/py')",
  "runpy.run_path('engine/worker.py', run_name='__main__')",
].join('; ');

test('engine/worker.py runs, reports, fails and cancels jobs over stdin/stdout', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'animation-engine-worker-'));
  const worker = new WorkerProcess({ python: 'python3', args: ['-c', bootstrap] });
  t.after(async () => {
    worker.stop();
    await rm(dir, { recursive: true, force: true });
  });
  const job = (id, prompt) => ({ id, prompt, steps: 20, output_path: join(dir, id + '.mp4') });

  const stages = [];
  const done = await worker.run(job('a', 'Knight'), (p) => stages.push([p.stage, p.step]));
  assert.equal(done.result, 'complete');
  assert.deepEqual(stages, [['Generating frames', 20]]);
  assert.deepEqual(done.timings, { generate: 0.1, load: 0.5 });
  assert.equal(await readFile(join(dir, 'a.mp4'), 'utf8'), 'mp4');
  const pid = worker.pid;

  const failed = await worker.run(job('b', 'fail'));
  assert.deepEqual([failed.result, failed.stage], ['failed', 'Failed: MPS backend out of memory']);

  const slow = worker.run(job('c', 'slow'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  worker.cancel('c');
  assert.equal((await slow).result, 'cancelled');
  assert.equal(worker.pid, pid, 'the same process handled every job');
});
