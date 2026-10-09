/** A step percentage is not an overall ETA: loading and encoding also take time. */
export function generationProgress(job, now = Date.now()) {
  const start = Date.parse(job.startedAt || job.createdAt);
  const end = Date.parse(job.finishedAt) || now;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const elapsed = Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s ${job.startedAt ? 'elapsed' : 'since requested'}`
    : '';
  if (job.status === 'complete')
    return { value: 100, text: `Complete · 100%${elapsed ? ' · ' + elapsed : ''}` };
  if (job.status === 'queued')
    return {
      value: null,
      text: `Waiting for the GPU${job.position ? ' · Queue position ' + job.position : ''}`,
    };
  if (job.status !== 'running') return { value: 0, text: job.stage || job.status };
  const steps = Number.isFinite(job.step) && Number.isFinite(job.total) && job.total > 0;
  const value = steps ? Math.min(100, Math.max(0, (job.step / job.total) * 100)) : null;
  const detail = steps
    ? `Step ${job.step} of ${job.total} · ${Math.round(value)}% of this stage`
    : 'In progress';
  return { value, text: `${job.stage} · ${detail}${elapsed ? ' · ' + elapsed : ''}` };
}
