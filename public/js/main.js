import { initAi } from './ai.js';
import { $ } from './dom.js';
import { exportVideo } from './export.js';
import { blobToDataUrl, download } from './files.js';
import { parseProject, schemaFromControls, serializeProject } from './project.js';
import { OUTPUT_SIZES, drawFrame } from './renderer.js';

const SETTING_KEYS = ['motion', 'strength', 'effect', 'density', 'vignette', 'ratio', 'duration', 'title'];
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

/** Shared editor state. The export and AI modules read and update it through this object. */
const editor = {
  canvas,
  image: new Image(),
  video: null,
  source: 'assets/knight.png',
  name: 'The returning knight',
  playing: false,
  exporting: false,
  recording: null,
  t: 0,
  message,
  draw,
  loadVideo,
};

function message(text) {
  $('status').textContent = text;
}

/** The form's settings as saved in project files (form values, so numbers are strings). */
function settings() {
  return Object.fromEntries(
    SETTING_KEYS.map((k) => [k, $(k).type === 'checkbox' ? $(k).checked : $(k).value]),
  );
}

function renderSettings() {
  const s = settings();
  return { ...s, strength: +s.strength, density: +s.density, duration: +s.duration };
}

const duration = () => +$('duration').value;
const formatTime = (seconds) => '00:' + String(seconds).padStart(2, '0');

function setName(name) {
  editor.name = name;
  $('filename').textContent = name;
  $('clipName').textContent = name;
}

function draw() {
  const { image, video } = editor;
  drawFrame(ctx, {
    t: editor.t,
    settings: renderSettings(),
    media: video || image,
    mediaWidth: video ? video.videoWidth : image.naturalWidth,
    mediaHeight: video ? video.videoHeight : image.naturalHeight,
  });
  $('scrub').value = (editor.t / duration()) * 1000;
  $('time').textContent = formatTime(Math.floor(editor.t));
}

function update() {
  const [w, h] = OUTPUT_SIZES[$('ratio').value];
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  $('resolution').textContent = w + ' × ' + h;
  $('strengthValue').textContent = $('strength').value + '%';
  $('densityValue').textContent = $('density').value + '%';
  $('length').textContent = formatTime($('duration').value);
  $('clipLength').textContent = $('duration').value + 's';
  $('clipDetails').textContent =
    $('motion').selectedOptions[0].text + ' · ' + $('effect').selectedOptions[0].text;
  editor.t = Math.min(editor.t, duration());
  draw();
}

let lastFrame = 0;
function tick(timestamp) {
  const dt = Math.min((timestamp - lastFrame) / 1000, 0.1);
  lastFrame = timestamp;
  if (editor.playing) {
    const { video } = editor;
    editor.t += dt;
    // Preview loops a generated clip at its own length; export keeps it looping until the end.
    if (video && !editor.exporting && editor.t >= video.duration) {
      editor.t = 0;
      video.currentTime = 0;
    }
    if (editor.t >= duration()) {
      if (editor.exporting) {
        editor.t = duration();
        editor.playing = false;
        editor.recording.stop();
      } else {
        editor.t = 0;
        if (video) video.currentTime = 0;
      }
    }
    draw();
  }
  requestAnimationFrame(tick);
}

function stopPlayback() {
  editor.t = 0;
  editor.playing = false;
  $('play').textContent = '▶';
}

function loadImage(data, name) {
  $('thumb').hidden = false;
  if (editor.video) {
    editor.video.pause();
    editor.video = null;
  }
  editor.source = data;
  setName(name);
  $('thumb').src = data;
  stopPlayback();
  editor.image.src = data;
}

async function loadVideo(url) {
  editor.playing = false;
  editor.t = 0;
  editor.video?.pause();
  const video = document.createElement('video');
  editor.video = video;
  video.src = url;
  video.muted = true;
  video.loop = false;
  video.playsInline = true;
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = reject;
    video.load();
  });
  setName('Generated shot');
  $('motion').value = 'still';
  $('effect').value = 'none';
  $('vignette').checked = false;
  update();
  message('Generated clip loaded. Press play to preview, or download the original MP4.');
}

async function saveProject() {
  if (editor.video) return message('Video projects cannot be saved yet. Export the finished video instead.');
  let artwork = editor.source;
  if (!artwork.startsWith('data:')) {
    try {
      const response = await fetch(artwork);
      if (!response.ok) throw Error();
      artwork = await blobToDataUrl(await response.blob());
    } catch {
      return message('Artwork could not be included. Try uploading it again.');
    }
  }
  const json = serializeProject({ name: editor.name, artwork, settings: settings() });
  download(new Blob([json], { type: 'application/json' }), 'animation-engine-project.json');
  message('Project downloaded with its artwork and settings.');
}

async function openProject(file) {
  try {
    const controls = Object.fromEntries(SETTING_KEYS.map((k) => [k, $(k)]));
    const project = parseProject(await file.text(), schemaFromControls(controls));
    for (const k of SETTING_KEYS) {
      if ($(k).type === 'checkbox') $(k).checked = project.settings[k];
      else $(k).value = project.settings[k];
    }
    loadImage(project.artwork, project.name);
    update();
  } catch {
    message('This project is not valid. Open a project saved by Animation Engine.');
  }
}

function uploadArtwork(file) {
  if (!file.type.startsWith('image/')) return message('Choose an image file.');
  if (file.size > 25 * 1024 * 1024) return message('Choose an image smaller than 25 MB.');
  const reader = new FileReader();
  reader.onload = () => loadImage(reader.result, file.name.replace(/\.[^.]+$/, ''));
  reader.readAsDataURL(file);
}

// Lets in-browser AI agents (WebMCP) adjust the shot through the same controls a person uses.
function registerAgentTool() {
  if (!document.modelContext?.registerTool) return;
  const allowed = ['motion', 'effect', 'title'];
  try {
    Promise.resolve(
      document.modelContext.registerTool({
        name: 'configure_animation',
        description:
          'Set the camera movement, atmospheric effect, and title of the current artwork animation.',
        inputSchema: {
          type: 'object',
          properties: {
            motion: { type: 'string', enum: ['push', 'pull', 'left', 'right', 'drift', 'still'] },
            effect: { type: 'string', enum: ['embers', 'snow', 'rain', 'fog', 'none'] },
            title: { type: 'string', maxLength: 120 },
          },
          additionalProperties: false,
        },
        execute(input) {
          if (!input || typeof input !== 'object') throw Error('Invalid settings');
          for (const [k, v] of Object.entries(input)) {
            const valid =
              allowed.includes(k) &&
              typeof v === 'string' &&
              (k === 'title' ? v.length <= 120 : Array.from($(k).options).some((o) => o.value === v));
            if (!valid) throw Error('Invalid settings');
          }
          for (const [k, v] of Object.entries(input)) $(k).value = v;
          update();
          return settings();
        },
      }),
    ).catch(() => {});
  } catch {}
}

editor.image.onload = () => {
  update();
  message('Ready. Adjust the shot, then press play.');
};
editor.image.onerror = () => {
  setName('Untitled shot');
  $('thumb').hidden = true;
  draw();
  message('Upload artwork or generate a shot to begin.');
};
editor.image.src = editor.source;

SETTING_KEYS.forEach((k) => $(k).addEventListener('input', update));
$('play').onclick = () => {
  if (editor.exporting) return;
  editor.playing = !editor.playing;
  $('play').textContent = editor.playing ? 'Ⅱ' : '▶';
  if (!editor.video) return;
  if (editor.playing) editor.video.play().catch(() => message('Press play again to start the clip.'));
  else editor.video.pause();
};
$('restart').onclick = () => {
  editor.t = 0;
  if (editor.video) editor.video.currentTime = 0;
  draw();
};
$('scrub').oninput = () => {
  if (editor.exporting) return;
  editor.t = ($('scrub').value / 1000) * duration();
  if (editor.video) editor.video.currentTime = Math.min(editor.t, editor.video.duration || 0);
  draw();
};
$('upload').onchange = (e) => {
  const file = e.target.files[0];
  if (file) uploadArtwork(file);
};
$('save').onclick = saveProject;
$('open').onchange = (e) => {
  const file = e.target.files[0];
  if (file) openProject(file);
};
$('export').onclick = () => exportVideo(editor);

requestAnimationFrame(tick);
registerAgentTool();
initAi(editor);
