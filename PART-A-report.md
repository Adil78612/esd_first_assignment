# Part A — HTTP API report

## REST constraints

| Constraint | Plain meaning | In my API |
|-----------|---------------|-----------|
| Client–Server | Client (UI / Python caller) and server are separate; they only talk over HTTP. | Browser and `caller.py` call the Express server; neither knows the other's internals. |
| Stateless | Each request carries everything needed; the server keeps no per-client session. | Every `POST /api/generations` includes the full body (id, type, content); no session state. |
| Cacheable | Responses can say whether they may be reused. | GET `/api/generations/:id` is a safe, cacheable read; writes are not cached. |
| Uniform Interface | Resources have consistent URLs + standard methods + standard status codes. | `/api/generations` (collection) and `/api/generations/:id` (item), POST to create, GET to read, 201/200/400/404/429. |
| Layered System | Client can't tell if it's talking to the origin or an intermediary. | Prometheus/Docker network sit in front; the client only sees `localhost:3000`. |
| Code on Demand (optional) | Server may send executable code to the client. | **Not demonstrated** — my API returns only JSON data, no client code. |

## OpenAPI — what it is and how I used it

OpenAPI is a standard, machine-readable description (a YAML/JSON file) of an
HTTP API: its routes, inputs, and possible responses. Because it is
machine-readable, tools can render interactive docs, test endpoints, generate
clients, or validate requests from the one spec. I wrote `openapi.yaml`
describing `/api/generations` (POST/GET) and `/api/generations/{id}`, then
served it through Swagger UI at `/docs`. I used the Swagger "Try it out"
button to fire a live `POST /api/generations` and saw the real 201/200/400
responses from the running server.

## API before/after (user task: "save a generation")

| | Before (A1) | After (A2) |
|---|---|---|
| Endpoint | `POST /api/favorite` | `POST /api/generations` |
| Problem | Only incremented a counter; nothing was actually saved, no id, no retrieval, no duplicate protection. | Saves a real item to SQLite; retrievable; idempotent. |
| Change | Replaced with a resource endpoint backed by `db.js` (SQLite). | Returns **201** on first save, **200** on repeat (idempotent), **400** on invalid input with a consistent error shape, **429** when rate limited. |
| Reason | A countable "favorite" can't demonstrate idempotency or a shared source of truth (needed for Part B gRPC). A real saved resource can. | Gives one source of truth both HTTP and gRPC call, and a safely-retryable operation. |

**Other endpoints:** `/api/generate` and `/api/regenerate` were left as-is
(stateless generation). `/api/favorite` was superseded by `/api/generations`.
Admin/experiment endpoints (`/admin/*`) and infrastructure
(`/metrics`, `/`) were excluded per the brief.

**Practices applied to `/api/generations`:**
- **Validation + status codes + consistent errors:** bad input → `400` with `{error:{code,messages}}`.
- **Idempotency:** same `id` twice → no duplicate (`201` then `200`); retrying a save is therefore safe.
- **Rate limiting:** 5 requests / 10s window, shared across all callers; the 6th gets `429 Too Many Requests` with a `Retry-After` header stating seconds until the window resets.

## Reliability test (Python caller)

`caller.py` acts as another service calling `POST /api/generations`.
Settings: **timeout 2s, max 3 retries, backoff 0.5s doubling (0.5/1.0),
circuit breaker trips after 3 consecutive failures, 5s recovery.**

Observed (server failure injected via `/admin/failsaves`):
- **Healthy:** calls succeed.
- **Failing:** first call fails, retries with backoff, then after 3 failures the **breaker OPENS** and subsequent calls are **blocked without being attempted**.
- **Recovery:** after the 5s cooldown the breaker goes **HALF_OPEN**, one test call succeeds, and it returns to **CLOSED**.

Retrying is safe here only because the save operation is idempotent — a
retried save cannot create a duplicate. Rate limiting was demonstrated
separately (the 429 burst test).
