'use strict';

/**
 * OpenAI gpt-5.3-codex — code generation / bug-fix model.
 *
 * gpt-5.3-codex uses the Responses API (v1/responses), not Chat Completions.
 * Falls back to o4-mini (Chat Completions) if unavailable.
 *
 * Usage:
 *   const codex = require('./openai-codex');
 *   const { text, escalate } = await codex.fixCode(systemPrompt, userPrompt);
 */

const { OpenAI } = require('openai');

const MODEL          = 'gpt-5.3-codex';
const FALLBACK_MODEL = 'o4-mini';
const client         = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Fix code using gpt-5.3-codex (Responses API).
 * Falls back to o4-mini (Chat Completions) on any error.
 * Returns { text, model, escalate, reason }.
 */
async function fixCode(systemPrompt, userPrompt, maxTokens = 8192) {
  // ── Primary: gpt-5.3-codex via Responses API ──
  try {
    const res = await client.responses.create({
      model:             MODEL,
      max_output_tokens: maxTokens,
      instructions:      systemPrompt,
      input:             userPrompt,
    });
    const text = res.output_text ?? '';
    return { text, model: MODEL, escalate: false, reason: null };
  } catch (primaryErr) {
    // ── Fallback: o4-mini via Chat Completions ──
    try {
      const res = await client.chat.completions.create({
        model:                 FALLBACK_MODEL,
        max_completion_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
      });
      const text = res.choices[0]?.message?.content ?? '';
      return { text, model: FALLBACK_MODEL, escalate: false, reason: `${MODEL} unavailable: ${primaryErr.message}` };
    } catch (fallbackErr) {
      return { text: '', model: MODEL, escalate: true, reason: fallbackErr.message };
    }
  }
}

/**
 * Drop-in for mini.tryChat() interface.
 * Uses gpt-5.3-codex Responses API, falls back to o4-mini.
 */
async function tryChat(messages, options = {}) {
  // Extract system + user messages for Responses API
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const userMsg   = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n\n');
  const model     = options.model || MODEL;

  try {
    const res = await client.responses.create({
      model:             model,
      max_output_tokens: options.maxTokens || 4096,
      instructions:      systemMsg || undefined,
      input:             userMsg,
    });
    const content = res.output_text ?? '';
    return {
      result:   { message: { content }, model },
      escalate: false,
      reason:   null,
    };
  } catch (err) {
    return { result: null, escalate: true, reason: err.message };
  }
}

module.exports = { fixCode, tryChat, MODEL };
