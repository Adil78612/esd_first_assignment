# ESD Assignment 1 — Observability

A minimal Node/Express app (a quote & art generator) instrumented with a full
observability stack: **Prometheus + Grafana** for metrics and
**Filebeat + Elasticsearch + Kibana** for logs, all run with Docker Compose.

## Services and ports

| Service | URL | Purpose |
|---------|-----|---------|
| generator-app | http://localhost:3000 | the app (buttons + `/metrics`) |
| Prometheus | http://localhost:9090 | scrapes & stores metrics |
| Grafana | http://localhost:3001 | metric dashboards (login `admin` / `admin`) |
| node-exporter | http://localhost:9100 | machine CPU/memory/disk metrics |
| Elasticsearch | http://localhost:9200 | stores & indexes logs |
| Kibana | http://localhost:5601 | log search UI |
| Filebeat | (no UI) | ships container logs to Elasticsearch |

## Prerequisites

- Docker Desktop (with the WSL2 backend on Windows).
- At least ~4 GB free RAM for the stack. On Windows, if Docker runs out of
  memory, raise the WSL2 limit in `C:\Users\<you>\.wslconfig`:
  ```
  [wsl2]
  memory=10GB
  processors=4
  swap=2GB
  ```
  then run `wsl --shutdown` and restart Docker Desktop.

## Start

From the project root:

```bash
docker compose up -d --build
```

First run pulls the images and builds the app (a few minutes). Elasticsearch
and Kibana take 1–2 minutes to become ready after the containers start.

Verify everything is up:

```bash
docker ps                                   # all 7 containers "Up"
```

- App: open http://localhost:3000 and click the buttons.
- Metrics: http://localhost:9090/targets — all targets should be **UP**.
- Dashboards: http://localhost:3001 (admin/admin).
- Logs: http://localhost:5601 → Discover.

## Use / generate traffic

Click the buttons at http://localhost:3000, or generate steady load from
PowerShell:

```powershell
while ($true) {
  foreach ($t in "quote","art") {
    try { Invoke-RestMethod -Method Post "http://localhost:3000/api/generate?type=$t" | Out-Null } catch {}
  }
  Start-Sleep -Milliseconds 500
}
```

## Test / experiments (Part E)

**Anomaly (latency fault):**
```powershell
Invoke-RestMethod -Method Post "http://localhost:3000/admin/fault?on=true"    # inject delay
Invoke-RestMethod -Method Post "http://localhost:3000/admin/fault?on=false"   # remove it
```
Watch the p95 latency panel in Grafana rise, then recover.

**Cardinality explosion:**
```powershell
1..100 | ForEach-Object { Invoke-RestMethod -Method Post "http://localhost:3000/admin/cardinality" | Out-Null }
```
Then in Prometheus compare `count(demo_requests_total)` (climbs to 100 — one
series per `request_id` label) against `count(demo_requests_nolabel_total)`
(stays 1). This shows why high-variety values belong in logs, not labels.

## Kibana searches

Data view: `filebeat-*`.
- All app logs: `app.app_name : "generator-app"`
- Errors only: `app.severity : "error"`
- One request: `app.request_id : "<id>"`

## Clean up

Stop the containers (keeps data volumes):

```bash
docker compose down
```

Stop **and delete all stored data** (metrics, dashboards, logs):

```bash
docker compose down -v
```

## Notes

- Art generation latency is **simulated** (a random delay) so the app
  produces controllable, variable response times for the metrics — it does
  not call a real image model.
- Grafana's Prometheus data source is provisioned automatically
  (`grafana/provisioning/datasources/datasource.yml`).
- Filebeat parses the app's JSON logs and nests fields under `app.*`
  (`target: "app"`) to avoid clashing with Elasticsearch's ECS field
  mappings.
