"""Long-running LTX worker. The app starts it once and sends it jobs, so the model stays loaded.

Protocol, one JSON object per line:
  stdin:  {"run": <job config>}        start a job (the config the app writes to job.json)
          {"cancel": "<job id>"}       stop that job at its next step
  stdout: {"job": id, "stage": ..., "step": n, "total": n}           progress
          {"job": id, "result": "complete"|"failed"|"cancelled", "stage": ..., "timings": {...}}
The app stops the process to free memory when it has been idle for a while.
"""
import json
import queue
import sys
import threading

from ltx_engine import Cancelled, Engine

jobs = queue.Queue()
cancelled = set()
current = {'id': None}
write_lock = threading.Lock()


def send(message):
    with write_lock:
        sys.stdout.write(json.dumps(message) + '\n')
        sys.stdout.flush()


def progress(stage, step=None, total=None):
    send({'job': current['id'], 'stage': stage, 'step': step, 'total': total})


def read_commands():
    for line in sys.stdin:
        try:
            command = json.loads(line)
        except ValueError:
            continue
        if 'run' in command:
            jobs.put(command['run'])
        elif 'cancel' in command:
            cancelled.add(command['cancel'])
    jobs.put(None)  # The app closed stdin: finish up and exit.


def main():
    threading.Thread(target=read_commands, daemon=True).start()
    engine = Engine(progress)
    while True:
        job = jobs.get()
        if job is None:
            return
        job_id = job['id']
        current['id'] = job_id
        if job_id in cancelled:
            send({'job': job_id, 'result': 'cancelled', 'stage': 'Cancelled'})
            continue
        try:
            timings = engine.generate(job, should_cancel=lambda: job_id in cancelled)
            timings.update({k: v for k, v in engine.timings.items()})
            engine.timings.clear()
            send({'job': job_id, 'result': 'complete', 'stage': 'Complete', 'timings': timings})
        except Cancelled:
            send({'job': job_id, 'result': 'cancelled', 'stage': 'Cancelled'})
        except Exception as exc:  # Report and stay alive for the next job.
            send({'job': job_id, 'result': 'failed', 'stage': 'Failed: ' + str(exc)})
        finally:
            cancelled.discard(job_id)
            current['id'] = None


if __name__ == '__main__':
    main()
