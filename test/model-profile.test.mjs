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

test('13B releases the text encoder after encoding, on failure, and skips cached prompts', () => {
  const script = `
import sys, types, json
sys.path.insert(0, 'engine')
from ltx_engine import Engine
moves=[]
engine=Engine(lambda *args: None)
engine.device='cuda'
engine.torch=types.SimpleNamespace(cuda=types.SimpleNamespace(synchronize=lambda:None))
engine.text_to_video=types.SimpleNamespace(text_encoder=types.SimpleNamespace(to=moves.append))
engine._encode_prompt=lambda *args: (None,None,None,None)
engine.encode('same prompt','')
engine.encode('same prompt','')
first=list(moves)
def fail(*args): raise RuntimeError('test failure')
engine._encode_prompt=fail
try: engine.encode('different prompt','')
except RuntimeError: pass
print(json.dumps([first,moves]))
`;
  assert.deepEqual(run(script, 'distilled-13b'), [
    ['cuda', 'cpu'],
    ['cuda', 'cpu', 'cuda', 'cpu'],
  ]);
});
