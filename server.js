require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./src/routes/auth');
const agentRoutes = require('./src/routes/agents');
const requireAuth = require('./src/middleware/requireAuth');

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

app.listen(PORT, () => {
  console.log(`OpenClaw gateway running on http://localhost:${PORT}`);
});
