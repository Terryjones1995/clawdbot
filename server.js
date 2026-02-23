require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes   = require('./src/routes/auth');
const agentRoutes  = require('./src/routes/agents');
const routeRoute   = require('./src/routes/route');
const wardenRoutes = require('./src/routes/warden');
const requireAuth  = require('./src/middleware/requireAuth');
const sentinel     = require('./src/sentinel');

const app = express();
const PORT = process.env.OPENCLAW_PORT || 18789;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Public: auth endpoints
app.use('/auth', authRoutes);

// Public: login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Everything below requires a valid session
app.use(requireAuth);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/agents', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'agents.html'));
});

app.use('/api/agents', agentRoutes);
app.use('/api/route',  routeRoute);
app.use('/api/warden', wardenRoutes);

app.listen(PORT, () => {
  console.log(`OpenClaw gateway running on http://localhost:${PORT}`);
  sentinel.start().catch(err => console.error('[Sentinel] Failed to start:', err.message));
});
