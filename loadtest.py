"""
A3 fixed-rate (open-loop) load client.

Sends requests on a fixed schedule and never waits for one reply before
sending the next, so a slow replica can't slow down the client's sending rate.

  python loadtest.py http --rate 20 --duration 60 --label baseline-A
  python loadtest.py grpc --rate 20 --duration 60 --label baseline-A

Each run prints a summary and appends one row to results.csv.
"""
import argparse
import csv
import os
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, wait
import urllib.request
import urllib.error

import grpc
import generations_pb2 as pb
import generations_pb2_grpc as pb_grpc

HTTP_URL = "http://localhost:8080/api/generations"   # through Envoy
GRPC_TARGET = "localhost:8081"                        # through Envoy
TIMEOUT_S = 5.0   # per-request timeout; no retries (A3 says disable them)


def http_call(trace_id):
    req = urllib.request.Request(HTTP_URL, headers={"trace-id": trace_id})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            r.read()
            return True, str(r.status)
    except urllib.error.HTTPError as e:      # 4xx / 5xx
        return False, str(e.code)
    except Exception as e:                   # timeout, connection refused...
        return False, type(e).__name__


def make_grpc_call():
    channel = grpc.insecure_channel(GRPC_TARGET)       # ONE channel for every call
    stub = pb_grpc.GenerationServiceStub(channel)
    # fixed id: after the first call this returns created=False (idempotent)
    req = pb.SaveRequest(id="loadtest-1", type="quote", content="A3 load test")

    def grpc_call(trace_id):
        try:
            stub.SaveGeneration(req, timeout=TIMEOUT_S,
                                metadata=[("trace-id", trace_id)])
            return True, "OK"
        except grpc.RpcError as e:
            return False, e.code().name

    return grpc_call, channel


def pct(values, p):
    if not values:
        return float("nan")
    s = sorted(values)
    return s[min(len(s) - 1, int(round(p * (len(s) - 1))))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("interface", choices=["http", "grpc"])
    ap.add_argument("--rate", type=float, default=20, help="requests per second")
    ap.add_argument("--duration", type=float, default=60, help="seconds")
    ap.add_argument("--label", default="run", help="row name in results.csv")
    args = ap.parse_args()

    channel = None
    if args.interface == "http":
        call = http_call
    else:
        call, channel = make_grpc_call()

    results = []   # (ok, code, latency_seconds)

    def task(scheduled_at, trace_id):
        ok, code = call(trace_id)
        # measured from when the request was SCHEDULED, so any client-side
        # queueing still counts as latency (nothing hidden)
        results.append((ok, code, time.perf_counter() - scheduled_at))

    total = int(args.rate * args.duration)
    interval = 1.0 / args.rate
    print(f"{args.interface}: {args.rate}/s for {args.duration}s = {total} requests ...")

    pool = ThreadPoolExecutor(max_workers=200)
    futures = []
    start = time.perf_counter()
    for i in range(total):
        scheduled_at = start + i * interval
        delay = scheduled_at - time.perf_counter()
        if delay > 0:
            time.sleep(delay)                      # keep the fixed schedule
        futures.append(pool.submit(task, scheduled_at, str(uuid.uuid4())))
    send_time = time.perf_counter() - start
    wait(futures)
    pool.shutdown()
    if channel:
        channel.close()

    ok_lat = [r[2] for r in results if r[0]]
    all_lat = [r[2] for r in results]
    failed = sum(1 for r in results if not r[0])
    codes = dict(Counter(r[1] for r in results))
    actual_rate = (total - 1) / send_time if total > 1 else float(total)
    err_pct = 100 * failed / total

    print(f"target rate : {args.rate:.1f}/s")
    print(f"actual rate : {actual_rate:.1f}/s")
    print(f"sent        : {total}")
    print(f"successes   : {len(ok_lat)}")
    print(f"failures    : {failed}  ({err_pct:.1f}%)")
    print(f"client p50  : {1000 * pct(ok_lat, 0.50):.1f} ms (successes)")
    print(f"client p95  : {1000 * pct(ok_lat, 0.95):.1f} ms (successes)  |  "
          f"{1000 * pct(all_lat, 0.95):.1f} ms (all)")
    print(f"codes       : {codes}")

    new_file = not os.path.exists("results.csv")
    with open("results.csv", "a", newline="") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(["label", "interface", "target_rps", "actual_rps", "sent",
                        "ok", "failed", "error_rate_pct", "p50_ms",
                        "p95_ok_ms", "p95_all_ms", "codes"])
        w.writerow([args.label, args.interface, args.rate, round(actual_rate, 1),
                    total, len(ok_lat), failed, round(err_pct, 1),
                    round(1000 * pct(ok_lat, 0.50), 1),
                    round(1000 * pct(ok_lat, 0.95), 1),
                    round(1000 * pct(all_lat, 0.95), 1), codes])


if __name__ == "__main__":
    main()