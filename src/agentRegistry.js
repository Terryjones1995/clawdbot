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
  { id: 'ghost',   name: 'Ghost',   role: 'CEO / Brain'           },
  { id: 'oracle',  name: 'Oracle',  role: 'Operations Manager'    },
  { id: 'nexus',   name: 'Nexus',   role: 'Reception / Router'    },
  { id: 'viper',   name: 'Viper',   role: 'Social Media Head'     },
  { id: 'atlas',   name: 'Atlas',   role: 'Support Head'          },
  { id: 'pulse',   name: 'Pulse',   role: 'Marketing Head'        },
  { id: 'scout',   name: 'Scout',   role: 'Intelligence'          },
  { id: 'courier', name: 'Courier', role: 'Email / Comms'         },
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
