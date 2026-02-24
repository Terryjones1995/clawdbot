'use strict';

/**
 * Keeper — Persistent conversation memory agent
 *
 * Uses Qwen2.5 via Ollama (free, local, no API creds).
 * Stores conversations in memory/conversations/ as JSON files.
 * Each thread ID maps to one conversation file.
 *
 * Key capabilities:
 * - Full conversation history persisted across restarts
 * - Rolling summary when history > MAX_MESSAGES
 * - Large context window (Qwen2.5:7b supports 32k tokens)
 * - No external API keys required
 *
 * Thread ID conventions:
 *   discord:{channelId}:{userId}   — Discord channel conversation
 *   ui:{sessionId}                 — UI-initiated conversation
 *   global:{topic}                 — Global topic thread
 *
 * Usage:
 *   const keeper = require('./keeper');
 *   const reply = await keeper.chat('discord:123:456', 'Hey, remember when...');
 */

const fs   = require('fs');
const path = require('path');

const ollama   = require('../openclaw/skills/ollama');
const registry = require('./agentRegistry');

const CONVERSATIONS_DIR = path.join(__dirname, '../memory/conversations');
const MAX_MESSAGES       = 80;   // summarise old history beyond this
const KEEP_RECENT        = 20;   // messages kept as-is after summarisation
const MAX_CONTEXT_MSGS   = 30;   // max messages fed to LLM per request

const KEEPER_SYSTEM = `You are Keeper, Ghost's memory agent. You remember everything across conversations.
You have access to the full conversation history below. Use it to answer naturally, recall details, and maintain continuity.
Be concise — 1-3 sentences unless a longer answer is genuinely needed.
Never say you don't have memory of past conversations unless the history truly doesn't contain the info.`;

// ── File helpers ───────────────────────────────────────────────────────────────

function _threadPath(threadId) {
  // Sanitise: keep alphanumeric, dash, underscore, colon → replace the rest
  const safe = threadId.replace(/[^a-zA-Z0-9_\-:]/g, '_');
  return path.join(CONVERSATIONS_DIR, `${safe}.json`);
}

function _loadThread(threadId) {
  const p = _threadPath(threadId);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {
      threadId,
      messages:  [],
      summary:   null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

function _saveThread(thread) {
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
  thread.updatedAt = new Date().toISOString();
  fs.writeFileSync(_threadPath(thread.threadId), JSON.stringify(thread, null, 2));
}

// ── Summarisation ─────────────────────────────────────────────────────────────

async function _maybeSummarise(thread) {
  if (thread.messages.length <= MAX_MESSAGES) return thread;

  const toSummarise = thread.messages.slice(0, -KEEP_RECENT);
  const text = toSummarise.map(m => `${m.role === 'user' ? 'User' : 'Ghost'}: ${m.content}`).join('\n');

  const summarisePrompt = `Summarise the following conversation fragment into a compact paragraph. Preserve key facts, decisions made, topics discussed, and any personal details shared. Plain text only, no bullet points.\n\n${text}`;

  const { result } = await ollama.tryChat([
    { role: 'system', content: 'You are a concise summariser. Output plain text only.' },
    { role: 'user',   content: summarisePrompt },
  ]);

  if (result?.message?.content) {
    const newSummary = result.message.content.trim();
    thread.summary  = thread.summary
      ? `${thread.summary}\n\n---\n\n${newSummary}`
      : newSummary;
    thread.messages = thread.messages.slice(-KEEP_RECENT);
    _saveThread(thread);
  }

  return thread;
}

// ── Context builder ────────────────────────────────────────────────────────────

function _buildSystemPrompt(thread) {
  let sys = KEEPER_SYSTEM;
  if (thread.summary) {
    sys += `\n\n## Conversation summary so far:\n${thread.summary}`;
  }
  return sys;
}

function _buildMessages(thread, userMessage) {
  // Take last MAX_CONTEXT_MSGS messages
  const recent = thread.messages.slice(-MAX_CONTEXT_MSGS);
  // Add current user message
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

  let thread = _loadThread(threadId);

  // Store incoming user message
  thread.messages.push({
    role:    'user',
    content: userMessage,
    ts:      new Date().toISOString(),
  });
  _saveThread(thread);

  // Summarise if needed
  thread = await _maybeSummarise(thread);

  const systemPrompt = _buildSystemPrompt(thread);
  const messages     = _buildMessages(thread, ''); // last message is already in thread

  // Use the full thread (with summary as system context) for inference
  const { result, escalate } = await ollama.tryChat([
    { role: 'system', content: systemPrompt },
    ..._buildMessages({ ...thread, messages: thread.messages.slice(0, -1) }, userMessage),
  ]);

  const reply = (escalate || !result?.message?.content)
    ? "I'm here. What's on your mind?"
    : result.message.content.trim();

  // Store assistant reply
  thread.messages.push({
    role:    'assistant',
    content: reply,
    ts:      new Date().toISOString(),
  });
  _saveThread(thread);

  registry.setStatus('keeper', 'idle');
  return reply;
}

/**
 * Get conversation history for a thread.
 * Returns { threadId, summary, messages (last N), total }.
 */
function getHistory(threadId, limit = 50) {
  const thread = _loadThread(threadId);
  return {
    threadId,
    summary:  thread.summary,
    messages: thread.messages.slice(-limit).map(m => ({
      role:    m.role,
      content: m.content,
      ts:      m.ts,
    })),
    total:    thread.messages.length,
  };
}

/**
 * List all known thread IDs.
 */
function listThreads() {
  try {
    fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
    return fs.readdirSync(CONVERSATIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const thread = JSON.parse(fs.readFileSync(path.join(CONVERSATIONS_DIR, f), 'utf8'));
        return {
          threadId:  thread.threadId,
          messages:  thread.messages.length,
          updatedAt: thread.updatedAt,
          summary:   !!thread.summary,
        };
      })
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  } catch {
    return [];
  }
}

/**
 * Add a system note to a thread (e.g. "User prefers short answers").
 */
function addNote(threadId, note) {
  const thread = _loadThread(threadId);
  thread.messages.push({
    role:    'system',
    content: `[Note] ${note}`,
    ts:      new Date().toISOString(),
  });
  _saveThread(thread);
}

/**
 * Clear a thread's history (keeps summary if any).
 */
function clearThread(threadId) {
  const thread = _loadThread(threadId);
  thread.messages = [];
  _saveThread(thread);
}

module.exports = { chat, getHistory, listThreads, addNote, clearThread };
