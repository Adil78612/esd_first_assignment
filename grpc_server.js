// grpc_server.js — gRPC service for SaveGeneration, with Prometheus metrics.
// Handler calls the SAME db.js as the HTTP API (shared source of truth).

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const client = require('prom-client');
const db = require('./db');
const REPLICA = require('os').hostname();

const PORT = process.env.GRPC_PORT || 50051;
const METRICS_PORT = process.env.GRPC_METRICS_PORT || 9091;

// ---------- Prometheus metrics (bounded labels only: method, status) ----------
const register = new client.Registry();
register.setDefaultLabels({ replica: REPLICA });
client.collectDefaultMetrics({ register });

const grpcCalls = new client.Counter({
  name: 'grpc_calls_total', help: 'gRPC calls by method and status',
  labelNames: ['method', 'status'], registers: [register],
});
const grpcDuration = new client.Histogram({
  name: 'grpc_call_duration_seconds', help: 'gRPC call duration (server-side)',
  labelNames: ['method'], buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});
const grpcInFlight = new client.Gauge({
  name: 'grpc_in_flight_calls', help: 'gRPC calls currently being handled',
  labelNames: ['method'], registers: [register],
});

// ---------- load proto ----------
const packageDef = protoLoader.loadSync(path.join(__dirname, 'generations.proto'), {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef).generations;

// ---------- handler ----------
async function saveGeneration(call, callback) {
  const method = 'SaveGeneration';
  grpcInFlight.inc({ method });
  const endTimer = grpcDuration.startTimer({ method });
  // A3 Part D: same injected delay as HTTP (shared setting, same process)
  const delay = globalThis.injectedDelayMs || 0;
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
  const md = call.metadata.get('trace-id');
  const traceId = (md && md[0]) || crypto.randomUUID();
  function logRpc(severity, message, extra = {}) {
    console.log(JSON.stringify({
      '@timestamp': new Date().toISOString(), app_name: 'grpc-generator', replica: REPLICA,
      severity, message, trace_id: traceId, rpc: method, ...extra,
    }));
  }
  function finish(status) {
    endTimer();
    grpcInFlight.dec({ method });
    grpcCalls.inc({ method, status });
  }

  const { id, type, content } = call.request;
  if (!id || (type !== 'quote' && type !== 'art') || !content) {
    logRpc('error', 'rpc rejected', { grpc_status: 'INVALID_ARGUMENT' });
    finish('INVALID_ARGUMENT');
    return callback({ code: grpc.status.INVALID_ARGUMENT,
      message: 'id required, type must be quote|art, content required' });
  }

  const { created } = db.saveGeneration({ id, type, content });
  const saved = db.getGeneration(id);
  logRpc('info', 'rpc handled', { grpc_status: 'OK', id, created });
  finish('OK');
  callback(null, {
    created, id: saved.id, type: saved.type,
    content: saved.content, created_at: saved.created_at,
  });
}

// ---------- start gRPC server ----------
const server = new grpc.Server();
server.addService(proto.GenerationService.service, { SaveGeneration: saveGeneration });
server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), () => {
  console.log(JSON.stringify({
    '@timestamp': new Date().toISOString(), app_name: 'grpc-generator', replica: REPLICA,
    severity: 'info', message: `gRPC server listening on ${PORT}`,
  }));
});

// ---------- tiny HTTP server so Prometheus can scrape /metrics ----------
http.createServer(async (req, res) => {
  if (req.url === '/metrics') {
    res.setHeader('Content-Type', register.contentType);
    res.end(await register.metrics());
  } else {
    res.statusCode = 404; res.end();
  }
}).listen(METRICS_PORT, () => {
  console.log(JSON.stringify({
    '@timestamp': new Date().toISOString(), app_name: 'grpc-generator', replica: REPLICA,
    severity: 'info', message: `metrics on ${METRICS_PORT}/metrics`,
  }));
});