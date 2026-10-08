import { $ } from './dom.js';
import { imageToPngDataUrl } from './files.js';
import { renderGallery } from './gallery.js';
import { promptTip } from './prompt-tips.js';

const POLL_MS = 1500;
const MAX_SEED = 2147483647;
const FORM_IDS = [
  'prompt',
  'aiMode',
  'aiFrames',
  'aiSeed',
  'randomSeed',
  'aiQuality',
  'aiResolution',
  'aiGuidance',
  'aiNegative',
];
const mine = new Set();
let watching = false;
let checkNow = () => {};
let runningId = null;

function status(text) {
  $('aiStatus').textContent = text;
}

/** Locks the form only while a request is being sent; generations can be queued back to back. */
function setSubmitting(submitting) {
  for (const id of [...FORM_IDS, 'generate']) $(id).disabled = submitting;
}

/** Updates the panel for the current queue: what is running, how many wait, and the buttons. */
function showQueue(jobs) {
  const running = jobs.find((job) => job.status === 'running');
  const waiting = jobs.filter((job) => job.status === 'queued').length;
  runningId = running?.id ?? null;
  $('cancel').hidden = !running;
  $('generate').textContent = running || waiting ? 'Add to queue' : 'Generate on my GPU';
  if (!running && !waiting) return;
  const parts = [];
  if (running) parts.push(running.stage + (running.total ? ` · ${running.step}/${running.total}` : ''));
  if (waiting) parts.push(`${waiting} waiting`);
  status(parts.join(' · '));
}

/** Polls the job list while anything runs or waits, and picks up the clips this page queued. */
async function watch(editor) {
  if (watching) return checkNow(); // Show a newly queued job without waiting for the next poll.
  watching = true;
  try {
    while (true) {
      const response = await fetch('/api/jobs');
      if (!response.ok) throw Error('the server did not answer');
      const { jobs } = await response.json();
      renderGallery(jobs);
      showQueue(jobs);
      // Oldest first, so clips join the timeline in the order they were requested.
      for (const job of [...jobs].reverse()) {
        if (!mine.has(job.id) || job.status === 'running' || job.status === 'queued') continue;
        mine.delete(job.id);
        if (job.status === 'complete') {
          $('aiDownload').href = job.url;
          $('aiDownload').hidden = false;
          await editor.addVideoShot(job.url);
          status('Generated clip added to the timeline.');
        } else {
          status(job.status === 'cancelled' ? 'Generation cancelled.' : job.stage);
        }
      }
      if (!jobs.some((job) => job.status === 'running' || job.status === 'queued')) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, POLL_MS);
        checkNow = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      checkNow = () => {};
    }
  } catch (error) {
    status('Status unavailable: ' + error.message + '. Reload to check your generations.');
  } finally {
    watching = false;
  }
}

async function generate(editor) {
  const prompt = $('prompt').value.trim();
  if (!prompt) return status('Describe your shot first.');
  setSubmitting(true);
  try {
    const payload = {
      prompt,
      ratio: $('ratio').value,
      frames: +$('aiFrames').value,
      seed: +$('aiSeed').value,
      resolution: $('aiResolution').value,
      quality: $('aiQuality').value,
      guidance: +$('aiGuidance').value,
      negative_prompt: $('aiNegative').value,
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
    // Clips this page asked for are added to the timeline when they finish.
    mine.add(data.id);
    status(data.status === 'queued' ? `Added to the queue (#${data.position}).` : 'Starting local GPU…');
    watch(editor);
  } catch (error) {
    status(error.message);
  } finally {
    setSubmitting(false);
  }
}

/** Cancels the generation that is running now; queued ones are cancelled from the gallery. */
async function cancel() {
  if (!runningId) return;
  try {
    const response = await fetch('/api/jobs/' + runningId + '/cancel', { method: 'POST' });
    if (!response.ok) throw Error();
    status('Cancelling…');
  } catch {
    status('Could not cancel. Check the current job before retrying.');
  }
}

function showTip() {
  const tip = promptTip($('prompt').value, $('aiMode').value);
  $('promptTip').textContent = tip;
  $('promptTip').hidden = !tip;
}

/** Wires the Local AI Generation panel and resumes watching any queue that is already going. */
export function initAi(editor) {
  $('generate').onclick = () => generate(editor);
  $('cancel').onclick = cancel;
  $('randomSeed').onclick = () => ($('aiSeed').value = Math.floor(Math.random() * (MAX_SEED + 1)));
  $('aiGuidance').oninput = () => ($('aiGuidanceValue').textContent = $('aiGuidance').value);
  $('prompt').oninput = showTip;
  $('aiMode').onchange = () => {
    // Still images barely move at the smallest size, so animating one starts at Medium.
    if ($('aiMode').value === 'image' && $('aiResolution').value === 'preview')
      $('aiResolution').value = 'medium';
    showTip();
  };
  fetch('/api/engine')
    .then((response) => response.json())
    .then((engine) => {
      if (engine.model === 'distilled') {
        // The distilled model runs its own fixed schedule without guidance, so these do nothing.
        $('aiQuality').closest('label').hidden = true;
        document.querySelector('.advanced').hidden = true;
        status('LTX-Video 0.9.8 distilled · local inference · first run downloads the model.');
      }
      if (!engine.installed) status('Local runtime needs installation. See README.');
      watch(editor);
    })
    .catch(() => status('Start the local app server to use AI generation.'));
}
