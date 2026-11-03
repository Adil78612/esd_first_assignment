# A3 – Load balancing with Envoy

Three copies of the app (A, B, C) behind Envoy, watched with Prometheus, Grafana and Kibana.

## 1. Start

```powershell
docker compose up -d --build --scale app=3
```

Always keep `--scale app=3`, or Docker goes back to one replica.

| What | Where |
|---|---|
| HTTP (through Envoy) | http://localhost:8080 |
| gRPC (through Envoy) | localhost:8081 |
| Envoy admin | http://localhost:9901 |
| Prometheus | http://localhost:9090 |
| Grafana (admin / admin) | http://localhost:3001 |
| Kibana | http://localhost:5601 |

A = `esd_first_assignment-app-1`, B = `app-2`, C = `app-3`.

## 2. Send test traffic

Run both at the same time, in two windows:

```powershell
python loadtest.py http --rate 20 --duration 60 --label NAME
python loadtest.py grpc --rate 20 --duration 60 --label NAME
```

Results print on screen and are added to `results.csv`.

## 3. Experiments

Normal setup = round robin + health checks (`envoy/envoy-rr.yaml`).
To switch Envoy's setup, copy a file over `envoy/envoy.yaml` and restart Envoy:

```powershell
Copy-Item envoy\envoy-weighted.yaml envoy\envoy.yaml -Force
docker compose restart envoy
```

| Experiment | Envoy file | Extra step |
|---|---|---|
| Round robin | `envoy-rr.yaml` | – |
| Weighted 2:1:1 | `envoy-weighted.yaml` | – |
| Least request | `envoy-least-request.yaml` | slow down B (below) |
| Failure + recovery | `envoy-rr.yaml` | stop, then start B (below) |

Slow down B by 200 ms (set back to 0 afterwards):

```powershell
docker exec esd_first_assignment-app-2 node -e "fetch('http://localhost:3000/admin/delay?ms=200',{method:'POST'}).then(r=>r.text()).then(console.log)"
```

Stop B, then start it again:

```powershell
docker stop -t 0 esd_first_assignment-app-2
docker start esd_first_assignment-app-2
```

Check what Envoy is doing:

```powershell
(Invoke-WebRequest http://localhost:9901/clusters -UseBasicParsing).Content -split "`n" | Select-String "hostname|health_flags|weight"
```

## 4. Recover (back to normal)

```powershell
Copy-Item envoy\envoy-rr.yaml envoy\envoy.yaml -Force
docker compose restart envoy
docker start esd_first_assignment-app-2
docker exec esd_first_assignment-app-2 node -e "fetch('http://localhost:3000/admin/delay?ms=0',{method:'POST'}).then(r=>r.text()).then(console.log)"
```

## Notes

- The database lives on a Docker volume (`app_data`), shared by all replicas.
  It was moved off a Windows folder because that made requests freeze.
- Replica IPs change after a rebuild. Use the "check" command above to see them.
- Grafana dashboard: `grafana/a3-dashboard.json` (import it in Grafana).