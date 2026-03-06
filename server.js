require('dotenv').config();
const express      = require('express');
const http         = require('http');
const crypto       = require('crypto');
const cookieParser = require('cookie-parser');
const path         = require('path');
const fs           = require('fs');
const { WebSocketServer } = require('ws');

const authRoutes      = require('./src/routes/auth');
const agentRoutes     = require('./src/routes/agents');
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
const helmRoutes        = require('./src/routes/helm');
const directivesApi     = require('./src/routes/directives-api');
const ticketsApi        = require('./src/routes/tickets-api');
const leagueDataApi     = require('./src/routes/league-data-api');
const visionApi         = require('./src/routes/vision-api');
const memorySearchApi   = require('./src/routes/memory-search');
const adminActionsApi   = require('./src/routes/admin-actions');
const identityRoutes    = require('./src/routes/identity');
const discordInteractions = require('./src/routes/discord-interactions');
const forgeAgent        = require('./src/forge');
const requireAuth       = require('./src/middleware/requireAuth');
const scribe            = require('./src/scribe');
const rateLimit         = require('express-rate-limit');
const heartbeat       = require('./src/heartbeat');
const registry        = require('./src/agentRegistry');
const db              = require('./src/db');
const botAdmins       = require('./src/botAdmins');
const redis           = require('./src/redis');
const ollama          = require('./openclaw/skills/ollama');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.GHOST_API_PORT || 18790;

// Ensure logs/ dir exists for PM2 log files
fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Heartbeat middleware — pulse on every real HTTP request ───────────────────
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/heartbeat')) heartbeat.pulse();
  next();
});

// ── Rate limiting for public endpoints ────────────────────────────────────────
const publicLimiter = rateLimit({
  windowMs: 60_000,  // 1 minute
  max: 30,           // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
});

// ── Public routes ─────────────────────────────────────────────────────────────

app.get('/api/heartbeat', publicLimiter, async (req, res) => {
  res.json(await heartbeat.getStatus());
});

app.get('/api/health', publicLimiter, async (req, res) => {
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
    const olr = await fetch(`${process.env.OLLAMA_HOST || 'http://localhost:11434'}/api/tags`, { signal: AbortSignal.timeout(5000) });
    checks.ollama = { status: olr.ok ? 'up' : 'down', ping: Date.now() - t0 };
  } catch { checks.ollama = { status: 'down' }; }
  // Discord (via OpenClaw gateway health check)
  try {
    const t0 = Date.now();
    const { execSync } = require('child_process');
    const raw = execSync('openclaw health --json 2>/dev/null', { timeout: 12000 }).toString();
    const health = JSON.parse(raw);
    const discord = health.channels?.discord;
    const botName = discord?.probe?.bot?.username || null;
    checks.discord = {
      status: (health.ok && discord?.probe?.ok) ? 'up' : 'down',
      ping: Date.now() - t0,
      via: 'openclaw',
      bot: botName,
      sessions: health.sessions?.count || 0,
    };
  } catch { checks.discord = { status: 'down', via: 'openclaw' }; }
  // DeepSeek API
  try {
    const t0 = Date.now();
    const r = await fetch('https://api.deepseek.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    checks.deepseek = { status: r.ok ? 'up' : 'down', ping: Date.now() - t0 };
  } catch { checks.deepseek = { status: 'down' }; }
  // OpenAI API
  try {
    const t0 = Date.now();
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    checks.openai = { status: r.ok ? 'up' : 'down', ping: Date.now() - t0 };
  } catch { checks.openai = { status: 'down' }; }
  // Anthropic API
  try {
    const t0 = Date.now();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      signal: AbortSignal.timeout(8000),
    });
    // 200 = working, 401 = bad key, 529 = overloaded — any non-network response means API is reachable
    checks.anthropic = { status: r.ok || r.status === 400 || r.status === 429 ? 'up' : 'down', ping: Date.now() - t0 };
  } catch { checks.anthropic = { status: 'down' }; }

  res.json(checks);
});

// Discord interactions webhook (public — Discord doesn't send our portal secret)
app.post('/api/discord/interactions', discordInteractions.handleInteraction);

app.use('/auth', authRoutes);

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// (Legacy React UI removed — Portal is served by Next.js on port 3001 via nginx)

// ── Portal reception — allow portal terminal via shared secret OR normal auth ──
const PORTAL_SECRET = process.env.PORTAL_SECRET;
const _portalSecretBuf = PORTAL_SECRET ? Buffer.from(PORTAL_SECRET) : null;

function _checkPortalSecret(headerValue) {
  if (!_portalSecretBuf || !headerValue) return false;
  const headerBuf = Buffer.from(String(headerValue));
  if (headerBuf.length !== _portalSecretBuf.length) return false;
  return crypto.timingSafeEqual(headerBuf, _portalSecretBuf);
}

app.use('/api/reception',
  (req, res, next) => {
    if (_checkPortalSecret(req.headers['x-portal-secret'])) {
      req.user = { username: 'portal', role: 'ADMIN' };
      return next();
    }
    requireAuth(req, res, next);
  },
  receptionRoutes,
);

// ── Portal data routes — allow via shared secret OR normal auth ────────────────
const PORTAL_BYPASS = (req, res, next) => {
  if (_checkPortalSecret(req.headers['x-portal-secret'])) {
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

// ── OpenClaw skill API routes (called by OpenClaw skills via HTTP) ──────────
app.use('/api/directives',    PORTAL_BYPASS, directivesApi);
app.use('/api/tickets',       PORTAL_BYPASS, ticketsApi);
app.use('/api/league',        PORTAL_BYPASS, leagueDataApi);
app.use('/api/vision',        PORTAL_BYPASS, visionApi);
app.use('/api/memory',        PORTAL_BYPASS, memorySearchApi);
app.use('/api/admin',         PORTAL_BYPASS, adminActionsApi);
app.use('/api/identity',      PORTAL_BYPASS, identityRoutes);
app.use('/api/discord/send-embed', PORTAL_BYPASS, discordInteractions.sendEmbedRouter);

// Archivist needs portal access (moved above requireAuth)
app.use('/api/archivist', PORTAL_BYPASS, archivistRoutes);

// ── OpenClaw scout skill (needs PORTAL_BYPASS for skill calls) ──────────────
app.use('/api/scout',     PORTAL_BYPASS, scoutRoutes);

// ── Scribe ops (OpenClaw cron + portal) ──────────────────────────────────────
app.use('/api/scribe',    PORTAL_BYPASS, scribeRoutes);

// ── Protected routes ──────────────────────────────────────────────────────────
app.use(requireAuth);

app.use('/api/agents',    agentRoutes);
app.use('/api/warden',    wardenRoutes);
app.use('/api/lens',      lensRoutes);
app.use('/api/courier',   courierRoutes);
app.use('/api/keeper',    keeperRoutes);
app.use('/api/helm',      helmRoutes);

// ── WebSocket server — /ws path for the portal UI ─────────────────────────────
const wss     = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws, req) => {
  // Authenticate: require portal secret as query param or cookie
  const url    = new URL(req.url, `http://${req.headers.host}`);
  const secret = url.searchParams.get('token') || req.headers['x-portal-secret'];
  if (secret !== process.env.PORTAL_SECRET) {
    ws.close(4001, 'Unauthorized');
    return;
  }

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
  // Cleanup stale cooldown entries every 30 minutes
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [k, ts] of _fixCooldowns) { if (ts < cutoff) _fixCooldowns.delete(k); }
  }, 30 * 60_000);
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

// ── Cron state sync — log completions/errors to agent_logs ──────────────────
{
  const { execFile } = require('child_process');
  const _cronLastSeen = new Map(); // jobId → lastRunAtMs

  async function _syncCronState() {
    try {
      const raw = await new Promise((resolve, reject) => {
        execFile('bash', ['-c', 'source /home/projects/clawdbot/.env && openclaw cron list --json 2>/dev/null'],
          { timeout: 10000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
      });

      const data = JSON.parse(raw);
      for (const job of (data.jobs || [])) {
        const lastRun = job.state?.lastRunAtMs;
        if (!lastRun) continue;

        const prevRun = _cronLastSeen.get(job.id);
        _cronLastSeen.set(job.id, lastRun);

        // Skip first poll (seeding state)
        if (prevRun === undefined) continue;
        // Skip if no new run
        if (lastRun === prevRun) continue;

        const isError = job.state.lastRunStatus === 'error';
        const duration = job.state.lastDurationMs ? `${(job.state.lastDurationMs / 1000).toFixed(1)}s` : '';

        db.logEntry({
          level:   isError ? 'ERROR' : 'INFO',
          agent:   'scribe',
          action:  `cron:${job.name}`,
          outcome: isError ? 'failed' : 'completed',
          model:   'deepseek/deepseek-chat',
          note:    `Cron "${job.name}" ${isError ? 'failed' : 'completed'}${duration ? ` in ${duration}` : ''}`,
        });

        _broadcast({
          type: 'cron:update',
          job:  { id: job.id, name: job.name, state: job.state },
        });
      }
    } catch { /* non-fatal */ }
  }

  // Poll every 30s, seed 5s after boot
  setInterval(_syncCronState, 30_000);
  setTimeout(_syncCronState, 5000);
}

// ── Ticket Monitor — watch platform DB + Discord channels in real time ───────
{
  const ticketMonitor = require('./src/ticketMonitor');
  ticketMonitor.init(_broadcast).catch(err => {
    console.error('[TicketMonitor] Init failed:', err.message);
  });
}

// ── Bracket Monitor — tournament match mediation + escalation ────────────────
{
  const bracketMonitor = require('./src/bracketMonitor');
  bracketMonitor.init(_broadcast).catch(err => {
    console.error('[BracketMonitor] Init failed:', err.message);
  });
}

// ── Process error handlers ─────────────────────────────────────────────────────
process.on('unhandledRejection', (err) => {
  console.error('[Ghost] Unhandled rejection:', err);
  db.logEntry({ level: 'ERROR', agent: 'ghost', action: 'unhandled-rejection', note: String(err?.message || err) }).catch(() => {});
});
process.on('uncaughtException', (err) => {
  console.error('[Ghost] Uncaught exception:', err);
  db.logEntry({ level: 'ERROR', agent: 'ghost', action: 'uncaught-exception', note: String(err?.message || err) })
    .catch(() => {})
    .finally(() => process.exit(1)); // PM2 will restart — Node state is undefined after uncaught exception
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
function _gracefulShutdown(signal) {
  console.log(`[Ghost] ${signal} received — shutting down gracefully`);
  server.close(() => {
    db.pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000); // force exit after 10s
}
process.on('SIGTERM', () => _gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => _gracefulShutdown('SIGINT'));

// ── Boot ───────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Ghost API running on http://localhost:${PORT}`);
  db.initSchema()
    .then(() => botAdmins.load())
    .then(() => registry.loadRecentEvents())
    .catch(err => console.error('[DB] Schema init failed:', err.message));
  redis.waitReady(5000).then(ok =>
    console.log(`[Redis] ${ok ? 'Connected ✓' : 'Unavailable — fallbacks active'}`)
  );
  ollama.ensureModels().catch(err => console.error('[Ollama] Model check failed:', err.message));
  heartbeat.start();
  scribe.start();
});
