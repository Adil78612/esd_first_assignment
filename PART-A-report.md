# Part A: Improving the HTTP API

## REST principles

| Constraint | Plain meaning | Example from my API |
|---|---|---|
| Client–Server | The client (UI or caller) and the server are separate and only talk over HTTP. | The web page and `caller.py` both call the Express server at `localhost:3000`; neither knows how it stores data. |
| Stateless | Each request carries everything the server needs; no session is kept between requests. | `POST /api/generations` sends `id`, `type` and `content` every time; the server remembers nothing about the caller. |
| Cacheable | Responses say whether they can be reused, so clients don't refetch unchanged data. | Express adds an `ETag` header to responses (seen in the test output), so a repeated `GET /api/generations/:id` can be revalidated instead of re-downloaded. |
| Uniform Interface | Resources have consistent URLs, standard methods and standard status codes. | `/api/generations` (collection) and `/api/generations/:id` (item); POST to create, GET to read; 201/200/400/404/429. |
| Layered System | The client can't tell whether it talks to the server directly or through something in between. | Docker networking and Prometheus sit around the app; the client only sees `localhost:3000`. |
| Code on Demand (optional) | The server may send code for the client to run. | Not demonstrated: the API returns JSON data only. |

## OpenAPI

OpenAPI is a standard, machine-readable description (YAML or JSON) of an HTTP API: its routes, inputs and possible responses. Because tools can read it, one spec can produce interactive docs, test requests, generate clients or validate inputs.

I wrote `openapi.yaml` describing `POST /api/generations`, `GET /api/generations` and `GET /api/generations/{id}`, including the 201, 200, 400, 404, 429 and 503 responses. It is served through Swagger UI at `http://localhost:3000/docs`. I used Swagger's "Try it out" button to send a live `POST /api/generations` and saw the real response from the running server.

*[Screenshot: Swagger UI with the live response]*

## Practices applied

All work is on `POST /api/generations`. Health, metrics and admin endpoints are excluded.

- **Clear path and method:** a plural resource path; POST creates, GET reads.
- **Input validation:** `id` and `content` must be strings, and `type` must be `quote` or `art`.
- **Meaningful status codes:** 201 for new, 200 for a repeat, 400 for bad input, 404 for not found, 429 for rate limited.
- **Consistent error format:** every error returns `{"error": {"code": "...", "messages": [...]}}`.
- **Idempotency:** the caller supplies the `id`. Saving the same `id` again returns `200` with `created:false` and creates no duplicate, so retries are safe.
- **Rate limiting:**
  - Limit: 5 requests per 10-second window.
  - Who shares it: all callers together; it is one global counter.
  - Request 6 onward gets `429 Too Many Requests` with a `Retry-After` header.
  - That header gives the seconds until the window resets, which is when calls are allowed again.

### Rate-limit evidence

```
req 1-5  ->  STATUS 201
req 6    ->  STATUS 429  (Retry-After: 7 s)
req 7    ->  STATUS 429  (Retry-After: 7 s)
req 8    ->  STATUS 429  (Retry-After: 7 s)
Body: {"error":{"code":"RATE_LIMITED","messages":["limit is 5 requests per 10s"]}}
```

*[Screenshot: burst test]*

## Before / after: user task "save a generation"

| | Before (A1) | After (A2) |
|---|---|---|
| Endpoint | `POST /api/favorite` | `POST /api/generations` |
| Problem | Only incremented a counter. Nothing was saved, there was no id, no retrieval and no duplicate protection. | — |
| Change | — | A real resource saved in SQLite (`db.js`), with validation, idempotency, consistent errors and rate limiting. |
| Reason | — | A saved item can be retrieved and safely retried, and it gives HTTP and gRPC one shared source of truth. |

**Other endpoints**
- **Added:** `GET /api/generations` and `GET /api/generations/:id`, which returns 404 if the id is missing.
- **Left alone:** `/api/generate` and `/api/regenerate` are stateless and already fine for their purpose. `/api/favorite` is kept for the web page.
- **Excluded:** `/`, `/metrics`, `/docs` and the `/admin/*` experiment endpoints.

**Callers updated:** `/api/generations` is new, so no existing caller broke. The web page's Favorite button still uses `/api/favorite`. The new callers are `caller.py` and `grpc_client.py`.

## Tests: valid, invalid, repeated

| Test | Request body | Result |
|---|---|---|
| Valid | `{"id":"t1","type":"quote","content":"x"}` | **201 Created**, `"created":true` |
| Invalid | `{"id":"t2","type":"banana","content":"x"}` | **400**, `{"error":{"code":"VALIDATION_ERROR","messages":["type must be \"quote\" or \"art\""]}}` |
| Repeated | same as Valid | **200 OK**, `"created":false`, same `created_at` (`2026-10-05T09:52:37.380Z`), so no duplicate was created |

*[Screenshot: the three PowerShell results]*

## Reliability: Python caller

`caller.py` acts as another service calling `POST /api/generations`. It makes several calls in one run.

**Settings**
- Timeout: 2 s per request.
- Retries: at most 3, with backoff starting at 0.5 s and doubling (0.5 s, then 1.0 s).
- Circuit breaker: opens after 3 consecutive failures and stays open for a 5 s recovery period.

**Results** (server failure injected via `/admin/failsaves`)
- **Healthy:** calls succeed.
- **Failing:** a call fails and is retried with backoff. After 3 failures the breaker **opens**, and later calls are **blocked** without reaching the server.
- **Recovery:** after 5 s the breaker goes **half-open**. One test call succeeds and the breaker **closes**.

Retrying is safe only because the save is idempotent: a retried save cannot create a duplicate. Rate limiting was tested separately with the burst test above.

*[Paste caller.py output or screenshot]*