# Part B — gRPC service report

## What was built

One operation from the chosen task — **SaveGeneration** — was implemented as
a gRPC service in a separate process (`grpc_server.js`, port 50051). The HTTP
`POST /api/generations` was kept. Both call the **same `db.js`** (shared
SQLite file), so they use the same business rules and source of truth — the
gRPC service is not a wrapper around the HTTP endpoint.

## Contract, generation, handler

- **`.proto`:** `generations.proto` defines `service GenerationService` with
  one RPC, `SaveGeneration(SaveRequest) returns (SaveReply)`, and the message
  fields.
- **Generation command (Python client side):**
  `python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. generations.proto`
  → produces `generations_pb2.py` (messages) and `generations_pb2_grpc.py`
  (the client **stub**). The Node server loads the `.proto` at runtime via
  `@grpc/proto-loader`.
- **Handler:** `saveGeneration()` in `grpc_server.js` validates input and
  calls `db.saveGeneration()` / `db.getGeneration()`.

## Python client

`grpc_client.py` opens an insecure channel to `localhost:50051`, builds the
stub, and calls `SaveGeneration` with a **2-second deadline** (`timeout=`).
It reports results or gRPC errors.

## One success + one failure through both versions

| Case | HTTP (`POST /api/generations`) | gRPC (`SaveGeneration`) |
|------|-------------------------------|-------------------------|
| Valid save | `201 Created` (or `200` if it already existed) | status `OK`, `created=true/false` |
| Invalid input | `400 Bad Request` + error JSON | status `INVALID_ARGUMENT` (code 3) |

**Status explanation:** HTTP maps outcomes to numeric status codes
(2xx success, 4xx client error). gRPC maps them to named status codes
(`OK`, `INVALID_ARGUMENT`, `NOT_FOUND`, `UNAVAILABLE`, …). Both describe the
same two outcomes — success and a client-side validation error — through
different status systems. Because both front doors call the same `db.js`,
saving an id over HTTP and then over gRPC returns `created=false` on the
second call: proof of a shared source of truth, not a wrapper.

## Call paths

See `callpath-diagram.png`:
- **HTTP:** browser/PowerShell → Express route (`app.js`) → `db.js` → SQLite.
- **gRPC:** `grpc_client.py` → generated stub (`generations_pb2_grpc`) →
  gRPC server handler (`grpc_server.js`) → `db.js` → SQLite.

Both converge on the same `db.js` module.

## Logs + trace correlation across the boundary

The Python client generates a `trace_id` per call and sends it as gRPC
metadata (`trace-id`). The gRPC server reads that metadata and logs each RPC
as JSON (same style as A1) with the `trace_id`, `rpc`, and `grpc_status`
fields. The same trace id therefore appears in both the client output and the
server log, so a single request is traceable across the gRPC boundary.
