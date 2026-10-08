# Stand-in for the diffusers class, so the engine's argument building runs without diffusers.
from dataclasses import dataclass


@dataclass
class LTXVideoCondition:
    image: object = None
    video: object = None
    frame_index: int = 0
    strength: float = 1.0
