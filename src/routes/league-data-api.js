'use strict';

const express   = require('express');
const leagueApi = require('../skills/league-api');

const router = express.Router();

// POST /api/league/detect — detect league query in message text
// (must be before parameterized routes)
router.post('/detect', async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const result = leagueApi.detectLeagueQuery(message);
  return res.json(result || { shouldQuery: false });
});

// GET /api/league/all/:endpoint — query all leagues
// (must be before /:leagueKey/:endpoint to avoid "all" matching as leagueKey)
router.get('/all/:endpoint', async (req, res) => {
  const { endpoint } = req.params;

  try {
    const results = await leagueApi.queryAll(endpoint);
    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/league/:leagueKey/:endpoint — query single league
router.get('/:leagueKey/:endpoint', async (req, res) => {
  const { leagueKey, endpoint } = req.params;

  try {
    const result = await leagueApi.query(leagueKey, endpoint);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
