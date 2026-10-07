import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRange } from '../server/http.mjs';

test('parses single byte ranges', () => {
  assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange('bytes=10-19', 1000), { start: 10, end: 19 });
  assert.deepEqual(parseRange('bytes=-5', 1000), { start: 995, end: 999 });
  assert.deepEqual(parseRange('bytes=990-5000', 1000), { start: 990, end: 999 });
  assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
});

test('serves the whole file for missing or unsupported ranges', () => {
  assert.equal(parseRange(undefined, 1000), null);
  assert.equal(parseRange('bytes=-', 1000), null);
  assert.equal(parseRange('bytes=0-0,5-6', 1000), null);
  assert.equal(parseRange('items=0-5', 1000), null);
});

test('flags ranges past the end', () => {
  assert.deepEqual(parseRange('bytes=1000-', 1000), { unsatisfiable: true });
  assert.deepEqual(parseRange('bytes=-0', 1000), { unsatisfiable: true });
  assert.deepEqual(parseRange('bytes=20-10', 1000), { unsatisfiable: true });
});
