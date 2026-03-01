'use strict';

/**
 * Learning System — Agent lessons from corrections, fixes, and feedback.
 *
 * Agents learn from:
 *   1. User corrections (detectAndStoreCorrection in memory.js)
 *   2. Forge auto-fixes (after successful code repair)
 *   3. Negative feedback (thumbs-down with a note)
 *
 * Lessons are stored in agent_lessons with optional embeddings for semantic search.
 * Before every response, relevant lessons are injected into the system prompt.
 *
 * Usage:
 *   const learning = require('./skills/learning');
 *   await learning.learnFromCorrection('keeper', wrongAnswer, correction, threadId);
 *   const lessons = await learning.getRelevantLessons('keeper', userMessage);
 */

const db     = require('../db');
const ollama = require('../../openclaw/skills/ollama');

/**
 * Create a lesson from a user correcting Ghost's response.
 */
async function learnFromCorrection(agent, wrongAnswer, correction, threadId) {
  const lesson = `Ghost was corrected: previously said "${(wrongAnswer || '').slice(0, 200)}". User corrected: "${(correction || '').slice(0, 300)}"`;

  let embedding = null;
  try { embedding = await ollama.embed(lesson); } catch { /* non-fatal */ }

  await db.createLesson({
    agent:    agent || 'ghost',
    lesson,
    category: 'correction',
    severity: 'medium',
    source:   'auto-correction',
    context:  threadId || null,
    embedding,
  });
  console.log(`[Learning] Stored correction lesson for ${agent}`);
}

/**
 * Create a lesson from a successful Forge auto-fix.
 */
async function learnFromFix(agent, errorNote, fixSummary, filePath) {
  const lesson = `Error in ${agent}: "${(errorNote || '').slice(0, 200)}". Fixed: ${(fixSummary || '').slice(0, 300)}. File: ${filePath || 'unknown'}`;

  let embedding = null;
  try { embedding = await ollama.embed(lesson); } catch { /* non-fatal */ }

  await db.createLesson({
    agent:    agent || 'forge',
    lesson,
    category: 'error-pattern',
    severity: 'high',
    source:   'forge-fix',
    context:  filePath || null,
    embedding,
  });
  console.log(`[Learning] Stored fix lesson for ${agent}: ${filePath}`);
}

/**
 * Create a lesson from negative feedback (thumbs-down with a note).
 */
async function learnFromFeedback(agent, query, response, rating, note) {
  if (rating >= 0 || !note) return; // only learn from negative feedback with notes

  const lesson = `User gave negative feedback. Query: "${(query || '').slice(0, 150)}". Response: "${(response || '').slice(0, 150)}". Feedback: "${note.slice(0, 300)}"`;

  let embedding = null;
  try { embedding = await ollama.embed(lesson); } catch { /* non-fatal */ }

  await db.createLesson({
    agent:    agent || 'ghost',
    lesson,
    category: 'feedback',
    severity: 'medium',
    source:   'discord-feedback',
    context:  note,
    embedding,
  });
  console.log(`[Learning] Stored feedback lesson for ${agent}`);
}

/**
 * Get relevant lessons for an agent, optionally using semantic search.
 * Returns a formatted string ready for system prompt injection, or null.
 * Caps output at ~500 tokens (~2000 chars).
 *
 * @param {string} agent   — agent name
 * @param {string} context — current user message or error context
 * @param {number} limit   — max lessons to return
 */
async function getRelevantLessons(agent, context, limit = 5) {
  let embedding = null;
  try { embedding = await ollama.embed(context || agent); } catch { /* non-fatal */ }

  const lessons = await db.getActiveLessonsByEmbedding(agent, embedding, limit);
  if (!lessons.length) return null;

  // Increment applied count for each lesson used (non-blocking)
  for (const l of lessons) {
    db.incrementLessonApplied(l.id).catch(() => {});
  }

  const lines = lessons.map(l => `- [${l.category}/${l.severity}] ${l.lesson}`);
  const text = lines.join('\n');
  return text.length > 2000 ? text.slice(0, 2000) + '...' : text;
}

module.exports = { learnFromCorrection, learnFromFix, learnFromFeedback, getRelevantLessons };
