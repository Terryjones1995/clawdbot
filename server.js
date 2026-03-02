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
const jobsRoutes      = require('./src/routes/jobs');
const logsRoutes      = require('./src/routes/logs');
const creditsRoutes   = require('./src/routes/credits');
const tasksRoutes     = require('./src/routes/tasks');
const settingsRoutes  = require('./src/routes/settings');
const lessonsRoutes   = require('./src/routes/lessons');
const trainingRoutes  = require('./src/routes/training');
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
const ollama          = require('./openclaw/skills/ollama');

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

app.get('/api/heartbeat', async (req, res) => {
  res.json(await heartbeat.getStatus());
});

app.get('/api/health', async (req, res) => {
  const checks = {};
  // Database
  try {
    const t0 = Date.now();
    await db.query('SELECT 1');
    checks.database = { status: 'up', ping: Date.now() - t0 };
  } catch { checks.database = { status: 'down' }; }
  // Redis
  try {
    const t0 = Date.now();
    const ok = await redis.ping();
    checks.redis = { status: ok ? 'up' : 'down', ping: ok ? Date.now() - t0 : undefined };
  } catch { checks.redis = { status: 'down' }; }
  // Ollama
  try {
    const t0  = Date.now();
    const olr = await fetch(`${process.env.OLLAMA_HOST || 'http://localhost:11434'}/api/tags`);
    checks.ollama = { status: olr.ok ? 'up' : 'down', ping: Date.now() - t0 };
  } catch { checks.ollama = { status: 'down' }; }
  // Discord
  const sent = registry.get('sentinel');
  checks.discord = { status: sent?.status === 'online' || sent?.status === 'working' ? 'up' : 'down' };

  res.json(checks);
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

app.get('/api/agents/stats', PORTAL_BYPASS, async (req, res) => {
  try {
    const stats = await db.getAgentStats();
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/feedback',      PORTAL_BYPASS, feedbackRoutes);
app.use('/api/discord',       PORTAL_BYPASS, discordRoutes);
app.use('/api/jobs',          PORTAL_BYPASS, jobsRoutes);
app.use('/api/logs',          PORTAL_BYPASS, logsRoutes.router);
app.use('/api/errors',        PORTAL_BYPASS, logsRoutes.errorsRouter);
app.use('/api/forge',         PORTAL_BYPASS, forgeRoutes);
app.use('/api/credits',       PORTAL_BYPASS, creditsRoutes);
app.use('/api/tasks',         PORTAL_BYPASS, tasksRoutes);
app.use('/api/settings',      PORTAL_BYPASS, settingsRoutes);
app.use('/api/lessons',       PORTAL_BYPASS, lessonsRoutes);
app.use('/api/training',      PORTAL_BYPASS, trainingRoutes);

// ── Memory management routes ──
app.get('/api/memory/stats', PORTAL_BYPASS, async (req, res) => {
  try {
    const memory = require('./src/skills/memory');
    const stats = await memory.getMemoryStats();
    res.json({ ok: true, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/memory/prune', PORTAL_BYPASS, async (req, res) => {
  try {
    const memory = require('./src/skills/memory');
    const results = await memory.pruneMemory();
    res.json({ ok: true, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/scribe/brief',  PORTAL_BYPASS, async (req, res) => {
  try {
    // Build brief from agent_logs DB (the real data source), not the flat file
    const today = new Date().toISOString().slice(0, 10);
    const [statsRes, errRes, recentRes] = await Promise.all([
      db.query(`SELECT agent, COUNT(*)::int AS cnt FROM agent_logs WHERE ts::date >= $1 GROUP BY agent ORDER BY cnt DESC`, [today]),
      db.query(`SELECT COUNT(*)::int AS cnt FROM agent_logs WHERE level = 'ERROR' AND ts::date >= $1`, [today]),
      db.query(`SELECT agent, action, outcome, note, ts FROM agent_logs WHERE ts::date >= $1 ORDER BY ts DESC LIMIT 5`, [today]),
    ]);

    const totalActions = statsRes.rows.reduce((sum, r) => sum + r.cnt, 0);
    const errCount     = errRes.rows[0]?.cnt ?? 0;

    const agentLines = statsRes.rows.length
      ? statsRes.rows.map(r => `  - ${r.agent}: ${r.cnt} actions`).join('\n')
      : '  - No activity recorded';

    const recentLines = recentRes.rows.length
      ? recentRes.rows.map(r => {
          const time = new Date(r.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          return `  - ${time} ${r.agent}: ${r.action} → ${r.outcome}`;
        }).join('\n')
      : '  - None';

    const briefing = [
      `Ghost Daily Briefing — ${today}`,
      '',
      `Activity (${totalActions} actions today)`,
      agentLines,
      errCount > 0 ? `\nErrors: ${errCount} error(s) logged today` : '',
      '',
      `Recent Activity`,
      recentLines,
    ].filter(l => l !== undefined).join('\n');

    res.json({ briefing, period: today, ts: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Archivist needs portal access (moved above requireAuth)
app.use('/api/archivist', PORTAL_BYPASS, archivistRoutes);

// ── Protected routes ──────────────────────────────────────────────────────────
app.use(requireAuth);

app.use('/api/agents',    agentRoutes);
app.use('/api/route',     routeRoute);
app.use('/api/warden',    wardenRoutes);
app.use('/api/scribe',    scribeRoutes);
app.use('/api/scout',     scoutRoutes);
app.use('/api/lens',      lensRoutes);
app.use('/api/courier',   courierRoutes);
app.use('/api/keeper',    keeperRoutes);
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
    _broadcast({ type: 'agent:event', id: agentId, message: update.message, eventType: update.type || 'info', ts: update.ts });
  } else {
    _broadcast({ type: 'agent:update', agent: update });
  }
});

// Forge progress → WebSocket
db.events.on('forge:progress', (msg) => _broadcast(msg));

// ── Auto-fix: listen for ERROR log entries and attempt automatic code repair ───
{
  // Track last fix time per file to avoid thrashing (max 1 fix per file per 10min)
  const _fixCooldowns = new Map();
  db.events.on('error-logged', async (entry) => {
    const note        = entry.note  || '';
    const agentName   = entry.agent || '';
    const cooldownKey = `${agentName}:${note.slice(0, 80)}`;
    const last        = _fixCooldowns.get(cooldownKey) || 0;
    if (Date.now() - last < 10 * 60 * 1000) return; // 10-min cooldown per unique error
    _fixCooldowns.set(cooldownKey, Date.now());

    const errorId = `autofix-${Date.now()}`;
    console.log(`[AutoFix] Error in ${agentName} — opening Claude CLI in Ghost terminal…`);

    // Open the Ghost terminal and stream Claude CLI output into it in real-time
    db.events.emit('forge:progress', {
      type: 'fix-one:start', errorId, agent: agentName, file: '', ts: new Date().toISOString(),
    });

    forgeAgent.autoFixWithClaude({
      errorNote: note,
      agentName,
      onProgress: (text) => {
        db.events.emit('forge:progress', {
          type: 'fix-one:output', errorId, text, ts: new Date().toISOString(),
        });
      },
    }).then(r => {
      console.log(`[AutoFix] ${r.fixed ? '✓ Fixed' : '✗ No fix'}: ${r.summary}`);
      if (r.fixed) {
        try { require('child_process').execSync('pm2 restart ghost', { timeout: 15000 }); } catch { /* non-fatal */ }
      }
      db.events.emit('forge:progress', {
        type: 'fix-one:complete', errorId, fixed: r.fixed, summary: r.summary,
        filePath: r.filePath, ts: new Date().toISOString(),
      });
    }).catch(err => {
      db.events.emit('forge:progress', {
        type: 'fix-one:complete', errorId, fixed: false, summary: err.message,
        ts: new Date().toISOString(),
      });
    });
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`OpenClaw gateway running on http://localhost:${PORT}`);
  db.initSchema()
    .then(() => botAdmins.load())
    .then(() => registry.loadRecentEvents())
    .catch(err => console.error('[DB] Schema init failed:', err.message));
  redis.waitReady(5000).then(ok =>
    console.log(`[Redis] ${ok ? 'Connected ✓' : 'Unavailable — fallbacks active'}`)
  );
  ollama.ensureModels().catch(err => console.error('[Ollama] Model check failed:', err.message));
  heartbeat.start();
  sentinel.start().catch(err => console.error('[Sentinel] Failed to start:', err.message));
  scribe.start();
});
