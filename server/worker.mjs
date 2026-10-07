import { spawn } from 'node:child_process';

/**
 * Keeps one long-running GPU worker (engine/worker.py) so the model stays loaded between jobs.
 * The worker is started on the first job and stopped after `idleMs` without work, which hands
 * its memory back to the system.
 */
export class WorkerProcess {
  constructor({ python, script, args = [script], env = {}, idleMs = 10 * 60 * 1000, cancelGraceMs = 15000 }) {
    this.python = python;
    this.args = args;
    this.env = env;
    this.idleMs = idleMs;
    this.cancelGraceMs = cancelGraceMs;
    this.child = null;
    this.current = null;
    this.idleTimer = null;
  }

  get pid() {
    return this.child?.pid ?? null;
  }

  #spawn() {
    const child = spawn(this.python, this.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    let buffer = '';
    let errors = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue; // Library output that isn't part of the protocol.
        }
        if (this.current && message.job === this.current.id) this.#handle(message);
      }
    });
    child.stderr.on('data', (chunk) => {
      errors = (errors + chunk.toString()).slice(-4000);
    });
    child.stdin.on('error', () => {}); // Reported through 'exit' instead.
    const ended = (error) => {
      if (this.child !== child) return;
      this.child = null;
      clearTimeout(this.idleTimer);
      if (this.current) {
        const stage = this.current.cancelling
          ? 'Cancelled'
          : error?.message || errors.slice(-1000).trim() || 'The GPU worker stopped unexpectedly';
        this.#finish({ result: this.current.cancelling ? 'cancelled' : 'failed', stage });
      }
    };
    child.on('error', ended);
    child.on('exit', () => ended());
    return child;
  }

  #handle(message) {
    if (message.result) this.#finish(message);
    else this.current.onProgress(message);
  }

  #finish(message) {
    const { resolve, killTimer } = this.current;
    clearTimeout(killTimer);
    this.current = null;
    this.#scheduleIdle();
    resolve({ result: message.result, stage: message.stage, timings: message.timings });
  }

  #scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (this.child) this.idleTimer = setTimeout(() => this.stop(), this.idleMs);
  }

  /**
   * Runs one job. `config` must include `id`. Resolves with {result, stage, timings} where result
   * is 'complete', 'failed' or 'cancelled'; never rejects.
   */
  run(config, onProgress = () => {}) {
    if (this.current) throw Error('The worker is already running a job');
    clearTimeout(this.idleTimer);
    const child = this.child || this.#spawn();
    return new Promise((resolve) => {
      this.current = { id: config.id, resolve, onProgress, cancelling: false };
      child.stdin.write(JSON.stringify({ run: config }) + '\n');
    });
  }

  /** Asks the worker to stop the job at its next step; kills it if it doesn't. */
  cancel(id) {
    if (!this.current || this.current.id !== id || this.current.cancelling) return;
    this.current.cancelling = true;
    this.child?.stdin.write(JSON.stringify({ cancel: id }) + '\n');
    this.current.killTimer = setTimeout(() => this.child?.kill(), this.cancelGraceMs);
  }

  stop() {
    clearTimeout(this.idleTimer);
    this.child?.kill();
  }
}
