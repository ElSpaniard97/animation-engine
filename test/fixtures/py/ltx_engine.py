"""Stands in for engine/ltx_engine.py so worker.py's protocol can be tested without a GPU."""
import time


class Cancelled(Exception):
    pass


class Engine:
    def __init__(self, progress):
        self.progress = progress
        self.timings = {'load': 0.5}

    def generate(self, job, should_cancel=lambda: False):
        if job['prompt'] == 'fail':
            raise RuntimeError('MPS backend out of memory')
        if job['prompt'] == 'slow':
            step = 0
            while not should_cancel():
                step += 1
                self.progress('Generating frames', step, job['steps'])
                time.sleep(0.02)
            raise Cancelled()
        self.progress('Generating frames', job['steps'], job['steps'])
        with open(job['output_path'], 'wb') as f:
            f.write(b'mp4')
        return {'generate': 0.1}
