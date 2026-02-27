'use strict';

/**
 * Keeper — Persistent conversation memory agent
 *
 * Uses Claude Opus 4.6 for main chat (highest capability).
 * Uses gpt-4o-mini for rolling summarization (cheap).
 * Stores conversations in memory/conversations/ as JSON files.
 * Augments context with Pinecone long-term memories via Archivist.
 *
 * Thread ID conventions:
 *   portal-{userId}               — Portal terminal conversation
 *   discord:{channelId}:{userId}  — Discord channel conversation
 *   global:{topic}                — Global topic thread
 *
 * Usage:
 *   const keeper = require('./keeper');
 *   const reply = await keeper.chat('portal-user123', 'Hey, remember when...');
 */

const fs   = require('fs');
const path = require('path');

const opus     = require('./skills/opus');
const mini     = require('./skills/openai-mini');
const registry = require('./agentRegistry');
const archivist = require('./archivist');

const CONVERSATIONS_DIR = path.join(__dirname, '../memory/conversations');
const MAX_MESSAGES       = 80;   // summarise old history beyond this
const KEEP_RECENT        = 20;   // messages kept as-is after summarisation
const MAX_CONTEXT_MSGS   = 30;   // max messages fed to LLM per request

function _ghostSystem() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Ghost, an elite AI operations assistant. You remember everything — use your conversation history.
You manage a league operations platform (HOF League) and a multi-agent Discord system.
Sharp, direct, 1-3 sentences unless detail is genuinely needed.
Current date: ${today}.`;
}

// ── File helpers ───────────────────────────────────────────────────────────────

function _threadPath(threadId) {
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
    _saveThread(thread);
  }

  return thread;
}

// ── Context builder ────────────────────────────────────────────────────────────

function _buildSystemPrompt(thread, pineconeContext = null) {
  let sys = _ghostSystem();
  if (pineconeContext) {
    sys += `\n\n## Relevant long-term memories:\n${pineconeContext}`;
  }
  if (thread.summary) {
    sys += `\n\n## Conversation summary so far:\n${thread.summary}`;
  }
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

  let thread = _loadThread(threadId);

  // Store incoming user message
  thread.messages.push({
    role:    'user',
    content: userMessage,
    ts:      new Date().toISOString(),
  });
  _saveThread(thread);

  // Summarise if needed — track if summarisation happened to push to Pinecone
  const beforeLen = thread.messages.length;
  thread = await _maybeSummarise(thread);
  const justSummarised = beforeLen > MAX_MESSAGES && thread.messages.length <= KEEP_RECENT;

  // Push new summary to Pinecone long-term memory (non-fatal, background)
  if (justSummarised && thread.summary) {
    archivist.store({
      type:         'conversation',
      content:      thread.summary,
      tags:         [threadId],
      source_agent: 'keeper',
      ttl_days:     180,
    }).catch(() => {}); // non-fatal
  }

  // Augment with relevant Pinecone memories (non-fatal)
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
  } catch { /* Pinecone/Ollama unavailable — non-fatal */ }

  const systemPrompt = _buildSystemPrompt(thread, pineconeContext);
  const messages     = _buildMessages(
    { ...thread, messages: thread.messages.slice(0, -1) }, // exclude the just-pushed user msg
    userMessage,
  );

  let opusResult = await opus.tryChat([
    { role: 'system', content: systemPrompt },
    ...messages,
  ]);

  let reply;
  if (!opusResult.escalate && opusResult.result?.message?.content) {
    reply = opusResult.result.message.content.trim();
  } else {
    // Opus failed (likely no credits) — fall back to gpt-4o-mini
    if (opusResult.escalate) {
      console.warn('[Keeper] Opus failed, falling back to mini:', opusResult.reason);
    }
    const { result: miniResult, escalate: miniEscalate } = await mini.tryChat([
      { role: 'system', content: systemPrompt },
      ...messages,
    ]);
    reply = (!miniEscalate && miniResult?.message?.content)
      ? miniResult.message.content.trim()
      : "I'm having trouble connecting to my AI models right now. Please check the API keys.";
  }

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
    total: thread.messages.length,
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
 * Add a system note to a thread.
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
