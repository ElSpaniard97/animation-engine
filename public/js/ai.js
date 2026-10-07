import { $ } from './dom.js';
import { imageToPngDataUrl } from './files.js';
import { refreshGallery } from './gallery.js';

const POLL_MS = 1500;
let jobId = null;

function status(text) {
  $('aiStatus').textContent = text;
}

function setBusy(busy) {
  for (const id of ['generate', 'prompt', 'aiMode', 'aiFrames', 'aiSeed']) $(id).disabled = busy;
  $('cancel').hidden = !busy;
}

async function generate(editor) {
  const prompt = $('prompt').value.trim();
  if (!prompt) return status('Describe your shot first.');
  setBusy(true);
  $('aiDownload').hidden = true;
  try {
    const payload = {
      prompt,
      ratio: $('ratio').value,
      frames: +$('aiFrames').value,
      seed: +$('aiSeed').value,
    };
    if ($('aiMode').value === 'image') {
      if (editor.video || !editor.image.naturalWidth)
        throw Error('Upload an image before using image-to-video.');
      payload.image = imageToPngDataUrl(editor.image);
    }
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Generation could not start');
    jobId = data.id;
    status('Starting local GPU…');
    refreshGallery();
    poll(editor);
  } catch (error) {
    status(error.message);
    setBusy(false);
  }
}

async function poll(editor) {
  if (!jobId) return;
  try {
    const response = await fetch('/api/jobs/' + jobId);
    const job = await response.json();
    if (!response.ok) throw Error(job.error);
    status(job.stage + (job.total ? ' · ' + job.step + '/' + job.total : ''));
    if (job.status === 'running') {
      setTimeout(() => poll(editor), POLL_MS);
      return;
    }
    setBusy(false);
    jobId = null;
    if (job.status === 'complete') {
      $('aiDownload').href = job.url;
      $('aiDownload').hidden = false;
      await editor.loadVideo(job.url);
    }
    refreshGallery();
  } catch (error) {
    status('Status unavailable: ' + error.message + '. Reload to check the current job.');
    setBusy(false);
  }
}

async function cancel() {
  if (!jobId) return;
  try {
    const response = await fetch('/api/jobs/' + jobId + '/cancel', { method: 'POST' });
    if (!response.ok) throw Error();
    status('Cancelling…');
  } catch {
    status('Could not cancel. Check the current job before retrying.');
  }
}

/** Wires the Local AI Generation panel and resumes watching a job that is already running. */
export function initAi(editor) {
  $('generate').onclick = () => generate(editor);
  $('cancel').onclick = cancel;
  fetch('/api/engine')
    .then((response) => response.json())
    .then((engine) => {
      if (engine.active) {
        jobId = engine.active;
        setBusy(true);
        poll(editor);
      } else if (!engine.installed) {
        status('Local runtime needs installation. See README.');
      }
    })
    .catch(() => status('Start the local app server to use AI generation.'));
}
