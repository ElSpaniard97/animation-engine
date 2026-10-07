import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTime, frameAt, moveShot, shotAt, shotStart, totalDuration } from '../public/js/shots.js';

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

test('blends into shots that crossfade or fade in', () => {
  const sequence = [
    { settings: { duration: '5', transition: 'crossfade' } },
    { settings: { duration: '2', transition: 'crossfade' } },
    { settings: { duration: '10', transition: 'fade' } },
    { settings: { duration: '3', transition: 'cut' } },
  ];
  // The first shot has nothing before it, so a crossfade fades in from black.
  assert.deepEqual(frameAt(sequence, 0.25), { index: 0, local: 0.25, transition: 'fade', mix: 0.5 });
  assert.deepEqual(frameAt(sequence, 1), { index: 0, local: 1, transition: 'cut', mix: 1 });
  // The outgoing shot keeps running past its end while the next one blends in.
  assert.deepEqual(frameAt(sequence, 5.25), {
    index: 1,
    local: 0.25,
    transition: 'crossfade',
    mix: 0.5,
    previous: { index: 0, local: 5.25 },
  });
  assert.deepEqual(frameAt(sequence, 7.125), { index: 2, local: 0.125, transition: 'fade', mix: 0.25 });
  assert.deepEqual(frameAt(sequence, 17), { index: 3, local: 0, transition: 'cut', mix: 1 });
  // Shots saved before transitions existed cut.
  assert.equal(frameAt(shots, 5).transition, 'cut');
});
