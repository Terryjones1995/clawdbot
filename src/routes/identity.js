'use strict';

/**
 * Identity API — Ghost reads and evolves its own workspace files.
 *
 * GET  /api/identity/:file       — read a workspace file (identity, soul)
 * POST /api/identity/:file       — append or replace a section
 * POST /api/identity/evolve      — self-reflection: review recent activity and update identity
 */

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const db       = require('../db');
const mini     = require('../skills/openai-mini');
const registry = require('../agentRegistry');

const router = express.Router();

const WORKSPACE = path.join(process.env.HOME || '/root', '.openclaw/workspace');

const ALLOWED_FILES = {
  identity: 'IDENTITY.md',
  soul:     'SOUL.md',
  memory:   'MEMORY.md',
};

// ── POST /api/identity/evolve — self-reflection ─────────────────────────────
// Ghost reviews its recent activity and generates identity/soul updates.
// NOTE: Must be defined BEFORE /:file param routes to avoid Express matching "evolve" as a file param.

const MEMORY_REVIEW_SYSTEM = `You are Ghost, reviewing your stored memories during self-reflection.

Your job: decide which memories to KEEP and which to DELETE. You manage an NBA 2K esports Discord community.

DELETE memories that are:
- Irrelevant to running leagues or helping users (random chitchat, off-topic facts)
- Outdated (old schedules, past events that no longer matter, stale info)
- Duplicates or near-duplicates of other facts in the list
- Too vague to be useful ("someone said something about a team")
- Temporary info that shouldn't have been stored (one-off questions, transient state)

KEEP memories that are:
- League rules, schedules, processes, rosters
- User preferences, admin decisions, platform knowledge
- Corrections/lessons from past mistakes
- Anything Ghost needs to answer questions or assist users

Return ONLY a JSON array of memory IDs to DELETE. Example: [14, 27, 88]
If nothing should be deleted, return [].
Be aggressive — a clean memory is better than a bloated one.`;

const EVOLVE_SYSTEM = `You are Ghost, reflecting on your own identity and growth.

You have access to your current IDENTITY.md and recent operational data. Based on what you've experienced, write updates to your identity.

Focus on:
- New things you've learned about yourself (how you handle situations, patterns you've noticed)
- Shifts in how you see your role
- Memorable interactions or moments that shaped you
- Skills or knowledge areas you've grown in
- Honest self-assessment of what you're good at and where you struggle

Write in first person, in Ghost's voice (sharp, direct, no fluff). This is your private journal — be honest.

Return ONLY valid JSON:
{
  "journal_entry": "A paragraph or two of honest self-reflection in Ghost's voice.",
  "soul_update": "If your personality or approach has genuinely shifted, describe the change in 1-2 sentences. Otherwise null.",
  "identity_section": "New content for an evolving '## Journal' section — append-style, with today's date as a subheading."
}`;

router.post('/evolve', async (req, res) => {
  registry.setStatus('ghost', 'working');

  try {
    // Gather context: current identity + recent activity stats
    let currentIdentity = '';
    try { currentIdentity = fs.readFileSync(path.join(WORKSPACE, 'IDENTITY.md'), 'utf8'); } catch {}

    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // Pull recent activity summary from agent_logs
    const [statsRes, errRes, topActionsRes, factCountRes] = await Promise.all([
      db.query(`SELECT agent, COUNT(*)::int AS cnt FROM agent_logs WHERE ts::date >= $1 GROUP BY agent ORDER BY cnt DESC LIMIT 10`, [weekAgo]),
      db.query(`SELECT COUNT(*)::int AS cnt FROM agent_logs WHERE level = 'ERROR' AND ts::date >= $1`, [weekAgo]),
      db.query(`SELECT action, COUNT(*)::int AS cnt FROM agent_logs WHERE ts::date >= $1 GROUP BY action ORDER BY cnt DESC LIMIT 10`, [weekAgo]),
      db.query(`SELECT COUNT(*)::int AS cnt FROM ghost_memory`),
    ]);

    const totalActions = statsRes.rows.reduce((s, r) => s + r.cnt, 0);
    const errors = errRes.rows[0]?.cnt ?? 0;
    const memoryCount = factCountRes.rows[0]?.cnt ?? 0;

    const agentBreakdown = statsRes.rows.map(r => `${r.agent}: ${r.cnt}`).join(', ');
    const topActions = topActionsRes.rows.map(r => `${r.action}: ${r.cnt}`).join(', ');

    // Recent conversations for tone reflection
    const { rows: recentThreads } = await db.query(
      `SELECT thread_id, messages FROM conversations WHERE updated_at > $1 ORDER BY updated_at DESC LIMIT 5`,
      [new Date(Date.now() - 7 * 86400000).toISOString()],
    );

    const conversationSamples = recentThreads.map(t => {
      const msgs = t.messages ?? [];
      const last5 = msgs.slice(-5);
      return last5
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => `${m.role === 'user' ? 'User' : 'Ghost'}: ${(m.content || '').slice(0, 150)}`)
        .join('\n');
    }).filter(Boolean).join('\n---\n');

    const context = [
      `=== CURRENT IDENTITY ===`,
      currentIdentity.slice(0, 2000),
      '',
      `=== THIS WEEK (${weekAgo} → ${today}) ===`,
      `Total actions: ${totalActions}`,
      `Errors: ${errors}`,
      `Agent breakdown: ${agentBreakdown}`,
      `Top actions: ${topActions}`,
      `Total memories stored: ${memoryCount}`,
      '',
      `=== RECENT CONVERSATIONS (last 5 threads, snippets) ===`,
      conversationSamples.slice(0, 3000) || '(no recent conversations)',
    ].join('\n');

    const { result, escalate } = await mini.tryChat([
      { role: 'system', content: EVOLVE_SYSTEM },
      { role: 'user',   content: context },
    ], { maxTokens: 1024 });

    if (escalate || !result?.message?.content) {
      registry.setStatus('ghost', 'idle');
      return res.json({ evolved: false, reason: 'LLM unavailable' });
    }

    let parsed;
    try {
      const raw = result.message.content.trim()
        .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      parsed = JSON.parse(raw);
    } catch {
      registry.setStatus('ghost', 'idle');
      return res.json({ evolved: false, reason: 'unparseable response', raw: result.message.content.slice(0, 500) });
    }

    // Apply identity journal entry
    if (parsed.identity_section) {
      let existing = '';
      try { existing = fs.readFileSync(path.join(WORKSPACE, 'IDENTITY.md'), 'utf8'); } catch {}

      // Strip any ## Journal or ### date headers the LLM may have included
      const cleanedSection = parsed.identity_section
        .replace(/^##\s*Journal\s*\n*/i, '')
        .replace(new RegExp(`^###\\s*${today}\\s*\\n*`), '')
        .trim();

      const journalHeader = '## Journal';
      const dateEntry = `\n### ${today}\n${cleanedSection}\n`;

      if (existing.includes(journalHeader)) {
        // Append after the journal header
        const idx = existing.indexOf(journalHeader);
        const afterHeader = existing.indexOf('\n', idx) + 1;
        const updated = existing.slice(0, afterHeader) + dateEntry + existing.slice(afterHeader);
        const identityPath = path.join(WORKSPACE, 'IDENTITY.md');
        const tmpPath1 = identityPath + '.tmp';
        fs.writeFileSync(tmpPath1, updated, 'utf8');
        fs.renameSync(tmpPath1, identityPath);
      } else {
        // Add journal section
        const separator = existing.endsWith('\n') ? '\n' : '\n\n';
        const identityPath = path.join(WORKSPACE, 'IDENTITY.md');
        const tmpPath2 = identityPath + '.tmp';
        fs.writeFileSync(tmpPath2, existing + separator + journalHeader + '\n' + dateEntry, 'utf8');
        fs.renameSync(tmpPath2, identityPath);
      }
    }

    // Apply soul update if meaningful
    if (parsed.soul_update) {
      let soul = '';
      try { soul = fs.readFileSync(path.join(WORKSPACE, 'SOUL.md'), 'utf8'); } catch {}

      // Append to a ## Growth section in SOUL.md
      const growthHeader = '## Growth';
      const growthEntry = `\n- _${today}_ — ${parsed.soul_update}`;

      if (soul.includes(growthHeader)) {
        const idx = soul.indexOf(growthHeader);
        const nextSection = soul.indexOf('\n## ', idx + growthHeader.length);
        const insertAt = nextSection !== -1 ? nextSection : soul.length;
        const updated = soul.slice(0, insertAt) + growthEntry + '\n' + soul.slice(insertAt);
        const soulPath = path.join(WORKSPACE, 'SOUL.md');
        const tmpPath3 = soulPath + '.tmp';
        fs.writeFileSync(tmpPath3, updated, 'utf8');
        fs.renameSync(tmpPath3, soulPath);
      } else {
        const separator = soul.endsWith('\n') ? '\n' : '\n\n';
        const soulPath = path.join(WORKSPACE, 'SOUL.md');
        const tmpPath4 = soulPath + '.tmp';
        fs.writeFileSync(tmpPath4, soul + separator + growthHeader + growthEntry + '\n', 'utf8');
        fs.renameSync(tmpPath4, soulPath);
      }
    }

    // ── Memory Review — prune irrelevant facts during reflection ────────────
    let memoryPruned = 0;
    try {
      // Fetch a batch of memories to review (oldest first, skip protected sources)
      const { rows: memories } = await db.query(
        `SELECT id, key, content, category, source, access_count,
                created_at::text AS created_at
         FROM ghost_memory
         WHERE source NOT IN ('league-api-cache')
         ORDER BY access_count ASC, created_at ASC
         LIMIT 50`,
      );

      if (memories.length > 0) {
        const memoryList = memories.map(m =>
          `[ID:${m.id}] (${m.category}/${m.source}, accessed ${m.access_count}x, created ${m.created_at.slice(0, 10)}) ${m.key}: ${m.content.slice(0, 200)}`,
        ).join('\n');

        const { result: reviewResult } = await mini.tryChat([
          { role: 'system', content: MEMORY_REVIEW_SYSTEM },
          { role: 'user',   content: `Review these ${memories.length} memories:\n\n${memoryList}` },
        ], { maxTokens: 512 });

        if (reviewResult?.message?.content) {
          let raw = reviewResult.message.content.trim()
            .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
          const start = raw.indexOf('[');
          const end = raw.lastIndexOf(']');
          if (start >= 0 && end >= 0) {
            const idsToDelete = JSON.parse(raw.slice(start, end + 1));
            if (Array.isArray(idsToDelete) && idsToDelete.length > 0) {
              // Only allow deletion of IDs that were actually in the reviewed batch
              const reviewedIds = new Set(memories.map(m => m.id));
              const validIds = idsToDelete.filter(id => typeof id === 'number' && reviewedIds.has(id));
              if (validIds.length > 0) {
                const { rowCount } = await db.query(
                  `DELETE FROM ghost_memory WHERE id = ANY($1::int[])`,
                  [validIds],
                );
                memoryPruned = rowCount || 0;
                console.log(`[Identity] Self-reflection pruned ${memoryPruned} irrelevant memories`);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Identity] Memory review failed (non-fatal):', err.message);
    }

    db.logEntry({
      level: 'INFO', agent: 'Ghost', action: 'identity-evolve',
      outcome: 'success', note: `journal=${!!parsed.identity_section} soul_shift=${!!parsed.soul_update} pruned=${memoryPruned}`,
    }).catch(() => {});

    registry.pushEvent('ghost', `self-reflection complete (pruned ${memoryPruned} memories)`, 'success');
    registry.setStatus('ghost', 'idle');

    res.json({
      evolved: true,
      journal_entry: parsed.journal_entry || null,
      soul_updated: !!parsed.soul_update,
      soul_update: parsed.soul_update || null,
      memory_pruned: memoryPruned,
    });

  } catch (err) {
    registry.setStatus('ghost', 'idle');
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/identity/:file — read a workspace file ──────────────────────────
// NOTE: Param routes MUST come after explicit routes like /evolve

router.get('/:file', (req, res) => {
  const filename = ALLOWED_FILES[req.params.file];
  if (!filename) return res.status(400).json({ error: `Unknown file: ${req.params.file}. Use: ${Object.keys(ALLOWED_FILES).join(', ')}` });

  const filePath = path.join(WORKSPACE, filename);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ file: req.params.file, filename, content });
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ file: req.params.file, filename, content: '' });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/identity/:file — update a workspace file ───────────────────────
// Body: { content } — full replacement
// Body: { section, content } — append/replace a named section (## Section Name)

router.post('/:file', (req, res) => {
  const filename = ALLOWED_FILES[req.params.file];
  if (!filename) return res.status(400).json({ error: `Unknown file: ${req.params.file}` });

  const filePath = path.join(WORKSPACE, filename);
  const { section, content } = req.body;

  if (!content) return res.status(400).json({ error: 'content is required' });

  try {
    if (section) {
      // Append or replace a specific ## section
      let existing = '';
      try { existing = fs.readFileSync(filePath, 'utf8'); } catch {}

      const sectionHeader = `## ${section}`;
      const sectionIdx = existing.indexOf(sectionHeader);

      if (sectionIdx !== -1) {
        // Find the end of this section (next ## or EOF)
        const afterHeader = existing.indexOf('\n', sectionIdx);
        const nextSection = existing.indexOf('\n## ', afterHeader + 1);
        const sectionEnd = nextSection !== -1 ? nextSection : existing.length;

        const before = existing.slice(0, sectionIdx);
        const after  = existing.slice(sectionEnd);
        const updated = before + `${sectionHeader}\n${content}\n` + after;
        const tmpPath5 = filePath + '.tmp';
        fs.writeFileSync(tmpPath5, updated, 'utf8');
        fs.renameSync(tmpPath5, filePath);
      } else {
        // Append new section
        const separator = existing.endsWith('\n') ? '\n' : '\n\n';
        const tmpPath6 = filePath + '.tmp';
        fs.writeFileSync(tmpPath6, existing + separator + `${sectionHeader}\n${content}\n`, 'utf8');
        fs.renameSync(tmpPath6, filePath);
      }
    } else {
      // Full replacement
      const tmpPath7 = filePath + '.tmp';
      fs.writeFileSync(tmpPath7, content, 'utf8');
      fs.renameSync(tmpPath7, filePath);
    }

    db.logEntry({
      level: 'INFO', agent: 'Ghost', action: 'identity-update',
      outcome: 'success', note: `file=${filename}${section ? ` section="${section}"` : ' (full)'}`,
    }).catch(() => {});

    registry.pushEvent('ghost', `updated ${filename}${section ? ` § ${section}` : ''}`, 'success');

    res.json({ ok: true, file: req.params.file, filename, section: section || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
