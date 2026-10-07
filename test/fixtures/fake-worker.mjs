// Stands in for engine/worker.py: same stdin/stdout protocol, no GPU. The prompt picks a behavior.
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const cancelled = new Set();
let busy = Promise.resolve();
let loaded = false;

async function run(job) {
  const id = job.id;
  const progress = (stage, step = null, total = null) => send({ job: id, stage, step, total });
  if (!loaded) {
    progress('Loading model weights (first run downloads them)');
    loaded = true;
  }
  if (job.prompt === 'crash') {
    console.error('Segmentation fault in Metal');
    process.exit(3);
  }
  if (job.prompt === 'fail') return send({ job: id, result: 'failed', stage: 'Failed: out of memory' });
  if (job.prompt === 'no output') return send({ job: id, result: 'complete', stage: 'Complete' });
  if (job.prompt === 'slow') {
    for (let step = 1; !cancelled.has(id); step++) {
      progress('Generating frames', step, job.steps);
      await new Promise((done) => setTimeout(done, 20));
    }
    return send({ job: id, result: 'cancelled', stage: 'Cancelled' });
  }
  if (job.prompt === 'stuck') return new Promise(() => {}); // Ignores cancel; must be killed.
  console.log('a library printing to stdout');
  progress('Generating frames', job.steps, job.steps);
  writeFileSync(job.output_path, Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));
  send({ job: id, result: 'complete', stage: 'Complete', timings: { generate: 0.01, pid: process.pid } });
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  if (command.cancel) cancelled.add(command.cancel);
  if (command.run) busy = busy.then(() => run(command.run));
});
