require('dotenv').config();
const express      = require('express');
const http         = require('http');
const cookieParser = require('cookie-parser');
const path         = require('path');
const fs           = require('fs');
const { WebSocketServer } = require('ws');

const authRoutes      = require('./src/routes/auth');
const agentRoutes     = require('./src/routes/agents');
const routeRoute      = require('./src/routes/route');
const wardenRoutes    = require('./src/routes/warden');
const forgeRoutes     = require('./src/routes/forge');
const scribeRoutes    = require('./src/routes/scribe');
const scoutRoutes     = require('./src/routes/scout');
const lensRoutes      = require('./src/routes/lens');
const courierRoutes   = require('./src/routes/courier');
const archivistRoutes = require('./src/routes/archivist');
const keeperRoutes    = require('./src/routes/keeper');
const operatorRoutes  = require('./src/routes/operator');
const codexRoutes     = require('./src/routes/codex');
const jobsRoutes      = require('./src/routes/jobs');
const logsRoutes      = require('./src/routes/logs');
const receptionRoutes = require('./src/routes/reception');
const feedbackRoutes  = require('./src/routes/feedback');
const discordRoutes   = require('./src/routes/discord');
const helmRoutes      = require('./src/routes/helm');
const forgeAgent      = require('./src/forge');
const requireAuth     = require('./src/middleware/requireAuth');
const sentinel        = require('./src/sentinel');
const scribe          = require('./src/scribe');
const heartbeat       = require('./src/heartbeat');
const registry        = require('./src/agentRegistry');
const db              = require('./src/db');
const botAdmins       = require('./src/botAdmins');
const redis           = require('./src/redis');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.OPENCLAW_PORT || 18789;

// Ensure logs/ dir exists for PM2 log files
fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Heartbeat middleware — pulse on every real HTTP request ───────────────────
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/heartbeat')) heartbeat.pulse();
  next();
});

// ── Public routes ─────────────────────────────────────────────────────────────

app.get('/api/heartbeat', (req, res) => {
  res.json(heartbeat.getStatus());
});

app.use('/auth', authRoutes);

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── React UI static files (public — assets must load before auth check) ───────
app.use(express.static(path.join(__dirname, 'ui/dist')));

// ── Portal reception — allow portal terminal via shared secret OR normal auth ──
const PORTAL_SECRET = process.env.PORTAL_SECRET;
app.use('/api/reception',
  (req, res, next) => {
    // Portal-to-Ghost server call with shared secret
    if (PORTAL_SECRET && req.headers['x-portal-secret'] === PORTAL_SECRET) {
      req.user = { username: 'portal', role: 'ADMIN' };
      return next();
    }
    // Normal auth (Discord session JWT)
    requireAuth(req, res, next);
  },
  receptionRoutes,
);

// ── Portal data routes — allow via shared secret OR normal auth ────────────────
const PORTAL_BYPASS = (req, res, next) => {
  if (PORTAL_SECRET && req.headers['x-portal-secret'] === PORTAL_SECRET) {
    req.user = { username: 'portal', role: 'ADMIN' };
    return next();
  }
  requireAuth(req, res, next);
};

app.use('/api/feedback',      PORTAL_BYPASS, feedbackRoutes);
app.use('/api/discord',       PORTAL_BYPASS, discordRoutes);
app.use('/api/jobs',          PORTAL_BYPASS, jobsRoutes);
app.use('/api/logs',          PORTAL_BYPASS, logsRoutes.router);
app.use('/api/errors',        PORTAL_BYPASS, logsRoutes.errorsRouter);
app.use('/api/forge',         PORTAL_BYPASS, forgeRoutes);
app.get('/api/scribe/brief',  PORTAL_BYPASS, async (req, res) => {
  try {
    const summary = await scribe.dailySummary({ narrative: false });
    res.json({
      briefing: summary.content || 'No briefing available.',
      period:   summary.date   || new Date().toISOString().slice(0, 10),
      ts:       new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Protected routes ──────────────────────────────────────────────────────────
app.use(requireAuth);

app.use('/api/agents',    agentRoutes);
app.use('/api/route',     routeRoute);
app.use('/api/warden',    wardenRoutes);
app.use('/api/scribe',    scribeRoutes);
app.use('/api/scout',     scoutRoutes);
app.use('/api/lens',      lensRoutes);
app.use('/api/courier',   courierRoutes);
app.use('/api/archivist', archivistRoutes);
app.use('/api/keeper',    keeperRoutes);
app.use('/api/operator',  operatorRoutes);
app.use('/api/codex',     codexRoutes);
app.use('/api/helm',      helmRoutes);

// ── SPA catch-all — serve React app for any non-API route ─────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'ui/dist/index.html'));
});

// ── WebSocket server — /ws path for the React office UI ───────────────────────
const wss     = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws, req) => {
  clients.add(ws);

  // Send initial state
  try {
    ws.send(JSON.stringify({ type: 'init', agents: registry.getAll() }));
  } catch { /* non-fatal */ }

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => { clients.delete(ws); });
});

function _broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(payload); } catch { clients.delete(ws); }
    }
  }
}

// Subscribe to agent registry changes and broadcast them
registry.subscribe((agentId, update) => {
  if (update.__event) {
    _broadcast({ type: 'agent:event', id: agentId, message: update.message, ts: update.ts });
  } else {
    _broadcast({ type: 'agent:update', agent: update });
  }
});

// ── Auto-fix: listen for ERROR log entries and attempt automatic code repair ───
{
  // Track last fix time per file to avoid thrashing (max 1 fix per file per 10min)
  const _fixCooldowns = new Map();
  db.events.on('error-logged', async (entry) => {
    const note = entry.note || '';
    // Quick pre-filter: only attempt if note looks like it contains a JS file path
    if (!/(?:src|openclaw|portal)\/[\w/.-]+\.[jt]sx?/.test(note)) return;
    const cooldownKey = note.slice(0, 80); // use note prefix as key
    const last = _fixCooldowns.get(cooldownKey) || 0;
    if (Date.now() - last < 10 * 60 * 1000) return; // 10-min cooldown per error
    _fixCooldowns.set(cooldownKey, Date.now());
    console.log(`[AutoFix] Error detected in ${entry.agent} — attempting auto-repair…`);
    forgeAgent.autoFix({ errorNote: note, restart: true }).then(r => {
      console.log(`[AutoFix] ${r.fixed ? '✓ Fixed' : '✗ No fix'}: ${r.summary}`);
    }).catch(() => {});
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`OpenClaw gateway running on http://localhost:${PORT}`);
  db.initSchema()
    .then(() => botAdmins.load())
    .catch(err => console.error('[DB] Schema init failed:', err.message));
  redis.waitReady(5000).then(ok =>
    console.log(`[Redis] ${ok ? 'Connected ✓' : 'Unavailable — fallbacks active'}`)
  );
  heartbeat.start();
  sentinel.start().catch(err => console.error('[Sentinel] Failed to start:', err.message));
  scribe.start();
});
