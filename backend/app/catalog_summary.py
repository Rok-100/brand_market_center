"""Keep historical hit verification off the basic catalog count request."""
import time
import logging
from threading import Lock, Thread

_lock = Lock()
_running = False
_values = {}
_retry_after = 0


def hit_count(session_factory, reader, hold_ids):
    global _running
    key = tuple(sorted(hold_ids))
    now = time.monotonic()
    with _lock:
        item = _values.get(key)
        if item and now - item[0] < 300:
            return item[1]
        if _running or now < _retry_after:
            return None
        _running = True

    def generate():
        global _running, _retry_after
        try:
            with session_factory() as db:
                value = reader(db)
            with _lock:
                _values.clear()
                _values[key] = (time.monotonic(), value)
        except Exception:
            logging.getLogger(__name__).exception('Historical hit count unavailable')
            with _lock:
                _retry_after = time.monotonic() + 60
        finally:
            with _lock:
                _running = False
    Thread(target=generate, name='catalog-hit-summary', daemon=True).start()
    return None
