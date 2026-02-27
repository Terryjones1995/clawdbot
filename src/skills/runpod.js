'use strict';

/**
 * RunPod vLLM Skill — Qwen3-32B-AWQ via serverless endpoint
 *
 * Drop-in replacement for opus.tryChat() / mini.tryChat().
 * Submits jobs to the RunPod vLLM serverless endpoint and polls for results.
 *
 * Usage:
 *   const runpod = require('./skills/runpod');
 *   const { result, escalate, reason } = await runpod.tryChat(messages);
 *   if (!escalate) reply = result.message.content;
 */

const MODEL = process.env.RUNPOD_MODEL    || 'Qwen/Qwen3-32B-AWQ';
const BASE  = process.env.RUNPOD_ENDPOINT || ''; // https://api.runpod.ai/v2/{id}
const KEY   = process.env.RUNPOD_API_KEY  || '';

const POLL_INTERVAL_MS  = 2_000;
const MAX_POLL_MS       = 480_000; // 8-min max wait (handles GPU cold start + model load)
const COLD_START_LOG_MS = 30_000;  // log a warning if still queued after 30s

// ── HTTP helpers ───────────────────────────────────────────────────────────────

async function _post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${KEY}`,
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RunPod ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function _get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${KEY}` },
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RunPod ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Job polling ────────────────────────────────────────────────────────────────

async function _pollJob(jobId) {
  const deadline  = Date.now() + MAX_POLL_MS;
  const startedAt = Date.now();
  let warnedCold  = false;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const status = await _get(`/status/${jobId}`);

    if (status.status === 'COMPLETED') return status.output;
    if (status.status === 'FAILED')
      throw new Error(`RunPod job failed: ${status.error ?? 'unknown'}`);

    // Log cold-start warning once after 30s still in queue
    if (!warnedCold && Date.now() - startedAt > COLD_START_LOG_MS && status.status === 'IN_QUEUE') {
      console.warn(`[RunPod] Cold start detected — worker spinning up (job ${jobId}). This takes 3-8 min on first use.`);
      warnedCold = true;
    }
  }
  throw new Error(`RunPod job ${jobId} timed out after ${MAX_POLL_MS / 1000}s`);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Append /no_think to the last user message to disable Qwen3's reasoning phase.
 * This prevents the model from spending all its tokens on <think>...</think> blocks.
 */
function _injectNoThink(messages) {
  const copy = messages.map(m => ({ ...m }));
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].role === 'user') {
      if (!copy[i].content.includes('/no_think')) {
        copy[i] = { ...copy[i], content: `${copy[i].content} /no_think` };
      }
      break;
    }
  }
  return copy;
}

/**
 * Submit a chat completion to RunPod vLLM and wait for the result.
 *
 * @param {Array<{role,content}>} messages  OpenAI-format messages (system role supported)
 * @param {object} options
 *   - model:      override model (default: RUNPOD_MODEL)
 *   - maxTokens:  max output tokens (default: 1024)
 *   - temperature (default: 0.7)
 * @returns vLLM OpenAI-compatible output object
 */
async function complete(messages, options = {}) {
  if (!BASE || !KEY) throw new Error('RunPod not configured (check RUNPOD_ENDPOINT / RUNPOD_API_KEY)');

  // Inject /no_think into the last user message to disable Qwen3's reasoning phase.
  // Without this, Qwen3 spends its entire token budget on <think> blocks.
  const preparedMsgs = _injectNoThink(messages);

  const input = {
    messages:    preparedMsgs,
    model:       options.model       || MODEL,
    max_tokens:  options.maxTokens   || 2048,
    temperature: options.temperature ?? 0.7,
    stream:      false,
  };

  const job    = await _post('/run', { input });
  const output = await _pollJob(job.id);
  return output;
}

/**
 * Extract the text content from vLLM RunPod output.
 * Handles multiple output shapes returned by different vLLM versions:
 *   - output[0].choices[0].tokens (array of token strings) ← vLLM v2.x RunPod worker
 *   - output[0].choices[0].message.content                 ← OpenAI-compat shape
 *   - output.choices[0].message.content                    ← direct vLLM response
 *   - output.text                                          ← generate endpoint
 */
function _extractContent(output) {
  // vLLM RunPod worker wraps output in an array
  const item = Array.isArray(output) ? output[0] : output;
  if (!item) return '';

  const choice = item?.choices?.[0];
  if (!choice) return item?.text ?? '';

  // Token-array format (vLLM streaming-style output)
  if (Array.isArray(choice.tokens)) return choice.tokens.join('');

  // Standard OpenAI message format
  if (choice.message?.content) return choice.message.content;

  // Delta format (shouldn't appear in non-stream, but just in case)
  if (choice.delta?.content) return choice.delta.content;

  return item?.text ?? '';
}

/**
 * Drop-in for opus.tryChat() / mini.tryChat().
 * Returns { result: { message: { content }, model }, escalate, reason }
 */
async function tryChat(messages, options = {}) {
  if (!BASE || !KEY) {
    return { result: null, escalate: true, reason: 'RunPod not configured' };
  }

  try {
    const output = await complete(messages, options);
    const raw    = _extractContent(output);
    if (!raw) throw new Error('Empty response from RunPod vLLM');

    // Strip Qwen3 <think>...</think> reasoning block — keep only the final reply.
    // Strategy: if </think> exists, take everything after it.
    // If only <think> with no closing tag, strip everything (thinking cut off).
    let content;
    const thinkEnd = raw.indexOf('</think>');
    if (thinkEnd !== -1) {
      content = raw.slice(thinkEnd + '</think>'.length).trim();
    } else {
      content = raw.replace(/<think>[\s\S]*/g, '').trim();
    }

    return {
      result:   { message: { content: content || raw }, model: MODEL },
      escalate: false,
      reason:   null,
    };
  } catch (err) {
    console.warn('[RunPod] tryChat failed:', err.message);
    return { result: null, escalate: true, reason: err.message };
  }
}

/**
 * Check if the RunPod endpoint is configured (not necessarily healthy).
 */
function isConfigured() {
  return !!(BASE && KEY);
}

module.exports = { tryChat, complete, isConfigured, MODEL };
