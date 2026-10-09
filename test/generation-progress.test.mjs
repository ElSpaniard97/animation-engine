import test from 'node:test';
import assert from 'node:assert/strict';
import { generationProgress } from '../public/js/generation-progress.js';

test('reports actual steps and elapsed runtime rather than an overall completion estimate', () => {
  const progress = generationProgress(
    { status: 'running', stage: 'Generating frames', step: 3, total: 8, startedAt: '2026-10-09T13:00:00Z' },
    Date.parse('2026-10-09T13:02:05Z'),
  );
  assert.equal(progress.value, 37.5);
  assert.match(progress.text, /38% of this stage · 2m 5s elapsed/);
});
test('loading and encoding remain indeterminate and completion is explicit', () => {
  for (const stage of ['Loading model', 'Encoding video'])
    assert.equal(generationProgress({ status: 'running', stage }).value, null);
  assert.equal(generationProgress({ status: 'complete' }).value, 100);
  assert.equal(generationProgress({ status: 'failed' }).value, 0);
  assert.equal(generationProgress({ status: 'queued', position: 2 }).value, null);
});
test('finished elapsed time stays fixed and legacy jobs label queue-inclusive time honestly', () => {
  assert.match(
    generationProgress(
      { status: 'complete', startedAt: '2026-10-09T13:00:00Z', finishedAt: '2026-10-09T13:03:00Z' },
      Date.now(),
    ).text,
    /3m 0s elapsed/,
  );
  assert.match(
    generationProgress(
      { status: 'running', createdAt: '2026-10-09T13:00:00Z' },
      Date.parse('2026-10-09T13:01:00Z'),
    ).text,
    /since requested/,
  );
});
