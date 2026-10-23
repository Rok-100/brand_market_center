"""Process-wide request pacing and cooldown for the single-process worker service."""
import os
import random
import threading
import time


class CoolingDown(RuntimeError):
    def __init__(self, seconds):
        self.seconds = seconds


class RequestGovernor:
    def __init__(self):
        self.lock = threading.Lock()
        self.lanes = {}

    def acquire(self, endpoint):
        # Serialize starts only; never hold a lock for a network transfer.
        while True:
            with self.lock:
                now = time.monotonic()
                lane = self.lanes.setdefault(endpoint, {})
                cooldown = lane.get('retry_at', 0) - now
                if cooldown > 0:
                    raise CoolingDown(cooldown)
                delay = lane.get('next_at', 0) - now
                if delay <= 0:
                    try:
                        interval = max(0.2, float(os.getenv('QIANCHUAN_API_REQUEST_INTERVAL', '1')))
                    except ValueError:
                        interval = 1.0
                    lane['next_at'] = now + interval
                    return
            time.sleep(min(delay, 1.0))

    def limited(self, endpoint, retry_after=0):
        with self.lock:
            now = time.monotonic()
            lane = self.lanes.setdefault(endpoint, {})
            failures = lane.get('failures', 0) if now - lane.get('limited_at', 0) < 600 else 0
            delay = max(min(300, 30 * 2 ** min(failures, 4)), min(300, retry_after)) + random.uniform(0, 3)
            lane.update(failures=failures + 1, limited_at=now,
                        retry_at=max(lane.get('retry_at', 0), now + delay))
            return lane['retry_at'] - now

    def retry_seconds(self):
        with self.lock:
            return max([0, *(lane.get('retry_at', 0) - time.monotonic() for lane in self.lanes.values())])


request_governor = RequestGovernor()
