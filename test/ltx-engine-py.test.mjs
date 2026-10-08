// Checks how engine/ltx_engine.py hands images to the pipeline, with a stand-in diffusers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const script = `
import json, sys
sys.path.insert(0, 'test/fixtures/stubs')
sys.path.insert(0, 'engine')
from ltx_engine import image_args
out = {}
for count, frames in [(1, 49), (2, 121), (4, 241)]:
    args = image_args(['image%d' % i for i in range(count)], frames)
    out[count] = {
        key: [[c.image, c.frame_index] for c in value] if key == 'conditions' else value
        for key, value in args.items()
    }
print(json.dumps(out))
`;

test('several images reach the pipeline as conditions, each at its keyframe', () => {
  const out = JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
  assert.deepEqual(out[1], { image: 'image0' });
  // A list in image= would silently drop every image after the first.
  assert.deepEqual(out[2], {
    conditions: [
      ['image0', 0],
      ['image1', 120],
    ],
  });
  assert.deepEqual(out[4], {
    conditions: [
      ['image0', 0],
      ['image1', 80],
      ['image2', 160],
      ['image3', 240],
    ],
  });
});
