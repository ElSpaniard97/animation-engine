import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { WorkerProcess } from '../server/worker.mjs';

const fake = (options = {}) =>
  new WorkerProcess({
    python: process.execPath,
    script: resolve('test/fixtures/fake-worker.mjs'),
    ...options,
  });
const config = (id, prompt) => ({ id, prompt, steps: 20, output_path: '/dev/null' });
const exited = (worker) => new Promise((done) => worker.child.once('exit', done));

test('unloads after being idle and starts again for the next job', async () => {
  const worker = fake({ idleMs: 50 });
  const first = await worker.run(config('a', 'Knight'));
  assert.equal(first.result, 'complete');
  const pid = worker.pid;
  await exited(worker);
  assert.equal(worker.pid, null);
  const second = await worker.run(config('b', 'Knight'));
  assert.equal(second.result, 'complete');
  assert.notEqual(second.timings.pid, pid);
  worker.stop();
});

test('reports progress for the current job only', async () => {
  const worker = fake();
  const stages = [];
  await worker.run(config('a', 'Knight'), (p) => stages.push(p.stage));
  assert.deepEqual(stages, ['Loading model weights (first run downloads them)', 'Generating frames']);
  worker.stop();
});

test('cancels a job and keeps the worker loaded', async () => {
  const worker = fake();
  const running = worker.run(config('a', 'slow'));
  await new Promise((done) => setTimeout(done, 100));
  const pid = worker.pid;
  worker.cancel('a');
  assert.equal((await running).result, 'cancelled');
  assert.equal(worker.pid, pid);
  worker.stop();
});

test('kills a worker that ignores a cancel', async () => {
  const worker = fake({ cancelGraceMs: 100 });
  const running = worker.run(config('a', 'stuck'));
  await new Promise((done) => setTimeout(done, 100));
  worker.cancel('a');
  assert.deepEqual(await running, { result: 'cancelled', stage: 'Cancelled', timings: undefined });
  assert.equal(worker.pid, null);
});

test('refuses a second job while one runs', async () => {
  const worker = fake();
  const running = worker.run(config('a', 'slow'));
  assert.throws(() => worker.run(config('b', 'Knight')), /already running/);
  worker.cancel('a');
  await running;
  worker.stop();
});
