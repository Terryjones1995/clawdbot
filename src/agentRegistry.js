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
  { id: 'sentinel',    name: 'Sentinel',    role: 'Discord Connector'   },
  { id: 'switchboard', name: 'Switchboard', role: 'Router / Classifier' },
  { id: 'scout',       name: 'Scout',       role: 'Research'            },
  { id: 'forge',       name: 'Forge',       role: 'Dev / Architect'     },
  { id: 'scribe',      name: 'Scribe',      role: 'Ops / Summaries'     },
  { id: 'warden',      name: 'Warden',      role: 'Approvals'           },
  { id: 'archivist',   name: 'Archivist',   role: 'Memory'              },
  { id: 'lens',        name: 'Lens',        role: 'Analytics'           },
  { id: 'courier',     name: 'Courier',     role: 'Email'               },
  { id: 'helm',        name: 'Helm',        role: 'SRE / Deploy'        },
  { id: 'keeper',      name: 'Keeper',      role: 'Conversation Memory' },
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

function pushEvent(agentId, message) {
  const ts = new Date().toISOString();
  _emit(agentId, { __event: true, id: agentId, message, ts });
}

function getAll() {
  return Object.values(state);
}

function get(agentId) {
  return state[agentId] || null;
}

module.exports = { subscribe, setStatus, pushEvent, getAll, get };
