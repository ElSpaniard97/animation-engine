// Stands in for engine/generate.py: same arguments, same progress protocol, no GPU.
import { readFileSync, writeFileSync } from 'node:fs';

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const progress = (stage, step = null, total = null) => console.log(JSON.stringify({ stage, step, total }));

progress('Loading local runtime');
if (job.prompt === 'fail') {
  console.error('CUDA exploded');
  process.exit(1);
}
if (job.prompt === 'report failure') {
  progress('Failed: out of memory');
  process.exit(1);
}
if (job.prompt === 'no output') process.exit(0);
if (job.prompt === 'slow') setInterval(() => progress('Generating frames', 1, job.steps), 50);
else {
  progress('Generating frames', job.steps, job.steps);
  writeFileSync(job.output_path, Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));
  progress('Complete');
}
