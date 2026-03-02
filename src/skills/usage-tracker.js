'use strict';

/**
 * Usage Tracker — records every LLM/embedding API call with cost calculation.
 *
 * Usage:
 *   const { trackUsage } = require('./skills/usage-tracker');
 *   trackUsage({ provider: 'openai', model: 'gpt-4o-mini', agent: 'keeper', action: 'chat',
 *                input_tokens: 500, output_tokens: 200, latency_ms: 1200 });
 */

const db = require('../db');

// Cost per 1K tokens: [input, output]
const COST_MAP = {
  // OpenAI
  'gpt-4o-mini':                 [0.00015, 0.0006],
  'gpt-4o-mini-search-preview':  [0.00015, 0.0006],
  'gpt-4o':                      [0.0025,  0.01],
  'gpt-5.3-codex':               [0.002,   0.008],
  'o4-mini':                     [0.0011,  0.0044],
  // Anthropic
  'claude-sonnet-4-6':           [0.003,   0.015],
  'claude-opus-4-6':             [0.015,   0.075],
  'claude-haiku-4-5-20251001':   [0.0008,  0.004],
  // xAI
  'grok-4-1-fast-reasoning':     [0.003,   0.015],
  'grok-3-fast-beta':            [0.003,   0.015],
  // Free
  'qwen2.5:14b':                 [0, 0],
  'qwen3:8b':                    [0, 0],
  'nomic-embed-text':            [0, 0],
};

function _calcCost(model, inputTokens, outputTokens) {
  const rates = COST_MAP[model];
  if (!rates) return 0;
  return (inputTokens * rates[0] / 1000) + (outputTokens * rates[1] / 1000);
}

/**
 * Track an API usage event. Non-blocking, non-fatal.
 *
 * @param {object} opts
 *   - provider       {string}  'ollama' | 'openai' | 'anthropic' | 'xai'
 *   - model          {string}  model name
 *   - agent          {string}  which ghost agent made the call
 *   - action         {string}  'chat' | 'embed' | 'classify' | 'fix' | etc
 *   - input_tokens   {number}  approximate input tokens
 *   - output_tokens  {number}  approximate output tokens
 *   - latency_ms     {number}  call duration in ms
 *   - thread_id      {string}  optional thread context
 */
function trackUsage({ provider, model, agent, action, input_tokens = 0, output_tokens = 0, latency_ms = null, thread_id = null }) {
  const cost = _calcCost(model, input_tokens, output_tokens);
  db.logApiUsage({ provider, model, agent, action, input_tokens, output_tokens, cost, latency_ms, thread_id }).catch(() => {});
}

module.exports = { trackUsage };
