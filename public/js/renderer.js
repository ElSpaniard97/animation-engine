// Draws one frame of a shot. Pure apart from the canvas context it is given, so preview, export
// and future off-screen rendering all produce the same pixels for the same time and settings.

export { OUTPUT_SIZES } from './quality.js';

/** Zoom and offset of the artwork for a camera move at progress `p` (0–1) through the shot. */
export function cameraTransform(motion, strength, p, width, height) {
  let zoom = 1 + strength;
  let x = 0;
  let y = 0;
  switch (motion) {
    case 'push':
      zoom = 1 + strength * p;
      break;
    case 'pull':
      zoom = 1 + strength * (1 - p);
      break;
    case 'left':
      x = (0.5 - p) * width * strength * 0.75;
      break;
    case 'right':
      x = (p - 0.5) * width * strength * 0.75;
      break;
    case 'drift':
      x = Math.sin(p * Math.PI * 2) * width * strength * 0.22;
      y = Math.cos(p * Math.PI * 2) * height * strength * 0.12;
      break;
    case 'still':
      zoom = 1;
      break;
  }
  return { zoom, x, y };
}

function drawMedia(ctx, media, mediaWidth, mediaHeight, settings, p) {
  const { width: w, height: h } = ctx.canvas;
  const { zoom, x, y } = cameraTransform(settings.motion, settings.strength / 100, p, w, h);
  // Cover the frame, then apply the camera move.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const scale = Math.max(w / mediaWidth, h / mediaHeight) * zoom;
  ctx.drawImage(
    media,
    (w - mediaWidth * scale) / 2 + x,
    (h - mediaHeight * scale) / 2 + y,
    mediaWidth * scale,
    mediaHeight * scale,
  );
}

function drawParticles(ctx, effect, density, t) {
  const { width: w, height: h } = ctx.canvas;
  const count = Math.round(density * 1.8);
  const speed = effect === 'snow' ? 45 : effect === 'rain' ? 600 : -38;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const seed = Math.abs((Math.sin(i * 127.1 + 17) * 43758.5453) % 1);
    const x = (((seed * w + Math.sin(t * 0.6 + i) * 25) % w) + w) % w;
    const y = (((i * 79.31 + t * speed) % h) + h) % h;
    ctx.globalAlpha = 0.25 + 0.45 * Math.abs(Math.sin(i + t));
    if (effect === 'embers' || effect === 'snow') {
      ctx.fillStyle = effect === 'embers' ? '#ffc086' : '#d9e9ff';
      ctx.beginPath();
      ctx.arc(x, y, effect === 'embers' ? 1 + seed * 3 : 1 + seed * 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (effect === 'rain') {
      ctx.strokeStyle = '#b6d0e5';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 12, y + 40);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawFog(ctx, density, t) {
  const { width: w, height: h } = ctx.canvas;
  for (let i = 0; i < 4; i++) {
    const x = w * (0.1 + i * 0.28) + Math.sin(t * 0.3 + i) * w * 0.15;
    const y = h * (0.65 + i * 0.07);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, w * 0.65);
    gradient.addColorStop(0, 'rgba(184,204,215,' + density / 500 + ')');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawVignette(ctx) {
  const { width: w, height: h } = ctx.canvas;
  const gradient = ctx.createRadialGradient(w / 2, h / 2, w * 0.15, w / 2, h / 2, Math.max(w, h) * 0.7);
  gradient.addColorStop(0, 'transparent');
  gradient.addColorStop(1, 'rgba(0,0,0,.8)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

/** Splits a title into lines no wider than `maxWidth` using the context's current font. */
export function wrapTitle(ctx, title, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of title.split(/\s+/)) {
    if (ctx.measureText(line + word).width > maxWidth && line) {
      lines.push(line);
      line = '';
    }
    line += word + ' ';
  }
  lines.push(line);
  return lines.map((l) => l.trim());
}

function drawTitle(ctx, title) {
  const { width: w, height: h } = ctx.canvas;
  ctx.font = `500 ${w * 0.045}px Georgia`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff2da';
  ctx.shadowColor = 'black';
  ctx.shadowBlur = 15;
  wrapTitle(ctx, title, w * 0.82).forEach((line, i) => ctx.fillText(line, w / 2, h * 0.8 + i * w * 0.058));
  ctx.shadowBlur = 0;
}

/**
 * Renders the frame at time `t` seconds.
 * `settings`: {motion, strength, effect, density, vignette, duration, title}, numbers as numbers.
 * `media`: an image or video element (or null), with its natural size.
 */
export function drawFrame(ctx, { t, settings, media, mediaWidth, mediaHeight }) {
  const { width: w, height: h } = ctx.canvas;
  const p = t / settings.duration;
  ctx.fillStyle = '#0a0b0f';
  ctx.fillRect(0, 0, w, h);
  if (media && mediaWidth) drawMedia(ctx, media, mediaWidth, mediaHeight, settings, p);
  drawParticles(ctx, settings.effect, settings.density, t);
  if (settings.effect === 'fog') drawFog(ctx, settings.density, t);
  if (settings.vignette) drawVignette(ctx);
  const title = settings.title.trim();
  if (title) drawTitle(ctx, title);
}
