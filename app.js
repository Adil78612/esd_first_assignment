const express = require('express');
const client = require('prom-client');
const crypto = require('crypto');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const SERVICE = 'generator-app';

// ---------- Structured JSON logging (one line per event -> stdout) ----------
function log(severity, message, extra = {}) {
  process.stdout.write(JSON.stringify({
    '@timestamp': new Date().toISOString(),
    app_name: SERVICE,
    severity,
    message,
    ...extra,
  }) + '\n');
}

// ---------- Metrics registry ----------
const register = new client.Registry();
client.collectDefaultMetrics({ register }); // CPU/mem/eventloop of THIS process

// COUNTER (business): total generations, split by type
const generationsTotal = new client.Counter({
  name: 'generations_total', help: 'Total content generations',
  labelNames: ['type'], registers: [register],
});
// COUNTER (business): favorites + regenerations
const favoritesTotal = new client.Counter({
  name: 'favorites_total', help: 'Total favorites', registers: [register],
});
const regenerationsTotal = new client.Counter({
  name: 'regenerations_total', help: 'Total regenerations', registers: [register],
});
// COUNTER (app): every HTTP request, labeled by route + status (failures = status="500")
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total', help: 'HTTP requests by route and status',
  labelNames: ['method', 'route', 'status'], registers: [register],
});
// GAUGE (app): generations running right now
const inProgress = new client.Gauge({
  name: 'generations_in_progress', help: 'Generations currently running',
  registers: [register],
});
// HISTOGRAM (app): request latency buckets
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds', help: 'HTTP request duration in seconds',
  labelNames: ['route'], buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});
// SUMMARY (app): generation time with p50/p90/p95/p99
const genSummary = new client.Summary({
  name: 'generation_duration_seconds', help: 'Generation duration summary',
  labelNames: ['type'], percentiles: [0.5, 0.9, 0.95, 0.99],
  registers: [register],
});
// Cardinality demo counters (Part E2)
const demoLabeled = new client.Counter({
  name: 'demo_requests_total', help: 'Cardinality demo WITH request_id label',
  labelNames: ['request_id'], registers: [register],
});
const demoNoLabel = new client.Counter({
  name: 'demo_requests_nolabel_total', help: 'Cardinality demo WITHOUT label',
  registers: [register],
});

// ---------- runtime state ----------
let faultOn = false;   // Part E1 fault injection
let reqCounter = 0;    // used to hit "every 5th request"
let cardCount = 0;     // caps cardinality demo at 100

const QUOTES = [
  'The obstacle is the way.',
  'What we do now echoes in eternity.',
  'Simplicity is the ultimate sophistication.',
  'Fall seven times, stand up eight.',
  'The cave you fear holds the treasure you seek.',
  'Well begun is half done.',
  'Make each day your masterpiece.',
  'Slow is smooth, smooth is fast.',
];
const COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#8338ec', '#06d6a0'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomArt = () => {
  const c1 = COLORS[Math.floor(Math.random() * COLORS.length)];
  const c2 = COLORS[Math.floor(Math.random() * COLORS.length)];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${c1}"/><circle cx="100" cy="100" r="${40 + Math.random() * 50}" fill="${c2}"/></svg>`;
};

// ---------- request timing + logging middleware ----------
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  const stop = httpDuration.startTimer({ route: req.path });
  res.on('finish', () => {
    stop();
    httpRequestsTotal.inc({ method: req.method, route: req.path, status: res.statusCode });
    log(res.statusCode >= 500 ? 'error' : 'info', 'request handled', {
      request_id: req.requestId, method: req.method, route: req.path, status: res.statusCode,
    });
  });
  next();
});

// ---------- core generation ----------
async function doGenerate(type, requestId) {
  inProgress.inc();
  const endSummary = genSummary.startTimer({ type });
  try {
    let ms = type === 'art' ? 300 + Math.random() * 1700 : 20 + Math.random() * 80;
    reqCounter++;
    if (faultOn && reqCounter % 5 === 0) {           // Part E1: every 5th request slower
      ms += 1500;
      log('warn', 'fault injected: +500ms', { request_id: requestId, type });
    }
    await sleep(ms);
    if (type === 'art' && Math.random() < 0.05) {    // ~5% art failures feed the failure metric
      throw new Error('art render failed');
    }
    generationsTotal.inc({ type });
    return type === 'art' ? { type, svg: randomArt() }
                          : { type, quote: QUOTES[Math.floor(Math.random() * QUOTES.length)] };
  } finally {
    endSummary();
    inProgress.dec();
  }
}

// ---------- routes ----------
app.post('/api/generate', async (req, res) => {
  const type = req.query.type === 'art' ? 'art' : 'quote';
  try {
    res.json(await doGenerate(type, req.requestId));
  } catch (e) {
    log('error', 'generation failed', { request_id: req.requestId, type, error_message: e.message });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/regenerate', async (req, res) => {
  regenerationsTotal.inc();
  const type = req.query.type === 'art' ? 'art' : 'quote';
  try {
    res.json(await doGenerate(type, req.requestId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/favorite', (req, res) => {
  favoritesTotal.inc();
  res.json({ ok: true });
});

// Part E1: toggle the fault.  POST /admin/fault?on=true|false
app.post('/admin/fault', (req, res) => {
  faultOn = req.query.on === 'true';
  reqCounter = 0;
  log('warn', `fault set to ${faultOn}`, {});
  res.json({ faultOn });
});

// Part E2: each call adds ONE new request_id label value, capped at 100
app.post('/admin/cardinality', (req, res) => {
  if (cardCount >= 100) return res.json({ stopped: true, uniqueSeries: cardCount });
  cardCount++;
  demoLabeled.inc({ request_id: crypto.randomUUID() });
  res.json({ uniqueSeries: cardCount });
});
app.post('/admin/cardinality-nolabel', (req, res) => {
  demoNoLabel.inc();
  res.json({ ok: true });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html><meta charset=utf-8><title>Generator</title>
<style>body{font-family:system-ui;max-width:640px;margin:40px auto}button{padding:10px 16px;margin:4px;font-size:15px}#out{margin-top:20px;padding:16px;border:1px solid #ccc;min-height:60px}</style>
<h1>Quote / Art Generator</h1>
<button onclick="g('quote')">Generate quote</button>
<button onclick="g('art')">Generate art</button>
<button onclick="fav()">Favorite</button>
<button onclick="regen()">Regenerate</button>
<div id=out></div>
<script>
async function g(t){const r=await fetch('/api/generate?type='+t,{method:'POST'});const d=await r.json();out.innerHTML=d.quote||d.svg||JSON.stringify(d)}
async function fav(){await fetch('/api/favorite',{method:'POST'});out.textContent='Favorited'}
async function regen(){const r=await fetch('/api/regenerate?type=art',{method:'POST'});const d=await r.json();out.innerHTML=d.svg||d.quote}
</script>`);
});

app.listen(PORT, () => log('info', `listening on ${PORT}`, {}));