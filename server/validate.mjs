const RATIOS = ['9:16', '16:9', '1:1'];
// 24 fps; LTX-Video needs 8n + 1 frames.
const FRAME_COUNTS = [9, 25, 49, 121, 241];
const MAX_SEED = 2147483647;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
// Keyframe images spread across one clip: the first starts it, the last ends it. Each needs its own
// 8-frame step of the clip, so short clips take fewer.
export const MAX_KEYFRAMES = 4;

// Generation sizes LTX-Video accepts (multiples of 32) for each output format. Larger sizes look
// sharper but take longer and need more memory: Medium has about twice Preview's pixels, Large
// about three and a half times.
export const SIZES = {
  preview: {
    '9:16': { width: 256, height: 448 },
    '16:9': { width: 448, height: 256 },
    '1:1': { width: 448, height: 448 },
  },
  medium: {
    '9:16': { width: 352, height: 640 },
    '16:9': { width: 640, height: 352 },
    '1:1': { width: 576, height: 576 },
  },
  large: {
    '9:16': { width: 480, height: 832 },
    '16:9': { width: 832, height: 480 },
    '1:1': { width: 704, height: 704 },
  },
};

// Longest clip (frames) per size where one differs from FRAME_COUNTS: 10 seconds at Large needs
// more memory than a 24 GB Mac has, and 10 seconds at Medium already swaps heavily there.
export const MAX_FRAMES = { large: 121 };

// Denoising steps per quality preset: fewer is faster, more is sharper and more coherent.
export const QUALITY_STEPS = { draft: 12, standard: 20, high: 32 };
export const DEFAULT_GUIDANCE = 3;
export const DEFAULT_NEGATIVE_PROMPT = 'blurry, distorted, low quality';

/**
 * Checks a generation request and returns it with the worker's size, step count, guidance and
 * negative prompt. `resolution`, `quality`, `guidance` and `negative_prompt` are optional.
 */
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
  if (data.keyframes !== undefined) {
    if (!data.image) throw Error('Keyframes need a starting image');
    if (!Array.isArray(data.keyframes) || data.keyframes.length > MAX_KEYFRAMES - 1) {
      throw Error(`Use up to ${MAX_KEYFRAMES} images per clip`);
    }
    if (!data.keyframes.every((image) => typeof image === 'string' && IMAGE_DATA_URL.test(image))) {
      throw Error('Image must be PNG, JPG, or WebP');
    }
    if (data.frames < 8 * data.keyframes.length + 1) {
      throw Error('Choose a longer clip for this many images');
    }
  }
  const resolution = data.resolution ?? 'preview';
  if (!Object.hasOwn(SIZES, resolution)) throw Error('Choose a supported resolution');
  if (data.frames > (MAX_FRAMES[resolution] ?? Infinity)) {
    throw Error('Large clips can be up to 5 seconds. Choose Medium or Preview for longer ones.');
  }
  const quality = data.quality ?? 'standard';
  if (!Object.hasOwn(QUALITY_STEPS, quality)) throw Error('Choose a supported quality');
  const guidance = data.guidance ?? DEFAULT_GUIDANCE;
  if (typeof guidance !== 'number' || !(guidance >= 1 && guidance <= 10)) {
    throw Error('Prompt strength must be between 1 and 10');
  }
  const negative = data.negative_prompt ?? DEFAULT_NEGATIVE_PROMPT;
  if (typeof negative !== 'string' || negative.length > 500) {
    throw Error('Keep “avoid” under 500 characters');
  }
  return {
    ...data,
    ...SIZES[resolution][ratio],
    resolution,
    quality,
    steps: QUALITY_STEPS[quality],
    guidance,
    negative_prompt: negative.trim(),
  };
}
