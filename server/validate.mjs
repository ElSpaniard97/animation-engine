const RATIOS = ['9:16', '16:9', '1:1'];
const FRAME_COUNTS = [9, 25, 49];
const MAX_SEED = 2147483647;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

// Preview sizes LTX-Video accepts (multiples of 32) for each output format.
const SIZES = {
  '9:16': { width: 256, height: 448 },
  '16:9': { width: 448, height: 256 },
  '1:1': { width: 448, height: 448 },
};

export const STEPS = 20;

/** Checks a generation request and returns it with the worker's size and step settings. */
export function validate(data) {
  if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 2000) {
    throw Error('Enter a prompt of 1–2000 characters');
  }
  const ratio = data.ratio || '16:9';
  if (!RATIOS.includes(ratio)) throw Error('Invalid format');
  if (!FRAME_COUNTS.includes(data.frames)) throw Error('Choose a supported length');
  if (!Number.isInteger(data.seed) || data.seed < 0 || data.seed > MAX_SEED) {
    throw Error('Invalid seed');
  }
  if (data.image && !IMAGE_DATA_URL.test(data.image)) {
    throw Error('Image must be PNG, JPG, or WebP');
  }
  return { ...data, ...SIZES[ratio], steps: STEPS };
}
