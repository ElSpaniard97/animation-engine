import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { JobRunner } from '../server/jobs.mjs';

const ID = (n) => `0000000${n}-0000-4000-8000-000000000000`;

async function makeJob(dir, id, { status, video = false, image = false, settings = {} } = {}) {
  const jobDir = join(dir, id);
  await mkdir(jobDir);
  const config = { prompt: 'Knight ' + id.slice(7, 8), seed: 3, frames: 25, ratio: '9:16', ...settings };
  if (image) config.image_path = join(jobDir, 'input.png');
  await writeFile(join(jobDir, 'job.json'), JSON.stringify(config));
  if (status) await writeFile(join(jobDir, 'status.json'), JSON.stringify(status));
  if (video) await writeFile(join(jobDir, 'output.mp4'), 'mp4');
}

test('restores saved jobs and marks interrupted ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'animation-engine-load-'));
  try {
    const done = { status: 'complete', stage: 'Complete', createdAt: '2026-10-01T00:00:00.000Z' };
    await makeJob(dir, ID(1), { status: done, video: true, image: true });
    await makeJob(dir, ID(2), {
      status: { ...done, status: 'running', stage: 'Generating frames' },
      video: true,
    });
    await makeJob(dir, ID(3), { video: true });
    await makeJob(dir, ID(4));
    await makeJob(dir, ID(5), { status: { ...done, status: 'failed', stage: 'Failed: out of memory' } });
    await makeJob(dir, ID(6), { status: done });
    const advanced = { quality: 'high', guidance: 6.5, negative_prompt: 'text' };
    await makeJob(dir, ID(8), { status: done, video: true, settings: advanced });
    await mkdir(join(dir, 'not-a-job'));
    await mkdir(join(dir, ID(7)));

    const runner = new JobRunner({ jobsDir: dir, python: 'none', script: 'none' });
    await runner.load();
    const byId = Object.fromEntries(runner.list().map((j) => [j.id, j]));
    assert.deepEqual(Object.keys(byId).sort(), [1, 2, 3, 4, 5, 6, 8].map(ID));

    assert.equal(byId[ID(1)].status, 'complete');
    assert.equal(byId[ID(1)].url, `/api/jobs/${ID(1)}/video`);
    assert.equal(byId[ID(1)].mode, 'image');
    assert.equal(byId[ID(1)].ratio, '9:16');
    assert.equal(byId[ID(2)].status, 'failed', 'a job running at shutdown may have a partial video');
    assert.equal(byId[ID(2)].stage, 'Interrupted when the app closed');
    assert.equal(byId[ID(3)].status, 'complete', 'jobs from before status files count if they made a video');
    assert.equal(byId[ID(4)].status, 'failed');
    assert.equal(byId[ID(5)].stage, 'Failed: out of memory');
    assert.equal(byId[ID(6)].stage, 'Video file is missing');
    const { quality, guidance, negative_prompt } = byId[ID(8)];
    assert.deepEqual({ quality, guidance, negative_prompt }, advanced);
    assert.equal(byId[ID(1)].quality, 'standard', 'older jobs report the settings they ran with');
    assert.equal(byId[ID(1)].guidance, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an empty or missing jobs folder loads nothing', async () => {
  const runner = new JobRunner({
    jobsDir: join(tmpdir(), 'does-not-exist-' + Date.now()),
    python: 'x',
    script: 'x',
  });
  await runner.load();
  assert.deepEqual(runner.list(), []);
});
