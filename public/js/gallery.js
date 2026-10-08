import { $ } from './dom.js';

const LENGTHS = { 9: '0.4s', 25: '1s', 49: '2s', 121: '5s', 241: '10s' };
const QUALITIES = { draft: 'draft', high: 'high quality' };
let editor;

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function describe(job) {
  const size = job.width ? `${job.width}×${job.height}` : job.ratio;
  const parts = [`Seed ${job.seed}`, LENGTHS[job.frames] || `${job.frames} frames`, size];
  if (QUALITIES[job.quality]) parts.push(QUALITIES[job.quality]);
  if (job.mode === 'image') parts.push(job.images > 1 ? `from ${job.images} images` : 'from image');
  return parts.join(' · ');
}

function preview(job) {
  if (job.status !== 'complete') {
    const labels = { running: 'Generating…', queued: `Queued · #${job.position}`, cancelled: 'Cancelled' };
    const label = labels[job.status] || 'Failed';
    return el('div', { className: 'gen-preview', textContent: label });
  }
  // #t= asks the browser to show a frame from inside the clip instead of a blank first frame.
  const video = el('video', { src: job.url + '#t=0.2', muted: true, preload: 'metadata', playsInline: true });
  video.setAttribute('aria-label', 'Preview of ' + job.prompt);
  video.onmouseenter = () => video.play().catch(() => {});
  video.onmouseleave = () => video.pause();
  return el('div', { className: 'gen-preview' }, [video]);
}

/** Copies a generation's prompt and settings back into the Local AI Generation form. */
function reuse(job) {
  $('prompt').value = job.prompt;
  $('aiSeed').value = job.seed;
  $('aiFrames').value = String(job.frames);
  $('aiMode').value = job.mode;
  $('prompt').dispatchEvent(new Event('input')); // Refreshes the prompt tip for this mode.
  $('aiQuality').value = job.quality;
  $('aiResolution').value = job.resolution;
  $('aiResolution').dispatchEvent(new Event('change'));
  $('aiGuidance').value = job.guidance;
  $('aiGuidance').dispatchEvent(new Event('input'));
  $('aiNegative').value = job.negative_prompt;
  $('ratio').value = job.ratio;
  $('ratio').dispatchEvent(new Event('input'));
  $('prompt').focus();
  editor.message('Settings copied from the generation. Pick a new seed for a variation.');
}

async function open(job) {
  await editor.loadVideo(job.url);
  $('aiDownload').href = job.url;
  $('aiDownload').hidden = false;
  refreshGallery();
}

async function cancel(job) {
  try {
    const response = await fetch('/api/jobs/' + job.id + '/cancel', { method: 'POST' });
    if (!response.ok) throw Error((await response.json()).error);
    editor.message('Generation cancelled.');
  } catch (error) {
    editor.message('Could not cancel: ' + error.message);
  }
  refreshGallery();
}

async function remove(job) {
  if (!confirm('Delete this generation and its video file?')) return;
  try {
    const response = await fetch('/api/jobs/' + job.id + '/delete', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    editor.message('Generation deleted.');
  } catch (error) {
    editor.message('Could not delete: ' + error.message);
  }
  refreshGallery();
}

function card(job) {
  const current = Boolean(job.url && editor.video?.src.endsWith(job.url));
  const actions = [];
  if (job.status === 'complete') {
    actions.push(
      el('button', {
        textContent: current ? 'In shot' : 'Use',
        title: 'Put this clip in the selected shot',
        disabled: current,
        onclick: () => open(job),
      }),
      el('button', {
        textContent: '+ Shot',
        title: 'Add this clip as a new shot after the selected one',
        onclick: () => editor.addVideoShot(job.url),
      }),
    );
  }
  actions.push(
    el('button', { textContent: 'Reuse', title: 'Copy the prompt and settings', onclick: () => reuse(job) }),
  );
  if (job.status === 'running' || job.status === 'queued')
    actions.push(el('button', { textContent: 'Cancel', onclick: () => cancel(job) }));
  else actions.push(el('button', { textContent: 'Delete', onclick: () => remove(job) }));

  const meta = el('div', { className: 'gen-meta', textContent: describe(job) });
  const body = [el('p', { className: 'gen-prompt', textContent: job.prompt, title: job.prompt }), meta];
  if (job.status === 'failed')
    body.push(el('div', { className: 'gen-meta failed', textContent: job.stage.slice(0, 160) }));
  body.push(el('div', { className: 'gen-actions' }, actions));
  return el('li', { className: 'gen' + (current ? ' current' : '') }, [
    preview(job),
    el('div', { className: 'gen-body' }, body),
  ]);
}

let shown = '';

/** Shows `jobs`, rebuilding the cards only when something a card shows has changed. */
export function renderGallery(jobs) {
  const loaded = editor.video?.src ?? '';
  const signature = JSON.stringify([loaded, jobs.map((job) => [job.id, job.status, job.position])]);
  if (signature === shown) return;
  shown = signature;
  $('gallery').hidden = jobs.length === 0;
  $('galleryCount').textContent = jobs.length === 1 ? '1 clip' : jobs.length + ' clips';
  $('galleryGrid').replaceChildren(...jobs.map(card));
}

/** Reloads the list of generations from the server. */
export async function refreshGallery() {
  try {
    const response = await fetch('/api/jobs');
    if (!response.ok) return;
    shown = ''; // An explicit refresh always redraws, e.g. after the loaded clip changes.
    renderGallery((await response.json()).jobs);
  } catch {
    // Without the server there is nothing to list; the AI panel already says so.
  }
}

export function initGallery(app) {
  editor = app;
  refreshGallery();
}
