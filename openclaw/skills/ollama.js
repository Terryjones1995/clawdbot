'use strict';

/**
 * Ollama Connector
 *
 * Default brain for all Ghost agents (free-first principle).
 * Talks to a local Ollama server via its REST API — no npm package needed.
 *
 * Usage:
 *   const ollama = require('./openclaw/skills/ollama');
 *
 *   // Free-first pattern (returns { result, escalate, reason })
 *   const { result, escalate, reason } = await ollama.tryChat(messages);
 *   if (escalate) { ... use Claude instead ... }
 *
 *   // Direct calls
 *   const data  = await ollama.chat(messages);
 *   const text  = await ollama.generate('explain this code: ...');
 *   const vec   = await ollama.embed('some text');
 *   const ok    = await ollama.isAvailable();
 *   const models = await ollama.listModels();
 */

const fs   = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../memory/run_log.md');

class OllamaConnector {
  constructor() {
    this.host       = process.env.OLLAMA_HOST       || 'http://localhost:11434';
    this.model      = process.env.OLLAMA_MODEL      || 'qwen3:8b';
    this.embedModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  }

  // ── Health ────────────────────────────────────────────────────────────────

  /** Returns true if Ollama is reachable. */
  async isAvailable() {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Returns list of models installed in Ollama. */
  async listModels() {
    const data = await this._request('GET', '/api/tags');
    return (data.models || []).map(m => m.name);
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  /**
   * Chat completion (non-streaming).
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} options
   *   - model: override model (default: OLLAMA_MODEL)
   *   - params: extra Ollama params (temperature, top_p, etc.)
   * @returns Ollama chat response object
   */
  async chat(messages, options = {}) {
    const model = options.model || this.model;
    const start = Date.now();

    const body = {
      model,
      messages,
      stream: false,
      options: {
        num_ctx: 8192,        // default was 2048 — this 4× increase is free
        ...(options.params || {}),
      },
    };

    try {
      const data = await this._request('POST', '/api/chat', body);
      const ms   = Date.now() - start;
      this._log('INFO', 'chat', model, 'success',
        `tokens=${data.eval_count ?? '?'} duration=${ms}ms`);
      return data;
    } catch (err) {
      this._log('ERROR', 'chat', model, 'failed', err.message);
      throw err;
    }
  }

  /**
   * Free-first pattern: try Ollama, return escalation flag if unavailable or failed.
   *
   * Agents should use this instead of chat() directly.
   *
   * @returns {{ result: object|null, escalate: boolean, reason: string|null }}
   *
   * Example:
   *   const { result, escalate, reason } = await ollama.tryChat(messages);
   *   if (escalate) {
   *     // log escalation, call Claude Sonnet instead
   *   }
   */
  async tryChat(messages, options = {}) {
    const model = options.model || this.model;

    if (!(await this.isAvailable())) {
      this._log('WARN', 'chat', model, 'skipped', 'Ollama not reachable — escalation required');
      return { result: null, escalate: true, reason: 'Ollama not reachable' };
    }

    try {
      const result = await this.chat(messages, options);
      return { result, escalate: false, reason: null };
    } catch (err) {
      this._log('WARN', 'chat', model, 'failed', `${err.message} — escalation required`);
      return { result: null, escalate: true, reason: err.message };
    }
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  /**
   * Raw text generation (non-streaming).
   *
   * @param {string} prompt
   * @param {object} options
   *   - model: override model
   *   - system: system prompt string
   *   - params: extra Ollama params
   * @returns Ollama generate response object (.response contains the text)
   */
  async generate(prompt, options = {}) {
    const model = options.model || this.model;
    const start = Date.now();

    const body = {
      model,
      prompt,
      stream: false,
      ...(options.system ? { system: options.system } : {}),
      options: {
        num_ctx: 8192,
        ...(options.params || {}),
      },
    };

    try {
      const data = await this._request('POST', '/api/generate', body);
      const ms   = Date.now() - start;
      this._log('INFO', 'generate', model, 'success',
        `tokens=${data.eval_count ?? '?'} duration=${ms}ms`);
      return data;
    } catch (err) {
      this._log('ERROR', 'generate', model, 'failed', err.message);
      throw err;
    }
  }

  // ── Embeddings ────────────────────────────────────────────────────────────

  /**
   * Generate a vector embedding for a string.
   *
   * @param {string} text
   * @param {object} options - model: override embed model
   * @returns {number[]} embedding vector
   */
  async embed(text, options = {}) {
    const model = options.model || this.embedModel;

    const body = { model, prompt: text };

    try {
      const data = await this._request('POST', '/api/embeddings', body);
      this._log('INFO', 'embed', model, 'success',
        `dim=${data.embedding?.length ?? '?'}`);
      return data.embedding;
    } catch (err) {
      this._log('ERROR', 'embed', model, 'failed', err.message);
      throw err;
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  async _request(method, endpoint, body = null) {
    const url  = `${this.host}${endpoint}`;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(300_000), // 5-min timeout for CPU inference
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama ${endpoint} → HTTP ${res.status}: ${text}`);
    }

    return res.json();
  }

  _log(level, action, model, outcome, note) {
    const entry = [
      `[${level}]`,
      new Date().toISOString(),
      `| agent=Ollama`,
      `| action=${action}`,
      `| user_role=system`,
      `| model=${model}`,
      `| outcome=${outcome}`,
      `| escalated=false`,
      `| note="${note}"`,
    ].join(' ') + '\n';

    try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
  }
}

module.exports = new OllamaConnector();
