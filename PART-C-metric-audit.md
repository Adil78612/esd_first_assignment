# Part C — A1 metric audit (useful / missing / fix)

A proper audit of the Assignment 1 metrics, judging what was useful, what was
missing or wrong, and what was fixed for Assignment 2.

## Useful (kept as-is)
- **`generations_total` (counter, by type):** clean business metric, bounded
  label (`quote`/`art`). Good.
- **`generations_in_progress` (gauge):** correct use of a gauge for live
  concurrency.
- **`http_requests_total` (counter, by method/route/status):** the right shape
  for request volume and error rate — but the `route` label was unbounded (see
  Fixed below).
- **Node Exporter host metrics (CPU/mem/disk/net):** still useful, unchanged.

## Missing / wrong in A1
1. **Unbounded `route` label.** The HTTP metrics labelled `route` with
   `req.path`, so every `/api/generations/<id>` and every random 404 path
   created a new time series — a cardinality risk, and exactly what A1's own
   cardinality experiment warned against.
2. **HTTP latency histogram buckets too coarse.** The smallest bucket was
   50 ms, but SQLite saves complete in well under 1 ms, so every fast request
   falls into the first bucket. This makes the HTTP-vs-gRPC latency comparison
   almost meaningless at the low end — the histogram can't distinguish a
   0.2 ms save from a 40 ms one.
3. **The Summary metric can't be aggregated.** `generation_duration_seconds`
   is a summary, so its percentiles are computed per-instance and cannot be
   re-aggregated across instances in Prometheus (unlike a histogram). Fine for
   one instance, a limitation to note.
4. **HTTP duration histogram lacked `method`/`status` labels**, so you can't
   separate the latency of successful vs failed requests, or GET vs POST.
5. **The gRPC service had no metrics at all** — the main A2 gap.

## Fixed in A2
- **Unbounded label:** changed `route: req.path` to
  `route: req.route?.path || req.path`, so the label is the route *pattern*
  (`/api/generations/:id`) — bounded, one series per route.
- **gRPC metrics added:** `grpc_calls_total{method,status}` (calls + error
  rate), `grpc_call_duration_seconds` histogram with fine buckets starting at
  5 ms (p50/p95), and `grpc_in_flight_calls` gauge — all bounded labels.
- **gRPC histogram buckets** start at 5 ms (vs the HTTP histogram's 50 ms),
  appropriate for the faster, in-process gRPC path.

## Deliberately not changed
- The A1 `demo_requests_total{request_id}` counter keeps its high-cardinality
  label on purpose — it exists only to *demonstrate* a cardinality explosion
  (A1 Part E), and is capped at 100 series.
- No further project metric is needed: the HTTP side is covered by the A1
  metrics (with the label fix), and the gRPC side is now fully instrumented.
