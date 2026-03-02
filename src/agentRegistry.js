'use strict';

/**
 * agentRegistry — in-memory state of all Ghost agents.
 *
 * Each agent record:
 *   { id, name, role, status, lastActivity, meta }
 *
 * Agents update their own state via registry.setStatus(id, status).
 * The WS server calls registry.subscribe(fn) to receive change events.
 */

const AGENTS = [
  { id: 'ghost',       name: 'Ghost',       role: 'Terminal AI / CEO'       },
  { id: 'switchboard', name: 'Switchboard', role: 'Router / Classifier'     },
  { id: 'warden',      name: 'Warden',      role: 'Command & Control'       },
  { id: 'scribe',      name: 'Scribe',      role: 'Ops / Summaries'         },
  { id: 'archivist',   name: 'Archivist',   role: 'Long-term Memory'        },
  { id: 'scout',       name: 'Scout',       role: 'Intelligence / Research' },
  { id: 'forge',       name: 'Forge',       role: 'Dev / Architect'         },
  { id: 'courier',     name: 'Courier',     role: 'Email / Comms'           },
  { id: 'lens',        name: 'Lens',        role: 'Analytics'               },
  { id: 'keeper',      name: 'Keeper',      role: 'Conversation Memory'     },
  { id: 'sentinel',    name: 'Sentinel',    role: 'Discord Connector'       },
  { id: 'helm',        name: 'Helm',        role: 'SRE / Deploy'            },
];

// In-memory state
const state = {};
AGENTS.forEach(a => {
  state[a.id] = {
    id:           a.id,
    name:         a.name,
    role:         a.role,
    status:       'idle',
    lastActivity: null,
    meta:         {},
    events:       [],   // recent events (max 20 in-memory)
  };
});

const subscribers = new Set();

function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function _emit(agentId, update) {
  subscribers.forEach(fn => {
    try { fn(agentId, update); } catch { /* non-fatal */ }
  });
}

function setStatus(agentId, status, meta = {}) {
  if (!state[agentId]) return;
  state[agentId].status       = status;
  state[agentId].lastActivity = new Date().toISOString();
  if (Object.keys(meta).length) {
    state[agentId].meta = { ...state[agentId].meta, ...meta };
  }
  _emit(agentId, { id: agentId, status, lastActivity: state[agentId].lastActivity, ...meta });
}

function pushEvent(agentId, message, type = 'info') {
  if (!state[agentId]) return;
  const ts = new Date().toISOString();
  const event = { ts, message, type };
  state[agentId].events = [...state[agentId].events.slice(-19), event];
  _emit(agentId, { __event: true, id: agentId, message, type, ts });
}

function getAll() {
  return Object.values(state);
}

function get(agentId) {
  return state[agentId] || null;
}

/**
 * Load recent events from agent_logs DB and populate in-memory events.
 * Called once at startup so new WS clients see historical activity.
 */
async function loadRecentEvents() {
  try {
    const db = require('./db');
    const { rows } = await db.query(
      `SELECT ts, level, agent, action, outcome, note
       FROM agent_logs
       ORDER BY ts DESC
       LIMIT 100`,
    );

    // Map agent names to registry IDs
    const nameToId = {};
    AGENTS.forEach(a => { nameToId[a.name.toLowerCase()] = a.id; });

    // Also map common variations
    nameToId.ghost = 'ghost';
    nameToId.reception = 'ghost';

    // Group by agent, newest first (reversed so oldest is pushed first)
    const byAgent = {};
    for (const row of rows.reverse()) {
      const id = nameToId[(row.agent || '').toLowerCase()];
      if (!id || !state[id]) continue;
      if (!byAgent[id]) byAgent[id] = [];

      const type = row.level === 'ERROR' ? 'error'
        : row.level === 'WARN' ? 'warning'
        : row.outcome === 'success' ? 'success'
        : 'info';

      byAgent[id].push({
        ts:      row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
        message: `${row.action}: ${row.note || row.outcome}`,
        type,
      });
    }

    for (const [id, events] of Object.entries(byAgent)) {
      state[id].events = events.slice(-20);
      // Update lastActivity to most recent event
      if (events.length) {
        state[id].lastActivity = events[events.length - 1].ts;
      }
    }

    console.log(`[Registry] Loaded recent events for ${Object.keys(byAgent).length} agents`);
  } catch (err) {
    console.warn('[Registry] Failed to load recent events:', err.message);
  }
}

module.exports = { subscribe, setStatus, pushEvent, getAll, get, loadRecentEvents };
