// A music track that plays under the whole sequence: in step with the preview, and mixed into
// MP4 exports with WebCodecs. The track starts with the first shot, stops at the end of the last,
// and fades out over its final FADE_OUT_SECONDS.

export const FADE_OUT_SECONDS = 1.5;
export const MUSIC_DATA_URL = /^data:audio\/(mpeg|mp3|mp4|x-m4a|aac|wav|x-wav|wave|ogg|webm|flac);base64,/;
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BITRATE = 192_000;
// AAC plays everywhere; Opus-in-MP4 is the fallback for browsers that can't encode AAC.
const AUDIO_CODECS = [
  { codec: 'mp4a.40.2', muxer: 'aac' },
  { codec: 'opus', muxer: 'opus' },
];

/** Music volume (0–1) at sequence time `t`, fading out at the end of the video. */
export function musicGain(t, duration, volume) {
  const remaining = duration - t;
  if (remaining <= 0) return 0;
  return volume * Math.min(1, remaining / FADE_OUT_SECONDS);
}

/** Loads a music track from a data URL. Resolves with {name, source, element, volume}. */
export function loadMusic(source, name, volume = 0.8) {
  const element = new Audio();
  element.preload = 'auto';
  return new Promise((resolve, reject) => {
    element.addEventListener('loadedmetadata', () => resolve({ name, source, element, volume }), {
      once: true,
    });
    element.addEventListener('error', () => reject(Error('This audio file could not be played')), {
      once: true,
    });
    element.src = source;
  });
}

/** Keeps the preview's music at sequence time `t`, playing or paused with the editor. */
export function syncMusic(music, t, { playing, duration }) {
  if (!music) return;
  const { element } = music;
  const inside = t < Math.min(duration, element.duration || 0);
  element.volume = musicGain(t, duration, music.volume);
  if (playing && inside) {
    // Re-align only when it drifts audibly, so playback isn't interrupted every frame.
    if (element.paused || Math.abs(element.currentTime - t) > 0.25) element.currentTime = t;
    if (element.paused) element.play().catch(() => {});
  } else if (!element.paused) {
    element.pause();
  }
}

/** The first audio codec this browser can encode for MP4, or null. */
export async function findAudioCodec() {
  if (!window.AudioEncoder || !window.AudioData) return null;
  for (const option of AUDIO_CODECS) {
    try {
      const { supported } = await AudioEncoder.isConfigSupported({
        codec: option.codec,
        sampleRate: SAMPLE_RATE,
        numberOfChannels: CHANNELS,
        bitrate: BITRATE,
      });
      if (supported) return option;
    } catch {}
  }
  return null;
}

export const muxerAudioConfig = (codec) => ({
  codec: codec.muxer,
  sampleRate: SAMPLE_RATE,
  numberOfChannels: CHANNELS,
});

/** Renders the track as the export will play it: trimmed to `duration`, at volume, faded out. */
async function renderMix(music, duration) {
  const encoded = await (await fetch(music.source)).arrayBuffer();
  const length = Math.ceil(duration * SAMPLE_RATE);
  const context = new OfflineAudioContext(CHANNELS, length, SAMPLE_RATE);
  const source = context.createBufferSource();
  source.buffer = await context.decodeAudioData(encoded);
  const gain = context.createGain();
  gain.gain.setValueAtTime(musicGain(0, duration, music.volume), 0);
  const fadeStart = Math.max(0, duration - FADE_OUT_SECONDS);
  gain.gain.setValueAtTime(musicGain(fadeStart, duration, music.volume), fadeStart);
  gain.gain.linearRampToValueAtTime(0, duration);
  source.connect(gain).connect(context.destination);
  source.start(0);
  return context.startRendering();
}

/** Encodes the music for `duration` seconds and adds it to an mp4-muxer `muxer`. */
export async function encodeMusic(music, duration, codec, muxer) {
  const mix = await renderMix(music, duration);
  let failure = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => (failure = error),
  });
  encoder.configure({
    codec: codec.codec,
    sampleRate: SAMPLE_RATE,
    numberOfChannels: CHANNELS,
    bitrate: BITRATE,
  });
  const channels = Array.from({ length: CHANNELS }, (_, c) => mix.getChannelData(c));
  const FRAMES = 1024;
  for (let start = 0; start < mix.length; start += FRAMES) {
    if (failure) throw failure;
    const frames = Math.min(FRAMES, mix.length - start);
    const data = new Float32Array(frames * CHANNELS);
    channels.forEach((samples, c) => data.set(samples.subarray(start, start + frames), c * frames));
    const audio = new AudioData({
      format: 'f32-planar',
      sampleRate: SAMPLE_RATE,
      numberOfFrames: frames,
      numberOfChannels: CHANNELS,
      timestamp: Math.round((start / SAMPLE_RATE) * 1e6),
      data,
    });
    encoder.encode(audio);
    audio.close();
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
}
