import { $ } from './dom.js';
import { encodeMusic, findAudioCodec, muxerAudioConfig } from './audio.js';
import { download } from './files.js';

const FPS = 30;
const BITRATE = 8_000_000;
const KEYFRAME_EVERY = FPS * 2;
const WEBM_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
// H.264 plays everywhere (QuickTime, Photos, phones); VP9-in-MP4 is the fallback for browsers
// that can't encode H.264, such as open-source Chromium builds.
const MP4_CODECS = [
  { codec: 'avc1.640028', muxer: 'avc' },
  { codec: 'vp09.00.40.08', muxer: 'vp9' },
];

function describeLength(editor) {
  const shots = editor.shots.length;
  return `${editor.duration} seconds` + (shots > 1 ? ` · ${shots} shots` : '');
}

function setControlsDisabled(disabled) {
  document.querySelectorAll('button,input,select').forEach((el) => (el.disabled = disabled));
}

/** The first MP4 codec this browser can encode at the given size, or null. */
export async function findMp4Codec(width, height) {
  if (!window.VideoEncoder || !window.VideoFrame) return null;
  for (const option of MP4_CODECS) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec: option.codec,
        width,
        height,
        bitrate: BITRATE,
        framerate: FPS,
      });
      if (supported) return option;
    } catch {}
  }
  return null;
}

/** Shows which format Export will produce. */
export async function describeExportFormat() {
  const mp4 = await findMp4Codec(1280, 720);
  const audio = mp4 && (await findAudioCodec()) ? 'music included' : 'no audio';
  $('exportFormat').textContent = `Export: ${mp4 ? 'MP4' : 'WebM'} video · ${FPS} fps · ${audio}`;
}

/**
 * Renders the shot frame by frame with WebCodecs and muxes it into an MP4. Each frame is drawn at
 * its exact time, so the result doesn't depend on playback speed or the tab being visible, and it
 * usually finishes faster than real time.
 */
async function exportMp4(editor, codec) {
  const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer/mp4-muxer.mjs');
  const { width, height } = editor.canvas;
  const { duration } = editor;
  const frameCount = Math.round(duration * FPS);
  const audioCodec = editor.music ? await findAudioCodec() : null;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: codec.muxer, width, height, frameRate: FPS },
    audio: audioCodec ? muxerAudioConfig(audioCodec) : undefined,
    fastStart: 'in-memory',
  });
  if (audioCodec) {
    editor.message('Exporting MP4… mixing music');
    await encodeMusic(editor.music, duration, audioCodec, muxer);
  }
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => (failure = error),
  });
  encoder.configure({ codec: codec.codec, width, height, bitrate: BITRATE, framerate: FPS });

  for (let i = 0; i < frameCount; i++) {
    if (failure) throw failure;
    await editor.seekTo(i / FPS);
    const frame = new VideoFrame(editor.canvas, { timestamp: (i * 1e6) / FPS, duration: 1e6 / FPS });
    encoder.encode(frame, { keyFrame: i % KEYFRAME_EVERY === 0 });
    frame.close();
    // Let the encoder catch up instead of queueing every frame in memory.
    while (encoder.encodeQueueSize > 8) await new Promise((resolve) => setTimeout(resolve, 5));
    if (i % 15 === 0) editor.message(`Exporting MP4… ${Math.round((i / frameCount) * 100)}%`);
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  download(new Blob([muxer.target.buffer], { type: 'video/mp4' }), 'animation-engine-shot.mp4');
  const sound = audioCodec
    ? 'with music'
    : editor.music
      ? 'no audio (this browser cannot encode it)'
      : 'no audio';
  editor.message(`Video downloaded. MP4 · ${describeLength(editor)} · ${sound}.`);
}

/**
 * Fallback for browsers without WebCodecs: records the shot in real time with MediaRecorder.
 * Playback drives the recording; the editor's tick loop calls `editor.recording.stop()` at the end.
 */
function recordWebm(editor, mime) {
  return new Promise((resolve, reject) => {
    const stream = editor.canvas.captureStream(FPS);
    const chunks = [];
    const recording = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
    const stopTracks = () => stream.getTracks().forEach((track) => track.stop());
    editor.recording = recording;
    recording.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recording.onstop = () => {
      stopTracks();
      download(new Blob(chunks, { type: mime }), 'animation-engine-shot.webm');
      editor.message(`Video downloaded. WebM · ${describeLength(editor)} · no audio.`);
      resolve();
    };
    recording.onerror = () => {
      stopTracks();
      reject(Error('Recording failed'));
    };
    recording.start();
    // The editor's playback loop plays generated clips along with the sequence.
    editor.playing = true;
    editor.message('Exporting your video in real time. Keep this tab visible.');
  });
}

export async function exportVideo(editor) {
  if (editor.exporting) return;
  const codec = await findMp4Codec(editor.canvas.width, editor.canvas.height);
  const webm =
    !codec && window.MediaRecorder && editor.canvas.captureStream
      ? WEBM_TYPES.find((m) => MediaRecorder.isTypeSupported(m))
      : null;
  if (!codec && !webm)
    return editor.message('Video export is unavailable in this browser. Try Chrome or Edge.');

  editor.exporting = true;
  editor.playing = false;
  $('play').textContent = '▶';
  await editor.seekTo(0);
  setControlsDisabled(true);
  try {
    if (codec) await exportMp4(editor, codec);
    else await recordWebm(editor, webm);
  } catch {
    editor.message('Export failed. Try again in Chrome or Edge.');
  } finally {
    editor.exporting = false;
    editor.playing = false;
    editor.shots.forEach((shot) => shot.media.pause?.());
    await editor.seekTo(0).catch(() => {});
    setControlsDisabled(false);
  }
}
