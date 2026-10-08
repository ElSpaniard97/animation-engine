import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

// Room for a generation request carrying several keyframe images.
export const MAX_BODY_BYTES = 40 * 1024 * 1024;

export function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error(`Upload must be smaller than ${limit / 1024 / 1024} MB`);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

/**
 * Parses a single-range `Range` header against a file size.
 * Returns null to serve the whole file (no header, or a form we don't support such as
 * multiple ranges), `{start, end}` for a satisfiable range, or `{unsatisfiable: true}`.
 */
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end = size - 1;
  if (match[1]) {
    start = +match[1];
    if (match[2]) end = Math.min(+match[2], size - 1);
  } else {
    start = Math.max(size - +match[2], 0);
  }
  if (start > end) return { unsatisfiable: true };
  return { start, end };
}

/** Streams a file, answering byte-range requests so browsers can play and seek video. */
export async function sendFile(req, res, file, contentType) {
  const { size } = await stat(file);
  const range = parseRange(req.headers.range, size);
  if (range?.unsatisfiable) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes' };
  if (range) {
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size });
  }
  createReadStream(file, { start, end })
    .on('error', () => res.destroy())
    .pipe(res);
}
