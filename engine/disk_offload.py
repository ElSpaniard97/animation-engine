"""Compact placeholders for Diffusers 0.39's disk-backed offloading.

The library restores real weights before forward, but its disk offload hook leaves a full-size
empty CPU tensor behind. For 13B + T5 those unused allocations are larger than this Mac's RAM.
A scalar expanded to the original shape preserves the metadata with constant storage. No model
weights change: the original hook saves them and the onload hook restores them from disk.
"""


def enable_compact_disk_placeholders():
    import torch
    from diffusers.hooks.group_offloading import ModuleGroup

    if getattr(ModuleGroup, '_animation_compact_placeholders', False):
        return
    original = ModuleGroup._offload_to_disk

    def compact_offload(group):
        original(group)
        for tensor in group.tensor_to_key:
            tensor.data = torch.empty((), dtype=tensor.dtype, device=group.offload_device).expand(tensor.shape)

    ModuleGroup._offload_to_disk = compact_offload
    ModuleGroup._animation_compact_placeholders = True
