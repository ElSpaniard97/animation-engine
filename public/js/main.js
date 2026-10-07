import { initAi } from './ai.js';
import { $ } from './dom.js';
import { describeExportFormat, exportVideo } from './export.js';
import { blobToDataUrl, download } from './files.js';
import { initGallery, refreshGallery } from './gallery.js';
import { parseProject, schemaFromControls, serializeProject } from './project.js';
import { OUTPUT_SIZES, drawFrame } from './renderer.js';
import { MAX_SHOTS, formatTime, frameAt, moveShot, shotStart, totalDuration } from './shots.js';

// Each shot has its own camera, atmosphere, length and title; the format applies to the sequence.
const SHOT_KEYS = ['motion', 'strength', 'effect', 'density', 'vignette', 'duration', 'transition', 'title'];
const SAMPLE_ARTWORK = 'assets/knight.png';
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

/**
 * Shared editor state. The export, AI and gallery modules read and update it through this object.
 * A shot is {name, kind: 'image' | 'video', source, media, settings}: `source` is the artwork
 * (a data URL or app path) or a generated clip's URL, `media` the element drawn from it, and
 * `settings` the form values for that shot. `t` is the time in the whole sequence.
 */
const editor = {
  canvas,
  shots: [],
  selected: 0,
  playing: false,
  exporting: false,
  recording: null,
  t: 0,
  get shot() {
    return this.shots[this.selected];
  },
  /** The selected shot's image or clip, for image-to-video and the gallery. */
  get image() {
    return this.shot?.kind === 'image' ? this.shot.media : null;
  },
  get video() {
    return this.shot?.kind === 'video' ? this.shot.media : null;
  },
  get duration() {
    return totalDuration(this.shots);
  },
  message,
  draw,
  seekTo,
  loadVideo,
  addVideoShot,
};

function message(text) {
  $('status').textContent = text;
}

/** The form's shot settings (form values, so numbers are strings). */
function formSettings() {
  return Object.fromEntries(SHOT_KEYS.map((k) => [k, $(k).type === 'checkbox' ? $(k).checked : $(k).value]));
}

function showSettings(settings) {
  for (const k of SHOT_KEYS) {
    if ($(k).type === 'checkbox') $(k).checked = settings[k];
    else $(k).value = settings[k];
  }
}

const renderSettings = (s) => ({ ...s, strength: +s.strength, density: +s.density, duration: +s.duration });

const optionText = (id, value) => $(id).querySelector(`option[value="${value}"]`).text;
const describeShot = (s) =>
  [
    s.transition !== 'cut' && optionText('transition', s.transition),
    optionText('motion', s.motion),
    optionText('effect', s.effect),
  ]
    .filter(Boolean)
    .join(' · ');

/** Moves a video element to `time` and waits until that frame can be drawn. */
function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.001) return Promise.resolve();
  return new Promise((resolve, reject) => {
    video.addEventListener('seeked', resolve, { once: true });
    video.addEventListener('error', reject, { once: true });
    video.currentTime = time;
  });
}

function createVideo(url) {
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // A paused video only hands the canvas a frame once it has seeked, so redraw after every seek
  // (opening a clip, scrubbing) instead of showing a black or stale frame.
  video.addEventListener('seeked', () => {
    if (!editor.playing) draw();
  });
  video.addEventListener('loadeddata', () => draw());
  return video;
}

function createImage(source) {
  const image = new Image();
  image.onload = () => draw();
  image.src = source;
  return image;
}

function makeShot({ name, kind, source, settings }) {
  return {
    name,
    kind,
    source,
    settings,
    media: kind === 'video' ? createVideo(source) : createImage(source),
  };
}

/** Keeps generated clips in step with the playhead: only clips on screen play. */
function syncVideos(layers) {
  const visible = new Set(layers.map(({ shot }) => shot));
  for (const shot of editor.shots) {
    if (shot.kind === 'video' && !visible.has(shot) && !shot.media.paused) shot.media.pause();
  }
  for (const { shot, local } of layers) {
    if (shot.kind !== 'video') continue;
    const video = shot.media;
    if (!video.duration) continue;
    // Clips shorter than their shot loop, as in the export.
    const target = local % video.duration;
    if (editor.playing) {
      if (video.paused) {
        video.loop = true;
        video.currentTime = target;
        video.play().catch(() => {});
      }
    } else {
      if (!video.paused) video.pause();
      if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target;
    }
  }
}

/** The shots drawn at sequence time `t`, bottom first, with how opaque the top one is. */
function layersAt(t) {
  const frame = frameAt(editor.shots, t);
  const layers = [{ shot: editor.shots[frame.index], local: frame.local }];
  if (frame.previous)
    layers.unshift({ shot: editor.shots[frame.previous.index], local: frame.previous.local });
  return { frame, layers };
}

function drawShot(context, shot, local) {
  const { media } = shot;
  drawFrame(context, {
    t: local,
    settings: renderSettings(shot.settings),
    media,
    mediaWidth: shot.kind === 'video' ? media.videoWidth : media.naturalWidth,
    mediaHeight: shot.kind === 'video' ? media.videoHeight : media.naturalHeight,
  });
}

// The incoming shot of a crossfade is drawn here, then laid over the outgoing one.
const blendCanvas = document.createElement('canvas');
const blendCtx = blendCanvas.getContext('2d');

function draw() {
  if (!editor.shots.length) return;
  const total = editor.duration;
  editor.t = Math.min(editor.t, total);
  const { frame, layers } = layersAt(editor.t);
  syncVideos(layers);
  const top = layers.at(-1);
  if (frame.transition === 'crossfade') {
    blendCanvas.width = canvas.width;
    blendCanvas.height = canvas.height;
    drawShot(ctx, layers[0].shot, layers[0].local);
    drawShot(blendCtx, top.shot, top.local);
    ctx.globalAlpha = frame.mix;
    ctx.drawImage(blendCanvas, 0, 0);
    ctx.globalAlpha = 1;
  } else {
    drawShot(ctx, top.shot, top.local);
    if (frame.transition === 'fade') {
      ctx.fillStyle = `rgba(0,0,0,${1 - frame.mix})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  $('scrub').value = (editor.t / total) * 1000;
  $('time').textContent = formatTime(editor.t);
  const shot = editor.shots[frame.index];
  document.querySelectorAll('.clip-progress').forEach((bar, i) => {
    bar.style.width = i === frame.index ? (frame.local / +shot.settings.duration) * 100 + '%' : '0';
  });
}

/** Draws the frame at sequence time `t` once every clip in it has reached that frame. */
async function seekTo(t) {
  editor.t = t;
  const { layers } = layersAt(t);
  await Promise.all(
    layers
      .filter(({ shot }) => shot.kind === 'video' && shot.media.duration)
      .map(({ shot, local }) => seekVideo(shot.media, local % shot.media.duration)),
  );
  draw();
}

function thumbnail(shot) {
  if (shot.kind === 'video') {
    return Object.assign(document.createElement('video'), {
      src: shot.source + '#t=0.2',
      muted: true,
      preload: 'metadata',
    });
  }
  return Object.assign(document.createElement('img'), { src: shot.source, alt: '' });
}

/** Rebuilds the timeline strip. Clip widths follow their length so the sequence reads at a glance. */
function renderTimeline() {
  const clips = editor.shots.map((shot, i) => {
    const clip = document.createElement('button');
    clip.className = 'clip' + (i === editor.selected ? ' selected' : '');
    clip.style.flexGrow = shot.settings.duration;
    clip.setAttribute('aria-pressed', i === editor.selected);
    clip.title = shot.name;
    const text = document.createElement('div');
    const name = Object.assign(document.createElement('strong'), { textContent: shot.name });
    const details = Object.assign(document.createElement('small'), {
      textContent: describeShot(shot.settings),
    });
    text.append(name, details);
    const length = Object.assign(document.createElement('span'), {
      textContent: shot.settings.duration + 's',
    });
    const progress = Object.assign(document.createElement('i'), { className: 'clip-progress' });
    // Kept on the shot so redrawing the strip while a slider moves does not reload thumbnails.
    shot.thumb ||= thumbnail(shot);
    clip.append(shot.thumb, text, length, progress);
    clip.onclick = () => select(i);
    return clip;
  });
  $('clips').replaceChildren(...clips);
  const count = editor.shots.length;
  $('shotCount').textContent = count === 1 ? '1 shot' : count + ' shots';
  $('moveLeft').disabled = editor.selected === 0;
  $('moveRight').disabled = editor.selected === count - 1;
  $('removeShot').disabled = count === 1;
  $('addShot').disabled = count >= MAX_SHOTS;
  $('shotNumber').textContent =
    'SHOT ' + String(editor.selected + 1).padStart(2, '0') + (count > 1 ? ' OF ' + count : '');
  $('filename').textContent = editor.shot.name;
  $('length').textContent = formatTime(editor.duration);
}

/** Shows shot `index` in the form and moves the playhead to its start. */
function select(index) {
  editor.selected = index;
  showSettings(editor.shot.settings);
  update({ seek: true });
}

/** Applies the form to the selected shot (or, with `seek`, jumps to that shot first). */
function update({ seek = false } = {}) {
  if (!seek) editor.shot.settings = formSettings();
  const [w, h] = OUTPUT_SIZES[$('ratio').value];
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  $('resolution').textContent = w + ' × ' + h;
  $('strengthValue').textContent = $('strength').value + '%';
  $('densityValue').textContent = $('density').value + '%';
  renderTimeline();
  if (seek) {
    editor.t = shotStart(editor.shots, editor.selected);
    restartVideos();
  }
  draw();
}

/** Pauses every clip so the one under the playhead restarts in step after a jump. */
function restartVideos() {
  editor.shots.forEach((shot) => shot.media.pause?.());
}

function stopPlayback() {
  editor.playing = false;
  $('play').textContent = '▶';
}

/** Replaces the selected shot's media, keeping its place in the sequence. */
function replaceMedia(shot) {
  stopPlayback();
  editor.shot.media.pause?.();
  editor.shots[editor.selected] = shot;
  showSettings(shot.settings);
  update({ seek: true });
  refreshGallery();
}

function insertShot(shot) {
  stopPlayback();
  editor.shots.splice(editor.selected + 1, 0, shot);
  select(editor.selected + 1);
}

/** Settings suited to a generated clip: a locked camera, no effects, and a length that fits it. */
function clipSettings(video) {
  const lengths = Array.from($('duration').options, (o) => o.value);
  const duration = lengths.find((d) => +d >= video.duration - 0.1) || lengths.at(-1);
  return { ...editor.shot.settings, motion: 'still', effect: 'none', vignette: false, duration, title: '' };
}

async function loadClip(url) {
  const video = createVideo(url);
  await new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', resolve, { once: true });
    video.addEventListener('error', reject, { once: true });
  });
  return { name: 'Generated shot', kind: 'video', source: url, media: video, settings: clipSettings(video) };
}

/** Puts a generated clip in the selected shot. */
async function loadVideo(url) {
  replaceMedia(await loadClip(url));
  message('Generated clip loaded into this shot. Press play to preview, or download the original MP4.');
}

/** Adds a generated clip as a new shot after the selected one (or in place of the sample artwork). */
async function addVideoShot(url) {
  if (editor.shots.length === 1 && editor.shot.source === SAMPLE_ARTWORK) return loadVideo(url);
  if (editor.shots.length >= MAX_SHOTS) return message(`A sequence can hold up to ${MAX_SHOTS} shots.`);
  insertShot(await loadClip(url));
  refreshGallery();
  message('Generated clip added as a new shot.');
}

function loadImage(source, name) {
  replaceMedia(makeShot({ name, kind: 'image', source, settings: editor.shot.settings }));
}

async function artworkDataUrl(source) {
  if (source.startsWith('data:')) return source;
  const response = await fetch(source);
  if (!response.ok) throw Error();
  return blobToDataUrl(await response.blob());
}

async function saveProject() {
  const shots = [];
  for (const shot of editor.shots) {
    const saved = { name: shot.name, settings: shot.settings };
    if (shot.kind === 'video') saved.video = shot.source;
    else {
      try {
        saved.artwork = await artworkDataUrl(shot.source);
      } catch {
        return message(`Artwork for “${shot.name}” could not be included. Try uploading it again.`);
      }
    }
    shots.push(saved);
  }
  const json = serializeProject({ name: editor.shots[0].name, ratio: $('ratio').value, shots });
  download(new Blob([json], { type: 'application/json' }), 'animation-engine-project.json');
  const clips = shots.some((shot) => shot.video)
    ? ' Generated clips are linked, so keep them in your Generations.'
    : '';
  message('Project downloaded with its artwork and settings.' + clips);
}

async function openProject(file) {
  let project;
  try {
    const controls = Object.fromEntries([...SHOT_KEYS, 'ratio'].map((k) => [k, $(k)]));
    project = parseProject(await file.text(), schemaFromControls(controls));
  } catch {
    return message('This project is not valid. Open a project saved by Animation Engine.');
  }
  stopPlayback();
  restartVideos();
  editor.shots = project.shots.map((shot) =>
    makeShot({
      name: shot.name,
      kind: shot.video ? 'video' : 'image',
      source: shot.video || shot.artwork,
      settings: shot.settings,
    }),
  );
  $('ratio').value = project.ratio;
  select(0);
  refreshGallery();
  const missing = await Promise.all(
    editor.shots
      .filter((shot) => shot.kind === 'video')
      .map(
        (shot) =>
          new Promise((resolve) => {
            if (shot.media.readyState >= 2) return resolve(false);
            shot.media.addEventListener('loadeddata', () => resolve(false), { once: true });
            shot.media.addEventListener('error', () => resolve(true), { once: true });
          }),
      ),
  );
  const count = missing.filter(Boolean).length;
  message(
    count
      ? `Project opened, but ${count} generated clip${count > 1 ? 's are' : ' is'} missing from Generations.`
      : `Project opened with ${editor.shots.length} shot${editor.shots.length > 1 ? 's' : ''}.`,
  );
}

function uploadArtwork(file) {
  if (!file.type.startsWith('image/')) return message('Choose an image file.');
  if (file.size > 25 * 1024 * 1024) return message('Choose an image smaller than 25 MB.');
  const reader = new FileReader();
  reader.onload = () => {
    loadImage(reader.result, file.name.replace(/\.[^.]+$/, ''));
    message('Artwork placed in the selected shot.');
  };
  reader.readAsDataURL(file);
}

function addShot() {
  const { name, kind, source, settings } = editor.shot;
  if (editor.shots.length >= MAX_SHOTS) return;
  // Starts as a copy of the selected shot; change its artwork or settings from there.
  insertShot(makeShot({ name, kind, source, settings: { ...settings } }));
  message('Shot added. Upload artwork or adjust it to make it different.');
}

function removeShot() {
  if (editor.shots.length === 1) return;
  stopPlayback();
  const [removed] = editor.shots.splice(editor.selected, 1);
  removed.media.pause?.();
  select(Math.min(editor.selected, editor.shots.length - 1));
  refreshGallery();
}

function moveSelected(offset) {
  const to = editor.selected + offset;
  if (to < 0 || to >= editor.shots.length) return;
  editor.shots = moveShot(editor.shots, editor.selected, to);
  select(to);
}

let lastFrame = 0;
function tick(timestamp) {
  const dt = Math.min((timestamp - lastFrame) / 1000, 0.1);
  lastFrame = timestamp;
  if (editor.playing) {
    editor.t += dt;
    if (editor.t >= editor.duration) {
      if (editor.exporting) {
        editor.t = editor.duration;
        editor.playing = false;
        editor.recording.stop();
      } else {
        editor.t = 0;
      }
    }
    draw();
  }
  requestAnimationFrame(tick);
}

// Lets in-browser AI agents (WebMCP) adjust the selected shot through the controls a person uses.
function registerAgentTool() {
  if (!document.modelContext?.registerTool) return;
  const allowed = ['motion', 'effect', 'title'];
  try {
    Promise.resolve(
      document.modelContext.registerTool({
        name: 'configure_animation',
        description:
          'Set the camera movement, atmospheric effect, and title of the selected shot of the artwork animation.',
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
          return formSettings();
        },
      }),
    ).catch(() => {});
  } catch {}
}

editor.shots = [
  makeShot({
    name: 'The returning knight',
    kind: 'image',
    source: SAMPLE_ARTWORK,
    settings: formSettings(),
  }),
];
editor.shots[0].media.addEventListener('error', () => message('Upload artwork or generate a shot to begin.'));
update();

[...SHOT_KEYS, 'ratio'].forEach((k) => $(k).addEventListener('input', () => update()));
$('play').onclick = () => {
  if (editor.exporting) return;
  editor.playing = !editor.playing;
  $('play').textContent = editor.playing ? 'Ⅱ' : '▶';
  draw();
};
$('restart').onclick = () => {
  editor.t = 0;
  restartVideos();
  draw();
};
$('scrub').oninput = () => {
  if (editor.exporting) return;
  editor.t = ($('scrub').value / 1000) * editor.duration;
  restartVideos();
  draw();
};
$('upload').onchange = (e) => {
  const file = e.target.files[0];
  if (file) uploadArtwork(file);
  e.target.value = '';
};
$('save').onclick = saveProject;
$('open').onchange = (e) => {
  const file = e.target.files[0];
  if (file) openProject(file);
  e.target.value = '';
};
$('export').onclick = () => exportVideo(editor);
$('addShot').onclick = addShot;
$('removeShot').onclick = removeShot;
$('moveLeft').onclick = () => moveSelected(-1);
$('moveRight').onclick = () => moveSelected(1);

requestAnimationFrame(tick);
registerAgentTool();
initAi(editor);
initGallery(editor);
describeExportFormat();
