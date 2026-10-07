import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WorkerProcess } from './worker.mjs';

export class BusyError extends Error {}

const JOB_ID = /^[a-f0-9-]{36}$/;
const STATUS_FILE = 'status.json';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The settings a job was made with, kept so the gallery can show and reuse them. */
function describe(config) {
  return {
    prompt: config.prompt,
    seed: config.seed,
    frames: config.frames,
    ratio: config.ratio || '16:9',
    mode: config.image_path ? 'image' : 'text',
    // Jobs from before advanced settings existed used these defaults.
    quality: config.quality || 'standard',
    guidance: config.guidance ?? 3,
    negative_prompt: config.negative_prompt ?? 'blurry, distorted, low quality',
  };
}

/**
 * Runs one generation at a time on a long-running GPU worker that keeps the model loaded (see
 * worker.mjs). Each job gets its own folder under `jobsDir` with a `status.json`, so finished
 * jobs are listed again after a restart.
 */
export class JobRunner {
  constructor({ jobsDir, python, script, env = {}, idleMs }) {
    this.jobsDir = jobsDir;
    this.python = python;
    this.worker = new WorkerProcess({ python, script, env, idleMs });
    this.jobs = new Map();
    this.active = null;
    this.preparing = false;
  }

  /** Reads the jobs saved in `jobsDir`. A job still marked running was cut off by a restart. */
  async load() {
    let entries;
    try {
      entries = await readdir(this.jobsDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !JOB_ID.test(entry.name) || this.jobs.has(entry.name)) continue;
      const dir = resolve(this.jobsDir, entry.name);
      try {
        const config = JSON.parse(await readFile(resolve(dir, 'job.json'), 'utf8'));
        let saved = {};
        try {
          saved = JSON.parse(await readFile(resolve(dir, STATUS_FILE), 'utf8'));
        } catch {}
        const hasVideo = await exists(resolve(dir, 'output.mp4'));
        const job = {
          id: entry.name,
          status: saved.status,
          stage: saved.stage,
          step: null,
          total: null,
          createdAt: saved.createdAt || (await stat(dir)).mtime.toISOString(),
          ...describe(config),
        };
        // Jobs from before status files existed count as complete if they left a video.
        if (!job.status && hasVideo) {
          job.status = 'complete';
          job.stage = 'Complete';
        } else if (!job.status || job.status === 'running') {
          job.status = 'failed';
          job.stage = 'Interrupted when the app closed';
        }
        if (job.status === 'complete' && !hasVideo) {
          job.status = 'failed';
          job.stage = 'Video file is missing';
        }
        if (job.status === 'complete') job.url = '/api/jobs/' + job.id + '/video';
        this.jobs.set(job.id, job);
      } catch {
        // Not a job folder we can read; leave it alone.
      }
    }
  }

  async isInstalled() {
    return exists(this.python);
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

    const job = {
      id,
      status: 'running',
      stage: 'Starting local GPU',
      step: null,
      total: null,
      createdAt: new Date().toISOString(),
      ...describe(config),
    };
    this.jobs.set(id, job);
    this.active = id;
    await this.#save(job);
    this.#run(job, { id, ...config });
    return job;
  }

  async #save(job) {
    const { status, stage, createdAt } = job;
    try {
      await writeFile(
        resolve(this.jobsDir, job.id, STATUS_FILE),
        JSON.stringify({ status, stage, createdAt }),
      );
    } catch {
      // The job folder was deleted; nothing to record.
    }
  }

  async #run(job, config) {
    const outcome = await this.worker.run(config, (progress) => {
      if (job.status !== 'running') return;
      job.stage = progress.stage;
      job.step = progress.step;
      job.total = progress.total;
    });
    if (this.active === job.id) this.active = null;
    if (outcome.timings) job.timings = outcome.timings;
    if (job.status === 'cancelled') return;
    if (outcome.result === 'complete' && (await exists(config.output_path))) {
      job.status = 'complete';
      job.url = '/api/jobs/' + job.id + '/video';
      job.stage = 'Complete';
    } else {
      job.status = outcome.result === 'cancelled' ? 'cancelled' : 'failed';
      job.stage = outcome.result === 'complete' ? 'Worker produced no video' : outcome.stage;
    }
    job.step = null;
    job.total = null;
    await this.#save(job);
  }

  get(id) {
    return this.jobs.get(id);
  }

  /** All jobs, newest first. */
  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** The job as sent to the browser. */
  toPublic(job) {
    return { ...job };
  }

  videoPath(job) {
    return resolve(this.jobsDir, job.id, 'output.mp4');
  }

  cancel(job) {
    if (job.status === 'running') {
      job.status = 'cancelled';
      job.stage = 'Cancelled';
      this.worker.cancel(job.id);
      this.#save(job);
    }
  }

  /** Deletes a finished job and its files. Returns false if the job is still running. */
  async remove(job) {
    if (job.status === 'running') return false;
    this.jobs.delete(job.id);
    await rm(resolve(this.jobsDir, job.id), { recursive: true, force: true });
    return true;
  }

  /** Stops the GPU worker, which also ends any running job. */
  killAll() {
    this.worker.stop();
  }
}
