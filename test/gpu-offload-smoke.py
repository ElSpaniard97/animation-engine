"""Optional real-GPU validation: .venv/bin/python test/gpu-offload-smoke.py"""
import sys
import tempfile
from pathlib import Path
import torch
from transformers import T5Config, T5EncoderModel
from diffusers.hooks import apply_group_offloading

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
from disk_offload import enable_compact_disk_placeholders

device = 'mps' if torch.backends.mps.is_available() else 'cuda'
model = T5EncoderModel(T5Config(vocab_size=32, d_model=32, d_ff=64, num_layers=2,
                              num_heads=4, d_kv=8, dropout_rate=0)).eval().to(dtype=torch.bfloat16)
x = torch.tensor([[1, 2, 3]], device=device)
with torch.inference_mode():
    expected = model.to(device)(input_ids=x).last_hidden_state.cpu()
model.to('cpu')
enable_compact_disk_placeholders()
with tempfile.TemporaryDirectory() as folder:
    apply_group_offloading(model.encoder, onload_device=device, offload_type='block_level',
                           num_blocks_per_group=1, offload_to_disk_path=folder)
    assert len(list(Path(folder).glob('*.safetensors'))) >= 3
    with torch.inference_mode():
        first = model(input_ids=x).last_hidden_state.cpu()
        second = model(input_ids=x).last_hidden_state.cpu()
    assert torch.equal(first, expected) and torch.equal(first, second)
    cpu_parameters = [p for p in model.parameters() if p.device.type == 'cpu']
    assert cpu_parameters
    assert all(p.untyped_storage().nbytes() == p.element_size() for p in cpu_parameters)
print('BF16 T5 output matches before/after two disk-offload cycles; CPU placeholders use scalar storage.')
