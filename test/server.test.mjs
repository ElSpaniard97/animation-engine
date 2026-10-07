import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createAppServer } from '../server/app.mjs';
import { JobRunner } from '../server/jobs.mjs';

let port, server, runner, jobsDir;

async function freePort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}

function call(method, path, { headers = {}, body } = {}) {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json;
        try {
          json = JSON.parse(raw);
        } catch {}
        done({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on('error', fail);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

const fromApp = () => ({ origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' });
const job = (prompt, extra = {}) => ({ prompt, ratio: '16:9', frames: 9, seed: 1, ...extra });

async function waitFor(id, status) {
  for (let i = 0; i < 100; i++) {
    const res = await call('GET', '/api/jobs/' + id);
    if (res.json.status !== 'running' || status === 'running') {
      if (!status || res.json.status === status) return res.json;
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  throw Error('Job did not reach ' + status);
}

before(async () => {
  port = await freePort();
  jobsDir = await mkdtemp(join(tmpdir(), 'animation-engine-jobs-'));
  runner = new JobRunner({
    jobsDir,
    python: process.execPath,
    script: resolve('test/fixtures/fake-worker.mjs'),
  });
  server = createAppServer({ port, publicDir: resolve('public'), runner });
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
});

after(async () => {
  runner.killAll();
  await new Promise((done) => server.close(done));
  await rm(jobsDir, { recursive: true, force: true });
});

test('serves the editor and blocks other hosts and paths outside public/', async () => {
  const page = await call('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.raw.toString(), /js\/main\.js/);
  assert.equal((await call('GET', '/js/main.js')).headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await call('GET', '/', { headers: { host: 'evil.test' } })).status, 403);
  assert.equal((await call('GET', '/..%2fserver.mjs')).status, 403);
  assert.equal((await call('GET', '/missing.js')).status, 404);
  assert.equal((await call('DELETE', '/')).status, 405);
});

test('reports the engine', async () => {
  const res = await call('GET', '/api/engine');
  assert.deepEqual(res.json, { installed: true, active: null, engine: 'LTX-Video · local GPU' });
});

test('only accepts generation requests from the app', async () => {
  const res = await call('POST', '/api/generate', { body: job('A knight') });
  assert.equal(res.status, 403);
  const bad = await call('POST', '/api/generate', { headers: fromApp(), body: job('') });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /prompt/);
  const broken = await call('POST', '/api/generate', { headers: fromApp(), body: '{' });
  assert.equal(broken.status, 400);
});

test('runs a job, reports progress and serves the video with ranges', async () => {
  const start = await call('POST', '/api/generate', { headers: fromApp(), body: job('A knight') });
  assert.equal(start.status, 202);
  const done = await waitFor(start.json.id);
  assert.equal(done.status, 'complete');
  assert.equal(done.stage, 'Complete');
  assert.equal(done.child, undefined);

  const whole = await call('GET', done.url);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers['accept-ranges'], 'bytes');
  assert.equal(whole.raw.length, 1000);

  const part = await call('GET', done.url, { headers: { range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers['content-range'], 'bytes 10-19/1000');
  assert.deepEqual([...part.raw], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

  const past = await call('GET', done.url, { headers: { range: 'bytes=1000-' } });
  assert.equal(past.status, 416);
});

test('saves an uploaded image next to the job', async () => {
  const image = 'data:image/png;base64,' + Buffer.from('fake png').toString('base64');
  const start = await call('POST', '/api/generate', { headers: fromApp(), body: job('A knight', { image }) });
  await waitFor(start.json.id, 'complete');
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(join(jobsDir, start.json.id, 'job.json'), 'utf8'));
  assert.equal(config.image, undefined);
  assert.equal((await readFile(config.image_path)).toString(), 'fake png');
});

test('reports worker failures', async () => {
  const crash = await call('POST', '/api/generate', { headers: fromApp(), body: job('fail') });
  assert.equal((await waitFor(crash.json.id)).stage.trim(), 'CUDA exploded');
  const reported = await call('POST', '/api/generate', { headers: fromApp(), body: job('report failure') });
  assert.equal((await waitFor(reported.json.id)).stage, 'Failed: out of memory');
  const empty = await call('POST', '/api/generate', { headers: fromApp(), body: job('no output') });
  const result = await waitFor(empty.json.id);
  assert.equal(result.stage, 'Worker produced no video');
  assert.equal((await call('GET', result.id && `/api/jobs/${result.id}/video`)).status, 409);
});

test('runs one job at a time and cancels', async () => {
  const slow = await call('POST', '/api/generate', { headers: fromApp(), body: job('slow') });
  assert.equal(slow.status, 202);
  assert.equal((await call('GET', '/api/engine')).json.active, slow.json.id);
  const second = await call('POST', '/api/generate', { headers: fromApp(), body: job('A knight') });
  assert.equal(second.status, 409);

  const cancel = await call('POST', `/api/jobs/${slow.json.id}/cancel`, { headers: fromApp() });
  assert.deepEqual(cancel.json, { status: 'cancelled' });
  for (let i = 0; i < 100 && runner.active; i++) await new Promise((done) => setTimeout(done, 20));
  assert.equal(runner.active, null);
  assert.equal((await call('GET', '/api/jobs/' + slow.json.id)).json.stage, 'Cancelled');
  const next = await call('POST', '/api/generate', { headers: fromApp(), body: job('A knight') });
  assert.equal(next.status, 202);
  await waitFor(next.json.id, 'complete');
});

test('returns 404 for unknown jobs and routes', async () => {
  assert.equal((await call('GET', '/api/jobs/abc')).status, 404);
  assert.equal((await call('POST', '/api/jobs/abc/cancel', { headers: fromApp() })).status, 404);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});
