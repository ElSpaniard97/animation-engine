import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_NEGATIVE_PROMPT, validate } from '../server/validate.mjs';

const base = { prompt: 'A knight in mist', ratio: '16:9', frames: 25, seed: 42 };

test('adds the preview size and default generation settings', () => {
  assert.deepEqual(validate(base), {
    ...base,
    width: 448,
    height: 256,
    quality: 'standard',
    steps: 20,
    guidance: 3,
    negative_prompt: DEFAULT_NEGATIVE_PROMPT,
  });
  assert.equal(validate({ ...base, ratio: '9:16' }).width, 256);
  assert.equal(validate({ ...base, ratio: '9:16' }).height, 448);
  assert.equal(validate({ ...base, ratio: '1:1' }).height, 448);
  assert.equal(validate({ ...base, ratio: undefined }).width, 448);
});

test('rejects bad prompts, formats, lengths and seeds', () => {
  for (const bad of [
    { prompt: '' },
    { prompt: '   ' },
    { prompt: 'x'.repeat(2001) },
    { prompt: 42 },
    { ratio: '4:3' },
    { frames: 10 },
    { frames: '25' },
    { seed: -1 },
    { seed: 1.5 },
    { seed: 2147483648 },
  ]) {
    assert.throws(() => validate({ ...base, ...bad }), undefined, JSON.stringify(bad));
  }
});

test('maps quality to steps and keeps the chosen guidance and negative prompt', () => {
  assert.equal(validate({ ...base, quality: 'draft' }).steps, 12);
  assert.equal(validate({ ...base, quality: 'high' }).steps, 32);
  assert.equal(validate({ ...base, guidance: 7.5 }).guidance, 7.5);
  assert.equal(
    validate({ ...base, negative_prompt: '  text, watermark ' }).negative_prompt,
    'text, watermark',
  );
  // An empty negative prompt is allowed and means "avoid nothing".
  assert.equal(validate({ ...base, negative_prompt: '' }).negative_prompt, '');
});

test('rejects bad quality, guidance and negative prompts', () => {
  for (const bad of [
    { quality: 'ultra' },
    { quality: 'toString' },
    { guidance: 0.5 },
    { guidance: 11 },
    { guidance: '3' },
    { guidance: NaN },
    { negative_prompt: 'x'.repeat(501) },
    { negative_prompt: 42 },
  ]) {
    assert.throws(() => validate({ ...base, ...bad }), undefined, JSON.stringify(bad));
  }
});

test('accepts PNG, JPEG and WebP images only', () => {
  for (const type of ['png', 'jpeg', 'webp']) validate({ ...base, image: `data:image/${type};base64,AAAA` });
  assert.throws(() => validate({ ...base, image: 'data:image/gif;base64,AAAA' }), /PNG, JPG, or WebP/);
  assert.throws(() => validate({ ...base, image: 'data:image/png;base64,<script>' }));
});
