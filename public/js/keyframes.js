// Extra images for image-to-video: the current artwork starts the clip and these follow it, spread
// evenly to the end, so one clip can move between poses or camera angles.
import { $ } from './dom.js';
import { imageToPngDataUrl } from './files.js';

// The server allows 4 images per clip, the starting artwork included.
export const MAX_EXTRA_KEYFRAMES = 3;
// Larger than the biggest generation size, so nothing is lost, while keeping uploads small.
const KEYFRAME_SIDE = 896;
const keyframes = [];

function decode(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(imageToPngDataUrl(image, KEYFRAME_SIDE));
    image.onerror = () => reject(Error(`${file.name} could not be read as an image.`));
    image.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

function render() {
  const list = $('keyframeList');
  list.replaceChildren(
    ...keyframes.map((source, i) => {
      const item = document.createElement('figure');
      item.className = 'keyframe';
      const img = document.createElement('img');
      img.src = source;
      img.alt = `Keyframe ${i + 2}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Remove this image';
      remove.setAttribute('aria-label', `Remove keyframe ${i + 2}`);
      remove.onclick = () => {
        keyframes.splice(i, 1);
        render();
      };
      item.append(img, remove);
      return item;
    }),
  );
  $('addKeyframe').hidden = keyframes.length >= MAX_EXTRA_KEYFRAMES;
}

/** The extra keyframe images as PNG data URLs, in clip order. */
export const keyframeImages = () => [...keyframes];

/** Shows the keyframe row only while animating an image. */
export function showKeyframes(visible) {
  $('keyframes').hidden = !visible;
}

/** Wires the Add image button; `report` shows a message in the panel. */
export function initKeyframes(report) {
  $('keyframeUpload').onchange = async (e) => {
    const files = Array.from(e.target.files).filter((file) => file.type.startsWith('image/'));
    e.target.value = '';
    const room = MAX_EXTRA_KEYFRAMES - keyframes.length;
    if (files.length > room)
      report(`Only ${MAX_EXTRA_KEYFRAMES + 1} images fit in one clip, so the rest were skipped.`);
    for (const file of files.slice(0, room)) {
      try {
        keyframes.push(await decode(file));
      } catch (error) {
        report(error.message);
      }
    }
    render();
  };
  render();
}
