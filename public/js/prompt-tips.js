// LTX-Video follows a description of the scene as it plays out. Instructions such as "make the
// knight turn" barely move, especially when animating a still image, so the panel nudges toward
// describing the motion instead.

const INSTRUCTION = /^\s*(please\s+)?(make|have|let|get|animate|can you|could you|i want)\b/i;

export const IMAGE_TIP =
  'Describe the motion as it happens, e.g. “The knight slowly turns his head to the left, then to the right, his cape stirring in the wind.”';
export const INSTRUCTION_TIP =
  'Describe what happens instead of giving an instruction, e.g. “The knight turns his head…” rather than “Make the knight turn his head”.';

/** The tip to show for `prompt` in `mode` ('text' or 'image'), or '' when none applies. */
export function promptTip(prompt, mode) {
  if (INSTRUCTION.test(prompt)) return INSTRUCTION_TIP;
  if (mode === 'image') return IMAGE_TIP;
  return '';
}
