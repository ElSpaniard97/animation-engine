import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXPORT_FPS,
  OUTPUT_SIZES,
  exportBitrate,
  isMirroredReference,
  sourceQuality,
} from '../public/js/quality.js';
test('1080p export matches the generation cadence and scales compression budget', () => {
  assert.equal(EXPORT_FPS, 24);
  assert.deepEqual(OUTPUT_SIZES['9:16'], [1080, 1920]);
  assert.equal(exportBitrate(1920, 1080), exportBitrate(1080, 1920));
  assert.ok(exportBitrate(1920, 1080) > 18_000_000);
  assert.equal(exportBitrate(200, 200), 8_000_000);
  assert.equal(exportBitrate(8000, 8000), 40_000_000);
});
test('only a near-exact mirror of an asymmetric scene produces a warning', () => {
  const first = Uint8Array.from([10, 20, 30, 255, 210, 220, 230, 255]);
  const mirror = Uint8Array.from([210, 220, 230, 255, 10, 20, 30, 255]);
  assert.equal(isMirroredReference(first, mirror, 2, 1), true);
  assert.equal(isMirroredReference(first, first, 2, 1), false);
  assert.equal(isMirroredReference(first, Uint8Array.from([90, 70, 80, 255, 20, 100, 50, 255]), 2, 1), false);
  assert.equal(isMirroredReference(first, mirror, 3, 1), false);
});
test('source notice distinguishes enlargement from genuine source detail', () => {
  assert.match(sourceQuality(256, 448, 1080, 1920), /Enlarged/);
  assert.match(sourceQuality(2160, 3840, 1080, 1920), /covers/);
  assert.match(sourceQuality(0, 0, 1080, 1920), /Add artwork/);
});
