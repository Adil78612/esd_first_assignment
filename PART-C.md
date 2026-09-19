# Part C — Logs

## C.1 What is logged, why, and where in the code

The application writes **one structured JSON log line per HTTP request** to
stdout. Logging is centralised in a single `log()` helper in `app.js`, and a
request-timing middleware calls it on every request once the response
finishes.

Each log entry contains:

| Field | Purpose |
|-------|---------|
| `@timestamp` | when the event happened (ISO-8601, UTC) |
| `app_name` | which service produced the log (`generator-app`) |
| `severity` | level — `info`, `warn`, or `error` |
| `message` | human-readable event, e.g. `request handled` |
| `request_id` | unique ID per request, to trace a single request end-to-end |
| `method`, `route`, `status` | which endpoint was hit and the HTTP result |

Error events (a failed art generation) additionally log
`severity: "error"`, `message: "generation failed"`, and `error_message`.

**Why these fields:** together they answer the questions you ask during an
incident — *when* (`@timestamp`), *what* (`message`, `severity`), *where*
(`route`, `status`), and *which specific request* (`request_id`). The
`request_id` is the key that links a metric spike to the exact request that
caused it.

**Secrets:** no passwords, tokens, or personal data are logged — only request
metadata.

Example of one original log line (from `docker logs generator-app`):

```json
{"@timestamp":"2026-09-19T14:58:57.674Z","app_name":"generator-app","severity":"info","message":"request handled","request_id":"64c7ea75-f94b-4cc9-993f-ee0f4b7bdd77","method":"POST","route":"/api/generate","status":200}
```

## C.2 How Filebeat collects logs and makes them searchable

1. The app writes JSON to **stdout**.
2. Docker's **json-file log driver** saves each line to
   `/var/lib/docker/containers/<container-id>/<container-id>-json.log`.
3. **Filebeat** (a `container` input) reads those files. Its
   `decode_json_fields` processor parses the JSON message and, with
   `target: "app"`, nests every field under an `app.*` namespace
   (`app.request_id`, `app.status`, `app.severity`, …).
4. Filebeat ships each parsed event to **Elasticsearch**, which indexes it
   into the `filebeat-*` data stream — turning each field into a
   **searchable, typed field**.
5. **Kibana** reads the `filebeat-*` index and lets you search and filter.

### The format transformation (required by the brief)

The raw log has flat keys (`message`, `status`). Two of them collided with
Elasticsearch's built-in ECS mappings and caused every app document to be
rejected with `document_parsing_exception` (HTTP 400) and silently dropped:

- `service` (a string) clashed with ECS's `service` **object** → renamed to
  `app_name` in the app code.
- `error` (a string) clashed with ECS's `error` **object**.

The fix was `target: "app"` in `decode_json_fields`, which nests all custom
fields under the collision-proof `app.*` namespace. This nesting **is** the
format change between the original log (`status`) and the stored document
(`app.status`). Diagnosing this from Filebeat's own event log
(`filebeat-events-data-*.ndjson`) is the core troubleshooting evidence for
this assignment.

## C.3 Where logs live, what survives restarts, and retention

- **On disk (short term):** Docker keeps the raw json-file logs on the host
  VM until the container is removed.
- **In Elasticsearch (searchable store):** indexed logs live in the
  `elasticsearch_data` **named Docker volume**, so they **survive container
  and machine restarts**. Stopping/starting the stack does not lose indexed
  logs.
- **Filebeat position:** Filebeat records how far it has read in a registry
  inside its container. (In this setup the registry is not on a named volume,
  so removing the Filebeat container makes it re-read from the start — fine
  for a local dev project; in production the registry would be persisted.)
- **Deletion / retention:** Elasticsearch created an ILM (Index Lifecycle
  Management) policy named `filebeat` automatically. By default it rolls the
  index over but does not delete old data — nothing is auto-deleted in this
  setup. In production you would add an ILM *delete* phase (e.g. delete after
  30 days) to bound disk usage.

## C.4 How to search in Kibana

In **Discover**, using the `filebeat-*` data view:

- **Find all app logs:** `app.app_name : "generator-app"`
- **Find errors only:** `app.severity : "error"` — this surfaces the failed
  art generations (`status 500`), the same failures counted by the
  `http_requests_total{status="500"}` metric in Grafana.
- **Trace one request:** `app.request_id : "<the id>"` returns every log for
  that single request.

Columns added for readability: `app.severity`, `app.message`,
`app.request_id`, `app.route`, `app.status`.

*Evidence to include: (1) one raw log line from `docker logs generator-app`;
(2) the same log expanded in Kibana showing its stored `app.*` fields;
(3) a working search — `app.severity : "error"` — returning results.*
