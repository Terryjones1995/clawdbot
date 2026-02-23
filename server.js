require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');
const fs           = require('fs');

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
const requireAuth     = require('./src/middleware/requireAuth');
const sentinel        = require('./src/sentinel');
const scribe          = require('./src/scribe');
const heartbeat       = require('./src/heartbeat');

const app  = express();
const PORT = process.env.OPENCLAW_PORT || 18789;

// Ensure logs/ dir exists for PM2 log files
fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Heartbeat middleware — pulse on every real HTTP request ───────────────────
app.use((req, res, next) => {
  // Skip static assets and the heartbeat check itself
  if (!req.path.startsWith('/api/heartbeat')) heartbeat.pulse();
  next();
});

// ── Public routes ─────────────────────────────────────────────────────────────

// Heartbeat / health check — no auth required, safe for uptime monitors
app.get('/api/heartbeat', (req, res) => {
  res.json(heartbeat.getStatus());
});

app.use('/auth', authRoutes);

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── Protected routes ──────────────────────────────────────────────────────────
app.use(requireAuth);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/agents', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'agents.html'));
});

app.use('/api/agents',    agentRoutes);
app.use('/api/route',     routeRoute);
app.use('/api/warden',    wardenRoutes);
app.use('/api/forge',     forgeRoutes);
app.use('/api/scribe',    scribeRoutes);
app.use('/api/scout',     scoutRoutes);
app.use('/api/lens',      lensRoutes);
app.use('/api/courier',   courierRoutes);
app.use('/api/archivist', archivistRoutes);

// ── Boot ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`OpenClaw gateway running on http://localhost:${PORT}`);
  heartbeat.start();
  sentinel.start().catch(err => console.error('[Sentinel] Failed to start:', err.message));
  scribe.start();
});
