'use strict';

/**
 * Keeper — Persistent conversation memory agent
 *
 * Stores conversation threads in Neon PostgreSQL (conversations table).
 * Auto-migrates existing local JSON files on first access.
 * Uses gpt-4o-mini for rolling summarisation (cheap).
 * Augments context with Pinecone long-term memories via Archivist.
 *
 * Thread ID conventions:
 *   portal-{userId}               — Portal terminal conversation
 *   discord:{channelId}:{userId}  — Discord channel conversation
 *   global:{topic}                — Global topic thread
 */

const fs   = require('fs');
const path = require('path');

const ollama    = require('../openclaw/skills/ollama');
const mini      = require('./skills/openai-mini');
const memory    = require('./skills/memory');
const learning  = require('./skills/learning');
const registry  = require('./agentRegistry');
const archivist = require('./archivist');
const db        = require('./db');
const redis     = require('./redis');

// Legacy JSON path — only used for one-time migration of existing threads
const CONVERSATIONS_DIR = path.join(__dirname, '../memory/conversations');
const MAX_MESSAGES       = 80;
const KEEP_RECENT        = 20;
const MAX_CONTEXT_MSGS   = 30;

function _ghostSystem() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Ghost, an elite AI operations assistant. You remember everything — use your conversation history.
You manage a multi-agent Discord system and operations platform.
Sharp, direct, 1-3 sentences unless detail is genuinely needed.
Current date: ${today}.`;
}

// ── Thread I/O (Neon) ──────────────────────────────────────────────────────────

const THREAD_TTL = 86400; // 24 hours

async function _loadThread(threadId) {
  // Try Redis cache first
  const cacheKey = `thread:${threadId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* corrupt cache — fall through */ }
  }

  try {
    const row = await db.getThread(threadId);
    if (row) {
      const thread = {
        threadId,
        messages:  row.messages  ?? [],
        summary:   row.summary   ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      // Warm cache
      await redis.set(cacheKey, JSON.stringify(thread), THREAD_TTL);
      return thread;
    }
  } catch (err) {
    console.warn('[Keeper] Neon load failed, checking local file:', err.message);
  }

  // Not in Neon — check for legacy JSON file and auto-migrate
  const filePath = path.join(CONVERSATIONS_DIR, `${threadId.replace(/[^a-zA-Z0-9_\-:]/g, '_')}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`[Keeper] Migrating thread "${threadId}" from JSON to Neon`);
    await db.upsertThread({
      threadId,
      messages:  data.messages  ?? [],
      summary:   data.summary   ?? null,
      createdAt: data.createdAt ?? new Date().toISOString(),
    });
    return data;
  } catch {
    // No local file either — return a fresh thread
    return {
      threadId,
      messages:  [],
      summary:   null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

async function _saveThread(thread) {
  // Write-through: Neon first, then refresh Redis cache
  await db.upsertThread({
    threadId:  thread.threadId,
    messages:  thread.messages,
    summary:   thread.summary,
    createdAt: thread.createdAt,
  });
  await redis.set(`thread:${thread.threadId}`, JSON.stringify(thread), THREAD_TTL);
}

// ── Summarisation ─────────────────────────────────────────────────────────────

async function _maybeSummarise(thread) {
  if (thread.messages.length <= MAX_MESSAGES) return thread;

  const toSummarise = thread.messages.slice(0, -KEEP_RECENT);
  const text = toSummarise.map(m => `${m.role === 'user' ? 'User' : 'Ghost'}: ${m.content}`).join('\n');

  const summarisePrompt = `Summarise the following conversation fragment into a compact paragraph. Preserve key facts, decisions made, topics discussed, and any personal details shared. Plain text only, no bullet points.\n\n${text}`;

  const { result } = await mini.tryChat([
    { role: 'system', content: 'You are a concise summariser. Output plain text only.' },
    { role: 'user',   content: summarisePrompt },
  ]);

  if (result?.message?.content) {
    const newSummary = result.message.content.trim();
    thread.summary  = thread.summary
      ? `${thread.summary}\n\n---\n\n${newSummary}`
      : newSummary;
    thread.messages = thread.messages.slice(-KEEP_RECENT);
    await _saveThread(thread);
  }

  return thread;
}

// ── Context builder ────────────────────────────────────────────────────────────

function _buildSystemPrompt(thread, pineconeContext = null, factsContext = null, profileContext = null, lessonsContext = null) {
  let sys = _ghostSystem();
  if (lessonsContext)  sys += `\n\n## Lessons learned (avoid repeating these mistakes):\n${lessonsContext}`;
  if (profileContext)  sys += `\n\n## User profile:\n${profileContext}`;
  if (factsContext)    sys += `\n\n## What Ghost knows (persistent memory):\n${factsContext}`;
  if (pineconeContext) sys += `\n\n## Relevant long-term memories:\n${pineconeContext}`;
  if (thread.summary)  sys += `\n\n## Conversation summary so far:\n${thread.summary}`;
  return sys;
}

function _buildMessages(thread, userMessage) {
  const recent = thread.messages.slice(-MAX_CONTEXT_MSGS);
  return [
    ...recent.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Chat with persistent memory for a thread.
 * Returns the assistant reply string.
 */
async function chat(threadId, userMessage) {
  registry.setStatus('keeper', 'working');

  let thread = await _loadThread(threadId);

  // Grab previous assistant reply before pushing new user message (for correction detection)
  const prevMessages  = thread.messages;
  const previousReply = [...prevMessages].reverse().find(m => m.role === 'assistant')?.content ?? null;

  thread.messages.push({
    role:    'user',
    content: userMessage,
    ts:      new Date().toISOString(),
  });
  await _saveThread(thread);

  // Detect and store corrections in the background
  memory.detectAndStoreCorrection(userMessage, previousReply, threadId).catch(() => {});

  const beforeLen = thread.messages.length;
  thread = await _maybeSummarise(thread);
  const justSummarised = beforeLen > MAX_MESSAGES && thread.messages.length <= KEEP_RECENT;

  if (justSummarised && thread.summary) {
    archivist.store({
      type:         'conversation',
      content:      thread.summary,
      tags:         [threadId],
      source_agent: 'keeper',
      ttl_days:     180,
    }).catch(() => {});
  }

  // Fetch relevant lessons from the learning system
  const lessonsContext = await learning.getRelevantLessons('ghost', userMessage).catch(() => null);

  // Fetch relevant facts from ghost_memory (persistent knowledge)
  const factsContext = await memory.getRelevantFacts(userMessage).catch(() => null);

  // Load user profile (person + preference facts in structured JSONB)
  let profileContext = null;
  try {
    const userId = threadId.startsWith('portal-') ? threadId.slice(7)
      : threadId.startsWith('discord:') ? threadId.split(':')[2]
      : null;
    if (userId) {
      const profile = await db.getProfile(userId);
      if (profile?.data && Object.keys(profile.data).length > 0) {
        profileContext = Object.entries(profile.data)
          .map(([k, v]) => `• ${k.replace(/_/g, ' ')}: ${v}`)
          .join('\n');
      }
    }
  } catch { /* non-fatal */ }

  // Augment with relevant Pinecone memories
  let pineconeContext = null;
  try {
    const { results } = await archivist.retrieve({
      query:         userMessage,
      type_filter:   'conversation',
      top_k:         3,
      output_format: 'raw',
    });
    const goodHits = (results || []).filter(r => r.score > 0.7);
    if (goodHits.length > 0) {
      pineconeContext = goodHits.map(r => r.content).join('\n\n---\n\n');
    }
  } catch { /* non-fatal */ }

  const systemPrompt = _buildSystemPrompt(thread, pineconeContext, factsContext, profileContext, lessonsContext);
  const messages     = _buildMessages(
    { ...thread, messages: thread.messages.slice(0, -1) },
    userMessage,
  );

  // Primary: Ollama (free, local/Tailscale) → gpt-4o-mini fallback
  const allMsgs = [{ role: 'system', content: systemPrompt }, ...messages];
  const { result: ollamaResult, escalate: ollamaEscalate, reason: ollamaReason } =
    await ollama.tryChat(allMsgs, { params: { num_ctx: 8192 } });

  let reply;
  if (!ollamaEscalate && ollamaResult?.message?.content) {
    reply = ollamaResult.message.content.trim();
  } else {
    console.warn('[Keeper] Ollama failed, falling back to mini:', ollamaReason);
    const { result: miniResult, escalate: miniEscalate } = await mini.tryChat(allMsgs);
    reply = (!miniEscalate && miniResult?.message?.content)
      ? miniResult.message.content.trim()
      : "I'm having trouble connecting to my AI models right now. Please check the API keys.";
  }

  thread.messages.push({
    role:    'assistant',
    content: reply,
    ts:      new Date().toISOString(),
  });
  await _saveThread(thread);

  // Extract and store facts from this exchange in the background (non-blocking)
  memory.extractAndStore(userMessage, reply, threadId).catch(() => {});

  registry.setStatus('keeper', 'idle');
  return reply;
}

/**
 * Get conversation history for a thread.
 */
async function getHistory(threadId, limit = 50) {
  const thread = await _loadThread(threadId);
  return {
    threadId,
    summary:  thread.summary,
    messages: thread.messages.slice(-limit).map(m => ({
      role:    m.role,
      content: m.content,
      ts:      m.ts,
    })),
    total: thread.messages.length,
  };
}

/**
 * List all known thread IDs.
 */
async function listThreads() {
  try {
    const rows = await db.listThreads();
    return rows.map(r => ({
      threadId:     r.thread_id,
      messages:     r.message_count,
      updatedAt:    r.updated_at,
      summary:      !!r.summary,
    }));
  } catch {
    return [];
  }
}

/**
 * Add a system note to a thread.
 */
async function addNote(threadId, note) {
  const thread = await _loadThread(threadId);
  thread.messages.push({
    role:    'system',
    content: `[Note] ${note}`,
    ts:      new Date().toISOString(),
  });
  await _saveThread(thread);
}

/**
 * Clear a thread's history (keeps summary if any).
 */
async function clearThread(threadId) {
  const thread = await _loadThread(threadId);
  thread.messages = [];
  await _saveThread(thread);
}

module.exports = { chat, getHistory, listThreads, addNote, clearThread };
