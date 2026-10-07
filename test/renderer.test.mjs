import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraTransform, wrapTitle } from '../public/js/renderer.js';

test('push and pull zoom across the shot', () => {
  assert.equal(cameraTransform('push', 0.2, 0, 1000, 500).zoom, 1);
  assert.equal(cameraTransform('push', 0.2, 1, 1000, 500).zoom, 1.2);
  assert.equal(cameraTransform('pull', 0.2, 0, 1000, 500).zoom, 1.2);
  assert.equal(cameraTransform('pull', 0.2, 1, 1000, 500).zoom, 1);
});

test('pans move in opposite directions and are centered mid-shot', () => {
  assert.equal(cameraTransform('left', 0.2, 0.5, 1000, 500).x, 0);
  assert.ok(cameraTransform('left', 0.2, 1, 1000, 500).x < 0);
  assert.ok(cameraTransform('right', 0.2, 1, 1000, 500).x > 0);
  assert.equal(cameraTransform('left', 0.2, 1, 1000, 500).zoom, 1.2);
});

test('a locked camera never moves', () => {
  assert.deepEqual(cameraTransform('still', 0.3, 0.7, 1000, 500), { zoom: 1, x: 0, y: 0 });
});

test('wraps titles to the available width', () => {
  const ctx = { measureText: (text) => ({ width: text.length * 10 }) };
  assert.deepEqual(wrapTitle(ctx, 'The returning knight', 120), ['The', 'returning', 'knight']);
  assert.deepEqual(wrapTitle(ctx, 'The returning knight', 1000), ['The returning knight']);
});
