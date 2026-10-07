import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export class BusyError extends Error {}

/**
 * Runs one generation at a time. Each job gets its own folder under `jobsDir` and its own
 * Python worker process, so GPU memory is released when the job ends.
 */
export class JobRunner {
  constructor({ jobsDir, python, script, env = {} }) {
    this.jobsDir = jobsDir;
    this.python = python;
    this.script = script;
    this.env = env;
    this.jobs = new Map();
    this.active = null;
    this.preparing = false;
  }

  async isInstalled() {
    try {
      await access(this.python);
      return true;
    } catch {
      return false;
    }
  }

  get busy() {
    return Boolean(this.active || this.preparing);
  }

  /**
   * Reserves the GPU while `prepare` runs (reading and validating the request), so two requests
   * can't both start a job. `prepare` returns the validated job settings.
   */
  async reserve(prepare) {
    if (this.busy) throw new BusyError('A generation is already running');
    this.preparing = true;
    try {
      return await prepare();
    } finally {
      this.preparing = false;
    }
  }

  /** Writes the job folder and starts the worker. Call inside `reserve`. */
  async start(data) {
    const id = randomUUID();
    const dir = resolve(this.jobsDir, id);
    await mkdir(dir);
    const config = { ...data, output_path: resolve(dir, 'output.mp4') };
    delete config.image;
    if (data.image) {
      config.image_path = resolve(dir, 'input.png');
      await writeFile(config.image_path, Buffer.from(data.image.split(',')[1], 'base64'));
    }
    const configPath = resolve(dir, 'job.json');
    await writeFile(configPath, JSON.stringify(config));

    const job = { id, status: 'running', stage: 'Starting local GPU', step: null, total: null };
    this.jobs.set(id, job);
    this.active = id;
    const child = spawn(this.python, [this.script, configPath], {
      cwd: process.cwd(),
      env: { ...process.env, ...this.env },
    });
    job.child = child;
    this.#watch(job, child, config.output_path);
    return job;
  }

  #watch(job, child, outputPath) {
    let buffer = '';
    let errors = '';
    // The worker prints one JSON progress object per line.
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        try {
          const progress = JSON.parse(line);
          job.stage = progress.stage;
          job.step = progress.step;
          job.total = progress.total;
        } catch {}
      }
    });
    child.stderr.on('data', (chunk) => {
      errors = (errors + chunk.toString()).slice(-4000);
    });
    child.on('error', (error) => {
      job.status = 'failed';
      job.stage = error.message;
      if (this.active === job.id) this.active = null;
    });
    child.on('close', async (code) => {
      if (this.active === job.id) this.active = null;
      if (job.status === 'cancelled') return;
      if (code === 0) {
        try {
          await access(outputPath);
          job.status = 'complete';
          job.url = '/api/jobs/' + job.id + '/video';
          job.stage = 'Complete';
        } catch {
          job.status = 'failed';
          job.stage = 'Worker produced no video';
        }
      } else {
        job.status = 'failed';
        if (!job.stage.startsWith('Failed:')) job.stage = errors.slice(-1000) || 'Generation failed';
      }
    });
  }

  get(id) {
    return this.jobs.get(id);
  }

  /** Returns the job without its process handle, for sending to the browser. */
  toPublic(job) {
    const { child, ...publicJob } = job;
    return publicJob;
  }

  videoPath(job) {
    return resolve(this.jobsDir, job.id, 'output.mp4');
  }

  cancel(job) {
    if (job.status === 'running') {
      job.status = 'cancelled';
      job.stage = 'Cancelled';
      job.child.kill('SIGTERM');
    }
  }

  killAll() {
    for (const job of this.jobs.values()) if (job.status === 'running') job.child.kill();
  }
}
