# Part B — Metrics table

All metrics are defined and registered in `app.js` (lines shown), exposed at
`GET /metrics`, scraped by Prometheus every 5s, and charted in Grafana.

| Metric | Type | Unit | Labels | Recorded in code | Purpose | Grafana query |
|--------|------|------|--------|------------------|---------|---------------|
| `generations_total` | Counter | count | `type` (quote/art) | defined L26; `generationsTotal.inc({ type })` in `doGenerate()` (L121) | business: total generations produced, split by type | `rate(generations_total[1m])` |
| `favorites_total` | Counter | count | — | defined L31; `favoritesTotal.inc()` in `/api/favorite` (L152) | business: how often users favorite a result | `rate(favorites_total[1m])` |
| `regenerations_total` | Counter | count | — | defined L34; `regenerationsTotal.inc()` in `/api/regenerate` (L142) | business: how often users regenerate | `rate(regenerations_total[1m])` |
| `http_requests_total` | Counter | count | `method`, `route`, `status` | defined L38; `.inc({...})` in request middleware (L98) | app: request volume; failures = `status="500"` | `rate(http_requests_total{status="500"}[5m])` |
| `generations_in_progress` | Gauge | count | — | defined L43; `inProgress.inc()` / `.dec()` around `doGenerate()` (L108, L126) | app: generations running right now | `generations_in_progress` |
| `http_request_duration_seconds` | Histogram | seconds | `route` | defined L48 (buckets 0.05–5s); `httpDuration.startTimer({ route })` in middleware (L95) | app: request latency distribution by route | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))` |
| `generation_duration_seconds` | Summary | seconds | `type` | defined L54 (percentiles .5/.9/.95/.99); `genSummary.startTimer({ type })` in `doGenerate()` (L109) | app: exact generation-time percentiles per type | `generation_duration_seconds{quantile="0.95"}` |
| `demo_requests_total` | Counter | count | `request_id` | defined L60; `demoLabeled.inc({ request_id })` in `/admin/cardinality` (L168) | Part E cardinality demo (WITH high-variety label) | `count(demo_requests_total)` |
| `demo_requests_nolabel_total` | Counter | count | — | defined L64; `demoNoLabel.inc()` in `/admin/cardinality-nolabel` (L172) | Part E cardinality demo (WITHOUT label) | `count(demo_requests_nolabel_total)` |

Plus **machine metrics** from Node Exporter (job `node-exporter`, machine
`1d91e4e51222` — the WSL2 Linux VM):

| Metric | Type | Unit | Purpose | Grafana query |
|--------|------|------|---------|---------------|
| `node_cpu_seconds_total` | Counter | seconds | host CPU usage | `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)` |
| `node_memory_MemAvailable_bytes` | Gauge | bytes | host memory available | `node_memory_MemAvailable_bytes` |

**Coverage:** all four metric types are used — Counter, Gauge, Histogram,
Summary — across both **application** metrics (latency, in-progress, request
volume/failures) and **business** metrics (generations, favorites,
regenerations).
