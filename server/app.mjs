import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { readJsonBody, sendFile, sendJson } from './http.mjs';
import { BusyError } from './jobs.mjs';
import { validate } from './validate.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
};
const JOB_ROUTE = /^\/api\/jobs\/([a-f0-9-]+)(\/video)?$/;
const CANCEL_ROUTE = /^\/api\/jobs\/([a-f0-9-]+)\/cancel$/;

/**
 * Creates the local studio server. It only answers requests addressed to the loopback app
 * address, and only accepts POSTs that come from the app's own pages.
 */
export function createAppServer({ port, publicDir, runner }) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const origins = hosts.map((host) => `http://${host}`);

  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/engine') {
      const installed = await runner.isInstalled();
      return sendJson(res, 200, { installed, active: runner.active, engine: 'LTX-Video · local GPU' });
    }
    if (req.method === 'POST') {
      if (!origins.includes(req.headers.origin)) {
        return sendJson(res, 403, { error: 'Submit from the local app' });
      }
      if (url.pathname === '/api/generate') return generate(req, res);
      const cancel = url.pathname.match(CANCEL_ROUTE);
      if (cancel) {
        const job = runner.get(cancel[1]);
        if (!job) return sendJson(res, 404, { error: 'Job not found' });
        runner.cancel(job);
        return sendJson(res, 200, { status: job.status });
      }
    }
    const match = url.pathname.match(JOB_ROUTE);
    if (req.method === 'GET' && match) {
      const job = runner.get(match[1]);
      if (!job) return sendJson(res, 404, { error: 'Job not found' });
      if (!match[2]) return sendJson(res, 200, runner.toPublic(job));
      if (job.status !== 'complete') return sendJson(res, 409, { error: 'Video is not ready' });
      return sendFile(req, res, runner.videoPath(job), 'video/mp4');
    }
    return sendJson(res, 404, { error: 'Not found' });
  }

  async function generate(req, res) {
    try {
      return await runner.reserve(async () => {
        let data;
        try {
          data = validate(await readJsonBody(req));
        } catch (error) {
          return sendJson(res, 400, { error: error.message });
        }
        if (!(await runner.isInstalled())) {
          return sendJson(res, 503, { error: 'Install the local runtime first. See README.' });
        }
        const job = await runner.start(data);
        return sendJson(res, 202, { id: job.id, status: 'running' });
      });
    } catch (error) {
      if (error instanceof BusyError) return sendJson(res, 409, { error: error.message });
      throw error;
    }
  }

  async function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const path = resolve(publicDir, '.' + decodeURIComponent(pathname));
    if (!path.startsWith(publicDir + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (!hosts.includes(req.headers.host)) {
        return sendJson(res, 403, { error: 'Use the local app address' });
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      await serveStatic(req, res, url);
    } catch {
      if (!res.headersSent) {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.end();
      }
    }
  });
}
