import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FADE_OUT_SECONDS, musicGain } from '../public/js/audio.js';

test('plays music at its volume and fades it out at the end of the video', () => {
  assert.equal(musicGain(0, 10, 0.8), 0.8);
  assert.equal(musicGain(10 - FADE_OUT_SECONDS, 10, 0.8), 0.8);
  assert.ok(Math.abs(musicGain(10 - FADE_OUT_SECONDS / 2, 10, 0.8) - 0.4) < 1e-9);
  assert.equal(musicGain(10, 10, 0.8), 0);
  assert.equal(musicGain(12, 10, 0.8), 0);
  // A video shorter than the fade starts partway down it.
  assert.ok(musicGain(0, 1, 1) < 1);
});
