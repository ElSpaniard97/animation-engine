"""Runs a single job outside the app: python engine/generate.py .jobs/<id>/job.json"""
import json
import sys
from pathlib import Path

from ltx_engine import Engine


def progress(stage, step=None, total=None):
    print(json.dumps({'stage': stage, 'step': step, 'total': total}), flush=True)


if __name__ == '__main__':
    job = json.loads(Path(sys.argv[1]).read_text())
    try:
        timings = Engine(progress).generate(job)
        progress('Complete')
        print(json.dumps({'timings': timings}), flush=True)
    except Exception as exc:
        progress('Failed: ' + str(exc))
        sys.exit(1)
