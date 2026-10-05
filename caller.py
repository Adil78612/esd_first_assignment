"""
Part A — Python caller for the generator-app HTTP API.

Acts like ANOTHER service calling our API. Demonstrates three reliability
patterns against POST /api/generations (which is idempotent, so retrying a
save is safe — it can never create a duplicate):

  1. Timeout            — give up on a request that hangs.
  2. Retry with backoff — retry a transient failure, waiting longer each time.
  3. Circuit breaker    — after repeated failures, STOP calling for a cooldown,
                          then test one call before resuming.
"""

import time
import requests

BASE = "http://localhost:3000"
SAVE_URL = f"{BASE}/api/generations"
FAIL_URL = f"{BASE}/admin/failsaves"

# ---- settings (state these in the report) ----
TIMEOUT = 2.0            # seconds: give up on a hanging request
MAX_RETRIES = 3          # attempts per logical call
BACKOFF_BASE = 0.5       # seconds: waits 0.5, 1.0, 2.0 ... (doubles each retry)

# ---- circuit breaker settings ----
FAILURE_THRESHOLD = 3    # consecutive failures that trip the breaker OPEN
RECOVERY_SECONDS = 5     # how long the breaker stays OPEN before testing again


class CircuitBreaker:
    def __init__(self):
        self.failures = 0
        self.state = "CLOSED"      # CLOSED = allow, OPEN = block, HALF_OPEN = test
        self.opened_at = 0.0

    def allow(self):
        if self.state == "OPEN":
            if time.time() - self.opened_at >= RECOVERY_SECONDS:
                self.state = "HALF_OPEN"
                print("  [breaker] cooldown over -> HALF_OPEN (testing one call)")
                return True
            return False           # still open -> block
        return True

    def record_success(self):
        if self.state in ("OPEN", "HALF_OPEN"):
            print("  [breaker] success -> CLOSED")
        self.failures = 0
        self.state = "CLOSED"

    def record_failure(self):
        self.failures += 1
        if self.failures >= FAILURE_THRESHOLD and self.state != "OPEN":
            self.state = "OPEN"
            self.opened_at = time.time()
            print(f"  [breaker] {self.failures} failures -> OPEN "
                  f"(blocking calls for {RECOVERY_SECONDS}s)")


breaker = CircuitBreaker()


def save(gen_id, body):
    """One logical save: breaker-guarded, with timeout + retry/backoff."""
    if not breaker.allow():
        print(f"save {gen_id}: BLOCKED by open breaker (not attempted)")
        return

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.post(SAVE_URL, json=body, timeout=TIMEOUT)
            if r.status_code >= 500:
                raise RuntimeError(f"server {r.status_code}")
            print(f"save {gen_id}: SUCCESS {r.status_code} (attempt {attempt})")
            breaker.record_success()
            return
        except Exception as e:
            print(f"save {gen_id}: attempt {attempt} FAILED ({e})")
            breaker.record_failure()
            if not breaker.allow():               # breaker tripped during retries
                print(f"save {gen_id}: breaker now open -> stop retrying")
                return
            if attempt < MAX_RETRIES:
                wait = BACKOFF_BASE * (2 ** (attempt - 1))
                print(f"  retry in {wait}s ...")
                time.sleep(wait)
    print(f"save {gen_id}: gave up after {MAX_RETRIES} attempts")


def set_server_failure(on):
    requests.post(FAIL_URL, params={"on": "true" if on else "false"}, timeout=TIMEOUT)
    print(f"\n--- server save-failure = {on} ---")


if __name__ == "__main__":
    print(f"settings: timeout={TIMEOUT}s  retries={MAX_RETRIES}  "
          f"backoff={BACKOFF_BASE}s(x2)  breaker_threshold={FAILURE_THRESHOLD}  "
          f"recovery={RECOVERY_SECONDS}s")

    # PHASE 1 — healthy server: calls succeed
    set_server_failure(False)
    print("\n== PHASE 1: healthy server ==")
    for i in range(3):
        save(f"s{i}", {"id": f"s{i}", "type": "quote", "content": "hi"})

    # PHASE 2 — server failing: retries, then breaker OPENS and blocks calls
    set_server_failure(True)
    print("\n== PHASE 2: server failing ==")
    for i in range(4):
        save(f"f{i}", {"id": f"f{i}", "type": "quote", "content": "hi"})

    # PHASE 3 — recovery: fix server, wait out cooldown, one call closes breaker
    set_server_failure(False)
    print(f"\n== PHASE 3: recovery (waiting {RECOVERY_SECONDS}s for breaker) ==")
    time.sleep(RECOVERY_SECONDS + 0.5)
    save("recovered", {"id": "recovered", "type": "quote", "content": "ok"})
