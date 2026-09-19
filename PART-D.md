# Part D — System Design

## D.1 Architecture diagram

*(Insert `architecture-diagram.png` here.)*

All services run as Docker Compose containers on a single WSL2 Linux VM
(node `1d91e4e51222`). The system has two independent pipelines that both
start from the application:

- **Metrics pipeline:** app `/metrics` + node-exporter → Prometheus → Grafana
- **Logs pipeline:** app stdout → Docker → Filebeat → Elasticsearch → Kibana

### What each component does, and what happens if it fails

| Component | Role | If it fails |
|-----------|------|-------------|
| **generator-app** | Node/Express app. Serves quote/art generation, exposes metrics at `/metrics`, writes JSON logs to stdout. | No metrics or logs are produced; both dashboards show a gap until it restarts. |
| **node-exporter** | Exposes the VM's CPU/memory/disk/network at `:9100`. | Machine metrics stop; app metrics keep flowing. |
| **Prometheus** | Scrapes `/metrics` from the app and node-exporter every 5s; stores them in its time-series database. | No new metrics collected; Grafana panels flatline. History survives in the `prometheus_data` volume. |
| **Grafana** | Queries Prometheus with PromQL and draws dashboards `:3001`. | Only the *view* is lost — metrics are still collected. Dashboards return on restart (`grafana_data` volume). |
| **Docker (json-file driver)** | Captures the app's stdout to log files on disk. | The whole stack stops. |
| **Filebeat** | Reads the Docker log files and ships them to Elasticsearch. | Logs still accumulate on disk; Filebeat resumes from its saved position (registry) on restart — delayed, not lost. |
| **Elasticsearch** | Stores and indexes logs for search `:9200`. | No new logs indexed; Kibana can't search. Past logs survive in the `elasticsearch_data` volume. |
| **Kibana** | Search UI `:5601`. | Only the search interface is lost; logs remain in Elasticsearch. |

**Design principle:** the collectors (Prometheus, Filebeat, Elasticsearch)
are where data lives; the UIs (Grafana, Kibana) are disposable views.
Losing a UI loses nothing; losing a collector creates a gap.

---

## D.2 Follow a metric — `generations_total`

1. **Code updates it.** In `app.js`, `doGenerate()` calls
   `generationsTotal.inc({ type })` after each successful generation.
   The counter increments in the app's memory.
2. **The app exposes it.** Its current value is published as plain text at
   `GET /metrics`, e.g. `generations_total{type="art"} 18`.
3. **Prometheus collects and stores it.** With `scrape_interval: 5s` and
   target `app:3000`, Prometheus fetches `/metrics` every 5 seconds and
   stores each value with a timestamp in its TSDB.
4. **Grafana queries and displays it.** The panel runs
   `rate(generations_total[1m])` against Prometheus and plots it.
5. **The change shown.** The raw counter only ever rises; `rate()` converts
   it into "generations per second," which is the meaningful, readable value
   on the dashboard.

*Evidence: Prometheus query result for `generations_total`, and the Grafana
"Generations per second" panel.*

---

## D.3 Follow a log — a `request handled` entry

1. **Code writes it.** The logging middleware in `app.js` writes one JSON
   line to stdout per request:
   `{"@timestamp":"…","app_name":"generator-app","severity":"info","message":"request handled","request_id":"…","route":"/api/generate","status":200}`
2. **Docker saves it.** The json-file driver stores that line at
   `/var/lib/docker/containers/<id>/<id>-json.log`.
3. **Filebeat collects and parses it.** Filebeat reads the file; the
   `decode_json_fields` processor (`target: "app"`) parses the JSON and nests
   the fields under `app.*` (e.g. `app.request_id`, `app.status`). Filebeat
   ships the event to Elasticsearch.
4. **Elasticsearch stores it.** The document is indexed into `filebeat-*`.
5. **Kibana finds it.** Searching `app.app_name : "generator-app"` in Discover
   returns the row; adding columns (`app.severity`, `app.message`,
   `app.request_id`, `app.route`, `app.status`) makes it readable.

### The change to the log's format (required by the assignment)

The app emits flat JSON keys, but two of them collided with Elasticsearch's
built-in ECS field mappings, so the documents were rejected with
`document_parsing_exception` (HTTP 400) and silently dropped:

- `service` (a string) clashed with ECS's `service` **object** →
  renamed to `app_name` in the app.
- `error` (a string) clashed with ECS's `error` **object**.

The fix was to set `target: "app"` in Filebeat's `decode_json_fields`, which
nests every parsed field under the collision-proof `app.*` namespace. This
namespacing **is** the format transformation between the raw log
(`message`, `status`) and the stored document (`app.message`, `app.status`).

*Evidence: one raw log line from `docker logs generator-app`; the same log
expanded in Kibana showing its `app.*` fields; a working search
(`app.severity : "error"`).*
