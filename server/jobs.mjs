import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WorkerProcess } from './worker.mjs';

export class QueueFullError extends Error {}

const JOB_ID = /^[a-f0-9-]{36}$/;
const STATUS_FILE = 'status.json';
export const MAX_QUEUED = 10;

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
    // Images that guided the clip, the starting one included.
    images: config.image_path ? 1 + (config.keyframe_paths?.length ?? 0) : 0,
    // Jobs from before advanced settings existed used these defaults.
    resolution: config.resolution || 'preview',
    width: config.width,
    height: config.height,
    quality: config.quality || 'standard',
    guidance: config.guidance ?? 3,
    negative_prompt: config.negative_prompt ?? 'blurry, distorted, low quality',
  };
}

/**
 * Runs generations one at a time, in the order they were requested, on a long-running GPU worker
 * that keeps the model loaded (see worker.mjs). Later requests wait in a queue. Each job gets its
 * own folder under `jobsDir` with a `status.json`, so finished jobs are listed again after a
 * restart.
 */
export class JobRunner {
  constructor({ jobsDir, python, script, env = {}, idleMs }) {
    this.jobsDir = jobsDir;
    this.python = python;
    this.worker = new WorkerProcess({ python, script, env, idleMs });
    this.jobs = new Map();
    this.active = null;
    this.queue = [];
    this.saves = new Map();
  }

  /** Reads the jobs saved in `jobsDir`. A job still running or queued was cut off by a restart. */
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
        } else if (!job.status || job.status === 'running' || job.status === 'queued') {
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

  /** Writes the job folder and queues the job; it starts as soon as the GPU is free. */
  async start(data) {
    if (this.queue.length >= MAX_QUEUED) {
      throw new QueueFullError(`Up to ${MAX_QUEUED} generations can wait. Try again when one starts.`);
    }
    const id = randomUUID();
    const dir = resolve(this.jobsDir, id);
    await mkdir(dir);
    const config = { ...data, output_path: resolve(dir, 'output.mp4') };
    delete config.image;
    delete config.keyframes;
    if (data.image) {
      config.image_path = resolve(dir, 'input.png');
      await writeFile(config.image_path, Buffer.from(data.image.split(',')[1], 'base64'));
    }
    if (data.keyframes?.length) {
      config.keyframe_paths = [];
      for (const [i, image] of data.keyframes.entries()) {
        const path = resolve(dir, `keyframe-${i + 1}.png`);
        await writeFile(path, Buffer.from(image.split(',')[1], 'base64'));
        config.keyframe_paths.push(path);
      }
    }
    await writeFile(resolve(dir, 'job.json'), JSON.stringify(config));

    const job = {
      id,
      status: 'queued',
      stage: 'Waiting for the GPU',
      step: null,
      total: null,
      createdAt: new Date().toISOString(),
      ...describe(config),
    };
    this.jobs.set(id, job);
    this.queue.push({ job, config: { id, ...config } });
    await this.#save(job);
    this.#next();
    return job;
  }

  /** Starts the next queued job if the GPU is free. */
  #next() {
    if (this.active || !this.queue.length) return;
    const { job, config } = this.queue.shift();
    this.active = job.id;
    job.status = 'running';
    job.stage = 'Starting local GPU';
    this.#save(job);
    this.#run(job, config).finally(() => {
      this.active = null;
      this.#next();
    });
  }

  /** Records the job's status. Writes for a job happen in order, so the newest status wins. */
  #save(job) {
    const { status, stage, createdAt } = job;
    const previous = this.saves.get(job.id) || Promise.resolve();
    const write = previous.then(() =>
      writeFile(
        resolve(this.jobsDir, job.id, STATUS_FILE),
        JSON.stringify({ status, stage, createdAt }),
      ).catch(
        () => {}, // The job folder was deleted; nothing to record.
      ),
    );
    this.saves.set(job.id, write);
    write.then(() => {
      if (this.saves.get(job.id) === write) this.saves.delete(job.id);
    });
    return write;
  }

  async #run(job, config) {
    const outcome = await this.worker.run(config, (progress) => {
      if (job.status !== 'running') return;
      job.stage = progress.stage;
      job.step = progress.step;
      job.total = progress.total;
    });
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
    // Jobs queued in the same millisecond tie on createdAt; the id keeps the order stable.
    return [...this.jobs.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );
  }

  /** The job as sent to the browser, with its place in line while it waits. */
  toPublic(job) {
    if (job.status !== 'queued') return { ...job };
    return { ...job, position: this.queue.findIndex((entry) => entry.job === job) + 1 };
  }

  videoPath(job) {
    return resolve(this.jobsDir, job.id, 'output.mp4');
  }

  cancel(job) {
    if (job.status !== 'running' && job.status !== 'queued') return;
    if (job.status === 'running') this.worker.cancel(job.id);
    else this.queue = this.queue.filter((entry) => entry.job !== job);
    job.status = 'cancelled';
    job.stage = 'Cancelled';
    this.#save(job);
  }

  /** Deletes a finished job and its files. Returns false if the job is running or queued. */
  async remove(job) {
    if (job.status === 'running' || job.status === 'queued') return false;
    this.jobs.delete(job.id);
    await rm(resolve(this.jobsDir, job.id), { recursive: true, force: true });
    return true;
  }

  /** Stops the GPU worker, which also ends any running job, and drops the queue. */
  killAll() {
    this.queue = [];
    this.worker.stop();
  }
}
