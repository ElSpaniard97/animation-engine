import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTime, moveShot, shotAt, shotStart, totalDuration } from '../public/js/shots.js';

const shots = ['5', '2', '10'].map((duration, i) => ({ id: i, settings: { duration } }));

test('adds up the sequence', () => {
  assert.equal(totalDuration(shots), 17);
  assert.equal(shotStart(shots, 0), 0);
  assert.equal(shotStart(shots, 2), 7);
});

test('finds the shot under the playhead', () => {
  assert.deepEqual(shotAt(shots, 0), { index: 0, local: 0 });
  assert.deepEqual(shotAt(shots, 4.5), { index: 0, local: 4.5 });
  // A cut belongs to the shot that starts there.
  assert.deepEqual(shotAt(shots, 5), { index: 1, local: 0 });
  assert.deepEqual(shotAt(shots, 8), { index: 2, local: 1 });
  // The end of the sequence is the last frame of the last shot.
  assert.deepEqual(shotAt(shots, 17), { index: 2, local: 10 });
  assert.deepEqual(shotAt(shots, 99), { index: 2, local: 10 });
  assert.equal(shotAt([], 1), null);
});

test('reorders shots without changing the original', () => {
  assert.deepEqual(
    moveShot(shots, 0, 2).map((s) => s.id),
    [1, 2, 0],
  );
  assert.deepEqual(
    moveShot(shots, 2, 0).map((s) => s.id),
    [2, 0, 1],
  );
  assert.deepEqual(
    moveShot(shots, 1, 9).map((s) => s.id),
    [0, 2, 1],
  );
  assert.deepEqual(
    shots.map((s) => s.id),
    [0, 1, 2],
  );
});

test('formats times past a minute', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(9.9), '0:09');
  assert.equal(formatTime(75), '1:15');
});
