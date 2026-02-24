'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');

const router       = express.Router();
const JWT_SECRET   = process.env.JWT_SECRET || 'change-me-set-JWT_SECRET-in-env';
const TOKEN_TTL    = '8h';
const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const { rows } = await db.query(
      'SELECT username, password_hash, role FROM users WHERE username = $1',
      [username]
    );
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      { username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: TOKEN_TTL }
    );

    res.cookie('oc_token', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge:   COOKIE_MAX_AGE,
    });

    res.json({ ok: true, username: user.username, role: user.role });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('oc_token');
  res.json({ ok: true });
});

// GET /auth/me — returns current user info from cookie
router.get('/me', (req, res) => {
  const token = req.cookies.oc_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ username: payload.username, role: payload.role });
  } catch {
    res.status(401).json({ error: 'Session expired or invalid.' });
  }
});

module.exports = router;
