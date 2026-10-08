import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IMAGE_TIP, INSTRUCTION_TIP, promptTip } from '../public/js/prompt-tips.js';

test('instruction-style prompts get a rewrite tip', () => {
  assert.equal(promptTip('Make the knights head turn left and right', 'image'), INSTRUCTION_TIP);
  assert.equal(promptTip('  please animate the dragon', 'text'), INSTRUCTION_TIP);
  assert.equal(promptTip('Can you have the cape move', 'text'), INSTRUCTION_TIP);
});

test('descriptions get the image tip only when animating an image', () => {
  assert.equal(promptTip('The knight slowly turns his head', 'image'), IMAGE_TIP);
  assert.equal(promptTip('The knight slowly turns his head', 'text'), '');
  assert.equal(promptTip('Maker of swords at a forge', 'text'), '');
});
