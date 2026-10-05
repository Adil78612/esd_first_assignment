# Part C — Metrics

## Metric-gap audit (what A1 had, what was missing)

Assignment 1 instrumented the HTTP app with the four metric types
(counter, gauge, histogram, summary) plus Node Exporter host metrics.
For Assignment 2 the gap was the **new gRPC service**: it had no metrics at
all, so none of its calls, errors, latency, or load were observable. The fix
was to instrument the gRPC server the same way the HTTP app was, using
bounded labels only.

| Area | A1 state | A2 change |
|------|----------|-----------|
| gRPC calls / errors | not measured | added `grpc_calls_total{method,status}` |
| gRPC latency | not measured | added `grpc_call_duration_seconds` histogram (p50/p95) |
| gRPC concurrency | not measured | added `grpc_in_flight_calls` gauge |
| Prometheus scrape | HTTP app + node-exporter only | added `grpc-generator` scrape target |
| HTTP save metrics | counted generically via `http_requests_total` | reused to compare the same operation (save) across HTTP vs gRPC |

No other project metric was found missing: the HTTP side is already covered
by A1's metrics, and the gRPC side is now covered by the three above.

## New gRPC metrics

All labels are **bounded** (`method`, `status`) — never user, request, or
trace IDs, which would cause a cardinality explosion. Duration is measured
**server-side**: the histogram wraps the handler in `grpc_server.js`, so it
captures server processing time, not client-observed time (which would also
include network latency).

| Metric | Type | Unit | Labels | Code location | Purpose | Query |
|--------|------|------|--------|---------------|---------|-------|
| `grpc_calls_total` | Counter | count | method, status | `grpc_server.js` `finish()` | calls + error rate by RPC and status | `rate(grpc_calls_total[1m])` |
| `grpc_call_duration_seconds` | Histogram | seconds | method | `grpc_server.js` `startTimer`/`endTimer` around handler | call latency; p50/p95 | `histogram_quantile(0.95, sum(rate(grpc_call_duration_seconds_bucket[5m])) by (le, method))` |
| `grpc_in_flight_calls` | Gauge | count | method | `grpc_server.js` `inc`/`dec` around handler | calls being handled right now | `grpc_in_flight_calls` |

**Choice: in-flight vs message size.** In-flight calls was chosen over
message size because this service's messages are tiny and fixed-shape (a few
short strings), so message size carries little information, whereas in-flight
count shows real-time concurrency/pressure on the handler.

**Percentile time window:** p50/p95 are computed over a **5-minute** window
(`[5m]` in the query).

## Dashboard panels (shown beside the HTTP operation)

1. `gRPC calls/sec by status` — `rate(grpc_calls_total[1m])` (OK vs INVALID_ARGUMENT)
2. `gRPC duration p50/p95` — two `histogram_quantile` queries over `[5m]`
3. `gRPC in-flight calls` — `grpc_in_flight_calls` (sits near 0 because calls finish in ms; would rise under concurrent load)
4. `Save ops/sec: gRPC vs HTTP` — gRPC save rate vs `sum(rate(http_requests_total{route="/api/generations",method="POST"}[1m]))`, the same operation through both protocols

Repeatable load was generated with the Python gRPC client
(`1..30 | ForEach-Object { python grpc_client.py }`) to populate the panels
with both successful (OK) and failed (INVALID_ARGUMENT) calls.
