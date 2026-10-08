// Quality decisions shared by the editor and export. Higher output resolution does not invent
// detail in a small generated source; show both sizes rather than labelling an upscale as HD.
export const OUTPUT_SIZES = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1440, 1440] };
export const EXPORT_FPS = 24;
export function exportBitrate(width, height) {
  return Math.round(Math.max(8_000_000, Math.min(40_000_000, width * height * EXPORT_FPS * 0.4)));
}

// Compare low-resolution RGBA samples in normal and mirrored order. Only flag a near-exact
// mirror, not an arbitrary new pose or a symmetrical image. This is a warning, not a blocker.
export function isMirroredReference(first, second, width, height) {
  if (first.length !== width * height * 4 || second.length !== first.length) return false;
  let direct = 0,
    mirrored = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const a = (y * width + x) * 4,
        b = (y * width + width - 1 - x) * 4;
      for (let c = 0; c < 3; c++) {
        direct += Math.abs(first[a + c] - second[a + c]);
        mirrored += Math.abs(first[a + c] - second[b + c]);
      }
    }
  const samples = width * height * 3;
  return mirrored / samples < 12 && direct / samples > 20 && mirrored < direct * 0.3;
}
export function sourceQuality(width, height, outputWidth, outputHeight) {
  if (!width || !height) return 'Add artwork or a clip to inspect its source detail.';
  const enlarged = Math.max(outputWidth / width, outputHeight / height) > 1.05;
  return (
    `Source ${width} × ${height} · Output ${outputWidth} × ${outputHeight}` +
    (enlarged ? ' · Enlarged: export size does not add source detail.' : ' · Source covers the output size.')
  );
}
