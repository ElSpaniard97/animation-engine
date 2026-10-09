import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

function run(script, model) {
  return JSON.parse(
    execFileSync('python3', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, ANIMATION_ENGINE_MODEL: model },
    }),
  );
}

test('model profiles select the official checkpoint without downloading', () => {
  const script = `
import sys, types, json
sys.path.insert(0, 'engine')
sys.modules['huggingface_hub'] = types.SimpleNamespace(hf_hub_download=lambda repo, name: [repo, name])
from ltx_engine import distilled_checkpoint
print(json.dumps(distilled_checkpoint()))
`;
  assert.deepEqual(run(script, 'distilled-13b'), [
    'Lightricks/LTX-Video',
    'ltxv-13b-0.9.8-distilled.safetensors',
  ]);
  assert.deepEqual(run(script, 'distilled'), ['Lightricks/LTX-Video', 'ltxv-2b-0.9.8-distilled.safetensors']);
});

test('13B caches prompts and synchronizes after encoding failures without moving the full encoder', () => {
  const script = `
import sys, types, json
sys.path.insert(0, 'engine')
from ltx_engine import Engine
calls=[]; syncs=[]
engine=Engine(lambda *args: None)
engine.device='cuda'
engine.torch=types.SimpleNamespace(cuda=types.SimpleNamespace(synchronize=lambda:syncs.append(True)))
def whole_model_move(*args): raise AssertionError('The offloaded encoder must not be moved as a whole')
engine.text_to_video=types.SimpleNamespace(text_encoder=types.SimpleNamespace(to=whole_model_move))
def encode(prompt,negative):
    calls.append(prompt)
    if prompt=='failure': raise RuntimeError('test failure')
    return (None,None,None,None)
engine._encode_prompt=encode
engine.encode('same','')
engine.encode('same','')
try: engine.encode('failure','')
except RuntimeError: pass
print(json.dumps([calls,len(syncs)]))
`;
  assert.deepEqual(run(script, 'distilled-13b'), [['same', 'failure'], 2]);
});
