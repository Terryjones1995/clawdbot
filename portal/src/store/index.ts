'use client';

import { create } from 'zustand';

export interface AgentState {
  id:          string;
  name:        string;
  role:        string;
  status:      'online' | 'working' | 'idle' | 'error' | 'offline';
  lastSeenAt:  string | null;
  model?:      string;
  events:      AgentEvent[];
}

export interface AgentEvent {
  ts:      string;
  message: string;
  type:    'info' | 'success' | 'error' | 'warning';
}

export interface AgentMessage {
  id:          string;
  fromAgentId: string;
  toAgentId?:  string;
  content:     string;
  ts:          string;
}

export interface TerminalLine {
  id:      string;
  type:    'input' | 'output' | 'error' | 'system' | 'thinking';
  content: string;
  ts:      string;
}

interface GhostStore {
  // Agents
  agents:     Record<string, AgentState>;
  upsertAgent: (agent: Partial<AgentState> & { id: string }) => void;
  setAgentStatus: (id: string, status: AgentState['status']) => void;
  pushAgentEvent: (id: string, msg: string, type?: AgentEvent['type']) => void;

  // Messages (for beam animation)
  messages:    AgentMessage[];
  pushMessage: (msg: AgentMessage) => void;

  // Selected agent (for drawer)
  selectedAgent:  string | null;
  selectAgent:    (id: string | null) => void;

  // Terminal
  terminalLines:   TerminalLine[];
  terminalOpen:    boolean;
  pushTerminalLine: (line: Omit<TerminalLine, 'id' | 'ts'>) => void;
  clearTerminal:   () => void;
  setTerminalOpen: (open: boolean) => void;

  // WS
  wsConnected: boolean;
  setWsConnected: (v: boolean) => void;

  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
}

export const useGhostStore = create<GhostStore>((set, get) => ({
  // ── Agents ──
  agents: {
    ghost:       { id: 'ghost',       name: 'Ghost',       role: 'Terminal AI / CEO',          status: 'online', lastSeenAt: null, events: [] },
    switchboard: { id: 'switchboard', name: 'Switchboard', role: 'Router / Classifier',        status: 'online', lastSeenAt: null, events: [] },
    warden:      { id: 'warden',      name: 'Warden',      role: 'Command & Control',          status: 'idle',   lastSeenAt: null, events: [] },
    scribe:      { id: 'scribe',      name: 'Scribe',      role: 'Ops / Summaries',            status: 'idle',   lastSeenAt: null, events: [] },
    archivist:   { id: 'archivist',   name: 'Archivist',   role: 'Long-term Memory',           status: 'idle',   lastSeenAt: null, events: [] },
    scout:       { id: 'scout',       name: 'Scout',       role: 'Intelligence / Research',    status: 'idle',   lastSeenAt: null, events: [] },
    forge:       { id: 'forge',       name: 'Forge',       role: 'Dev / Architect',            status: 'idle',   lastSeenAt: null, events: [] },
    courier:     { id: 'courier',     name: 'Courier',     role: 'Email / Comms',              status: 'idle',   lastSeenAt: null, events: [] },
    lens:        { id: 'lens',        name: 'Lens',        role: 'Analytics',                  status: 'idle',   lastSeenAt: null, events: [] },
    keeper:      { id: 'keeper',      name: 'Keeper',      role: 'Conversation Memory',        status: 'idle',   lastSeenAt: null, events: [] },
    sentinel:    { id: 'sentinel',    name: 'Sentinel',    role: 'Discord Connector',          status: 'idle',   lastSeenAt: null, events: [] },
    crow:        { id: 'crow',        name: 'Crow',        role: 'Social Media / X',           status: 'idle',   lastSeenAt: null, events: [] },
    operator:    { id: 'operator',    name: 'Operator',    role: 'Task Decomposition',         status: 'idle',   lastSeenAt: null, events: [] },
    helm:        { id: 'helm',        name: 'Helm',        role: 'SRE / Deploy',               status: 'idle',   lastSeenAt: null, events: [] },
    codex:       { id: 'codex',       name: 'Codex',       role: 'League Knowledge',           status: 'idle',   lastSeenAt: null, events: [] },
  },

  upsertAgent: (agent) =>
    set(s => ({
      agents: {
        ...s.agents,
        [agent.id]: {
          ...s.agents[agent.id],
          ...agent,
          // Always preserve the events array — never let it become undefined
          // (backend registry agents don't carry events)
          events: agent.events ?? s.agents[agent.id]?.events ?? [],
        } as AgentState,
      },
    })),

  setAgentStatus: (id, status) =>
    set(s => ({
      agents: {
        ...s.agents,
        [id]: { ...s.agents[id], status, lastSeenAt: new Date().toISOString() },
      },
    })),

  pushAgentEvent: (id, message, type = 'info') =>
    set(s => {
      const agent  = s.agents[id];
      if (!agent) return s;
      const events = [
        ...agent.events.slice(-49),
        { ts: new Date().toISOString(), message, type },
      ];
      return { agents: { ...s.agents, [id]: { ...agent, events } } };
    }),

  // ── Messages ──
  messages: [],
  pushMessage: (msg) =>
    set(s => ({ messages: [...s.messages.slice(-99), msg] })),

  // ── Selected agent ──
  selectedAgent: null,
  selectAgent: (id) => set({ selectedAgent: id }),

  // ── Terminal ──
  terminalLines: [
    {
      id:      'welcome',
      type:    'system',
      content: '⬡ OPERATION GHOST — Mission Control Center v2.0 | Type /help for commands',
      ts:      new Date().toISOString(),
    },
  ],
  terminalOpen: false,

  pushTerminalLine: (line) =>
    set(s => ({
      terminalLines: [
        ...s.terminalLines.slice(-199),
        { ...line, id: Math.random().toString(36).slice(2), ts: new Date().toISOString() },
      ],
    })),

  clearTerminal: () =>
    set({ terminalLines: [] }),

  setTerminalOpen: (open) => set({ terminalOpen: open }),

  // ── WS ──
  wsConnected: false,
  setWsConnected: (v) => set({ wsConnected: v }),

  // ── Sidebar ──
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
}));
