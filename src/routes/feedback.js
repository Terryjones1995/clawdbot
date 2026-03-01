'use strict';

/**
 * POST /api/feedback
 *
 * Store thumbs up/down feedback for a Ghost terminal reply.
 *
 * Body:
 *   { threadId, content, rating, note? }
 *   rating: 1 = good, -1 = bad
 *
 * Response:
 *   { ok: true }
 */

const express  = require('express');
const crypto   = require('crypto');
const db       = require('../db');
const learning = require('../skills/learning');

const router = express.Router();

router.post('/', async (req, res) => {
  const { threadId, content = '', rating, note = null } = req.body;

  if (!threadId)                          return res.status(400).json({ error: 'threadId required' });
  if (rating !== 1 && rating !== -1)      return res.status(400).json({ error: 'rating must be 1 or -1' });

  const contentHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);

  try {
    await db.storeFeedback({ threadId, contentHash, rating, note });
    db.logEntry({
      level:  rating === 1 ? 'INFO' : 'WARN',
      agent:  'Ghost',
      action: 'feedback',
      outcome: rating === 1 ? 'thumbs-up' : 'thumbs-down',
      note:   `thread=${threadId} hash=${contentHash}`,
    }).catch(() => {});

    // Feed negative feedback to learning system
    if (rating === -1 && note) {
      learning.learnFromFeedback('ghost', '', content, rating, note).catch(() => {});
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[Feedback] Error storing feedback:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
