# README — Assignment 2 additions

Append these to the existing A1 README.

## New dependencies

Node: `better-sqlite3 swagger-ui-express yaml @grpc/grpc-js @grpc/proto-loader`
Python: `requests grpcio grpcio-tools`

```
npm install
pip install requests grpcio grpcio-tools
```

## Run

HTTP API + full observability stack (Docker):
```
docker compose up -d --build
```
gRPC service (runs on the host, scraped by Prometheus via host.docker.internal:9091):
```
node grpc_server.js        # gRPC on 50051, metrics on 9091/metrics
```

## Generate the gRPC Python code (if not already generated)

```
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. generations.proto
```

## Test

HTTP save (idempotent): 201 first, 200 on repeat, 400 on bad input
```
# see status codes explicitly
Invoke-WebRequest -Method Post "http://localhost:3000/api/generations" -ContentType "application/json" -Body '{"id":"a","type":"quote","content":"x"}' -UseBasicParsing
```

Rate limit (429 + Retry-After): fire 8 rapid saves
```
1..8 | ForEach-Object { Invoke-WebRequest -Method Post "http://localhost:3000/api/generations" -ContentType "application/json" -Body "{""id"":""r$_"",""type"":""quote"",""content"":""x""}" -UseBasicParsing }
```

Reliability (timeout / retry / circuit breaker):
```
python caller.py
```

gRPC client (success + failure, with deadline + trace id):
```
python grpc_client.py
```

Generate gRPC load for the dashboard:
```
1..30 | ForEach-Object { python grpc_client.py }
```

## Interactive API docs (OpenAPI / Swagger)

Open http://localhost:3000/docs

## Endpoints (new/changed)

- `POST /api/generations` — save a generation (idempotent, validated, rate limited)
- `GET  /api/generations` — list
- `GET  /api/generations/:id` — fetch one (404 if missing)
- `POST /admin/failsaves?on=true|false` — inject save failure (for the reliability test)
- gRPC `SaveGeneration` on :50051; metrics on :9091/metrics

## Clean up

```
docker compose down          # keep data
docker compose down -v        # delete volumes too
```
