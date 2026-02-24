'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useGhostStore } from '@/store';
import { agentColor, agentEmoji, statusColor, formatRelative } from '@/lib/utils';
import { X, Activity, Zap, MessageSquare, ChevronRight, GitBranch, Cpu, Tag } from 'lucide-react';

// ── Agent metadata — descriptions, model, responsibilities, reporting ─────────
const AGENT_META: Record<string, {
  desc:        string;
  model:       string;
  reportsTo:   string | null;
  manages?:    string[];
  tags:        string[];
  details:     string[];
}> = {
  sentinel: {
    desc:      'The front door to Operation Ghost. Every Discord message flows through Sentinel — it reads requests, routes them to the right agent, and delivers replies. The central nervous system.',
    model:     'gpt-4o (vision) + Switchboard',
    reportsTo: null,
    manages:   ['switchboard', 'warden', 'archivist', 'lens', 'helm', 'keeper'],
    tags:      ['Orchestration', 'Discord', 'Reception', 'Gateway'],
    details:   [
      'Reads every message in #reception channel',
      'Routes to Switchboard for classification',
      'Handles image inputs via GPT-4o vision',
      'Delivers final replies back to Discord',
      'Manages "Please wait" immediate acknowledgements',
    ],
  },
  switchboard: {
    desc:      'The silent router. Classifies every incoming request in milliseconds using Ollama, decides which agent should handle it, and hands off without being seen.',
    model:     'qwen3:8b (Ollama)',
    reportsTo: 'sentinel',
    tags:      ['Classification', 'Routing', 'Intent Detection'],
    details:   [
      'Classifies messages into 15+ intent categories',
      'Routes to Scout, Forge, Scribe, Courier, Keeper, etc.',
      'Free-first: always uses local Ollama qwen3:8b',
      'Handles greeting and unclassifiable messages',
    ],
  },
  scout: {
    desc:      'The researcher. When someone needs facts, news, web data, or real-time information, Scout hunts it down. Uses Grok for live web queries and reasoning.',
    model:     'Grok grok-4-1-fast-reasoning',
    reportsTo: 'sentinel',
    tags:      ['Research', 'Web Search', 'Real-time', 'Grok'],
    details:   [
      'Handles web search and real-time data queries',
      'Uses Grok for fast reasoning and trend analysis',
      'Falls back to Claude Sonnet for deep synthesis',
      'Covers news, sports scores, prices, weather',
      'Stores research results in Archivist memory',
    ],
  },
  forge: {
    desc:      'The builder. Forge writes code, reviews PRs, designs architecture, and debugs problems. Your senior developer who ships without being asked twice.',
    model:     'qwen3:8b → Claude Sonnet (escalation)',
    reportsTo: 'sentinel',
    tags:      ['Code', 'Architecture', 'Dev', 'Review'],
    details:   [
      'Code generation, review, and debugging',
      'PR analysis and architecture recommendations',
      'Default to Ollama qwen3:8b for code tasks',
      'Escalates complex synthesis to Claude Sonnet',
    ],
  },
  scribe: {
    desc:      'The operator. Scribe keeps everything running: daily briefings, scheduled summaries, calendar reminders, and ops documentation. The backbone of daily workflow.',
    model:     'qwen3:8b (Ollama)',
    reportsTo: 'sentinel',
    tags:      ['Ops', 'Summaries', 'Scheduling', 'Briefings'],
    details:   [
      'Sends automated daily summaries at 9am UTC',
      'Manages reminder and scheduling requests',
      'Writes operational recap documents',
      'Monitors system health and sends alerts',
    ],
  },
  courier: {
    desc:      'The communicator. All outbound emails flow through Courier. Drafts, reviews, and sends via Resend API with professional formatting.',
    model:     'qwen3:8b → Resend API',
    reportsTo: 'sentinel',
    tags:      ['Email', 'Resend', 'Drafts', 'Outbound'],
    details:   [
      'Drafts and sends emails via Resend API',
      'Formats messages for professional delivery',
      'Handles email scheduling and batch sends',
      'Requires ADMIN approval for mass sends',
    ],
  },
  warden: {
    desc:      'The gatekeeper. Warden reviews and approves potentially dangerous operations before they execute. Nothing risky runs without Warden\'s sign-off.',
    model:     'Rule-based + qwen3:8b',
    reportsTo: 'sentinel',
    tags:      ['Approvals', 'Safety', 'Control', 'Guard'],
    details:   [
      'Intercepts high-risk operations for approval',
      'Manages the approval queue visible in portal',
      'Requires OWNER approval for: mass DM, deletes, payments',
      'Logs all approval decisions to audit trail',
    ],
  },
  archivist: {
    desc:      'The memory. Archivist stores and retrieves context via Pinecone vector search. It\'s how Ghost remembers past conversations and learns over time.',
    model:     'nomic-embed-text + Pinecone',
    reportsTo: 'sentinel',
    tags:      ['Memory', 'Pinecone', 'Vector Search', 'RAG'],
    details:   [
      'Embeds text using nomic-embed-text (local)',
      'Stores vectors in Pinecone ghost-memory namespace',
      'Retrieves relevant context for any query',
      '768-dimension embeddings, cosine similarity',
    ],
  },
  lens: {
    desc:      'The analyst. Lens watches event data, tracks usage patterns, and surfaces insights. Powered by PostHog for behavioral analytics.',
    model:     'PostHog + qwen3:8b',
    reportsTo: 'sentinel',
    tags:      ['Analytics', 'PostHog', 'Insights', 'Data'],
    details:   [
      'Tracks agent activity and request patterns',
      'Monitors API usage and cost trends',
      'Surfaces anomalies and performance degradation',
      'Generates weekly analytics reports',
    ],
  },
  helm: {
    desc:      'The SRE. Helm monitors system health, manages PM2 processes, and handles deployments. It keeps the entire Ghost stack alive and running.',
    model:     'PM2 API + qwen3:8b',
    reportsTo: 'sentinel',
    tags:      ['SRE', 'Deploy', 'Infrastructure', 'PM2'],
    details:   [
      'Monitors PM2 process health and restarts',
      'Manages deployment pipeline and rollbacks',
      'Handles server resource monitoring',
      'Alerts on crashes or degraded performance',
    ],
  },
  keeper: {
    desc:      'The conversationalist. Keeper maintains conversational context across sessions, enabling Ghost to remember who you are and what you\'ve discussed.',
    model:     'qwen3:8b (Ollama)',
    reportsTo: 'sentinel',
    tags:      ['Conversation', 'Context', 'Memory', 'Chat'],
    details:   [
      'Maintains per-user conversation threads',
      'Context-aware replies using rolling history',
      'Default fallback for unclassified messages',
      'Stores threads in Neon PostgreSQL',
    ],
  },
  codex: {
    desc:      'The knowledge base. Codex stores and retrieves structured knowledge about your league, team, and domain-specific context.',
    model:     'qwen3:8b + Pinecone',
    reportsTo: 'sentinel',
    tags:      ['Knowledge Base', 'League', 'Domain', 'QA'],
    details:   [
      'Answers domain-specific questions (league, team)',
      'Maintains structured knowledge documents',
      'Combines vector search with structured lookup',
    ],
  },
  operator: {
    desc:      'The dispatcher. Operator breaks complex requests into subtasks and assigns them to the right agents in the right order.',
    model:     'qwen3:8b (Ollama)',
    reportsTo: 'sentinel',
    tags:      ['Task Dispatch', 'Orchestration', 'Planning'],
    details:   [
      'Decomposes multi-step tasks into subtasks',
      'Assigns work to appropriate specialist agents',
      'Tracks task completion and aggregates results',
    ],
  },
};

// Agent layout positions for the graph (normalized 0-1)
const AGENT_POSITIONS: Record<string, { x: number; y: number; layer: number }> = {
  sentinel:    { x: 0.5,   y: 0.07,  layer: 0 },
  // Primary workers — directly commanded by Sentinel
  scout:       { x: 0.1,   y: 0.36,  layer: 1 },
  forge:       { x: 0.28,  y: 0.36,  layer: 1 },
  scribe:      { x: 0.5,   y: 0.36,  layer: 1 },
  courier:     { x: 0.72,  y: 0.36,  layer: 1 },
  keeper:      { x: 0.9,   y: 0.36,  layer: 1 },
  // Meta layer — infrastructure & control
  switchboard: { x: 0.12,  y: 0.72,  layer: 2 },
  warden:      { x: 0.28,  y: 0.72,  layer: 2 },
  archivist:   { x: 0.45,  y: 0.72,  layer: 2 },
  lens:        { x: 0.62,  y: 0.72,  layer: 2 },
  helm:        { x: 0.78,  y: 0.72,  layer: 2 },
  // Specialists
  codex:       { x: 0.88,  y: 0.54,  layer: 1 },
  operator:    { x: 0.05,  y: 0.54,  layer: 1 },
};

// Edge = [from, to, label?] — direction: from reports to 'to' (downward flow: sentinel dispatches)
const EDGES: [string, string, string?][] = [
  ['sentinel', 'scout',       'dispatches'],
  ['sentinel', 'forge',       'dispatches'],
  ['sentinel', 'scribe',      'dispatches'],
  ['sentinel', 'courier',     'dispatches'],
  ['sentinel', 'keeper',      'dispatches'],
  ['sentinel', 'codex',       'dispatches'],
  ['sentinel', 'operator',    'dispatches'],
  ['sentinel', 'switchboard', 'routes via'],
  ['sentinel', 'warden',      'guarded by'],
  ['sentinel', 'archivist',   'stores via'],
  ['sentinel', 'lens',        'monitored by'],
  ['sentinel', 'helm',        'deployed by'],
];

interface BeamAnimation {
  id:   string;
  from: string;
  to:   string;
  t:    number;
}

function AgentGraph({ onSelect }: { onSelect: (id: string) => void }) {
  const { agents, messages, selectedAgent } = useGhostStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims,  setDims]  = useState({ w: 800, h: 500 });
  const [beams, setBeams] = useState<BeamAnimation[]>([]);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    function update() {
      if (svgRef.current) {
        const r = svgRef.current.getBoundingClientRect();
        setDims({ w: r.width || 800, h: r.height || 500 });
      }
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Animate beams when new messages arrive
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last.toAgentId) return;

    const beam: BeamAnimation = {
      id:   `${last.id}-${Date.now()}`,
      from: last.fromAgentId,
      to:   last.toAgentId,
      t:    0,
    };
    setBeams(b => [...b.slice(-4), beam]);

    // Animate
    const start = Date.now();
    const duration = 1200;
    function tick() {
      const elapsed = Date.now() - start;
      const t = Math.min(elapsed / duration, 1);
      setBeams(b => b.map(bm => bm.id === beam.id ? { ...bm, t } : bm));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else setBeams(b => b.filter(bm => bm.id !== beam.id));
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [messages]);

  function pos(id: string) {
    const p = AGENT_POSITIONS[id] ?? { x: 0.5, y: 0.5 };
    return { x: p.x * dims.w, y: p.y * dims.h };
  }

  return (
    <div className="relative w-full h-full">
      <svg ref={svgRef} width="100%" height="100%">
        <defs>
          <radialGradient id="node-glow">
            <stop offset="0%"   stopColor="#00D4FF" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#00D4FF" stopOpacity="0" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Layer labels */}
        <text x={dims.w * 0.01} y={dims.h * 0.09} fill="rgba(0,212,255,0.35)" fontSize="8" fontFamily="JetBrains Mono" letterSpacing="2">ORCHESTRATOR</text>
        <text x={dims.w * 0.01} y={dims.h * 0.37} fill="rgba(0,212,255,0.25)" fontSize="8" fontFamily="JetBrains Mono" letterSpacing="2">WORKERS</text>
        <text x={dims.w * 0.01} y={dims.h * 0.73} fill="rgba(0,212,255,0.25)" fontSize="8" fontFamily="JetBrains Mono" letterSpacing="2">META LAYER</text>

        {/* Horizontal layer lines */}
        {[0.15, 0.49, 0.83].map((y, i) => (
          <line key={i} x1="0" y1={y * dims.h} x2={dims.w} y2={y * dims.h}
                stroke="rgba(0,212,255,0.04)" strokeWidth="1" strokeDasharray="4 8" />
        ))}

        {/* Arrow marker */}
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(0,212,255,0.5)" />
          </marker>
          <marker id="arrow-active" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(0,212,255,0.9)" />
          </marker>
        </defs>

        {/* Edges */}
        {EDGES.map(([from, to, label]) => {
          const a = pos(from), b = pos(to);
          const isActive = selectedAgent === from || selectedAgent === to;
          // Shorten line to avoid overlapping node circles
          const nodeR = from === 'sentinel' ? 26 : 20;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const sx = a.x + (dx / dist) * nodeR;
          const sy = a.y + (dy / dist) * nodeR;
          const ex = b.x - (dx / dist) * (nodeR + 4);
          const ey = b.y - (dy / dist) * (nodeR + 4);
          const midX = (sx + ex) / 2;
          const midY = (sy + ey) / 2;
          return (
            <g key={`${from}-${to}`}>
              <line
                x1={sx} y1={sy} x2={ex} y2={ey}
                stroke={isActive ? 'rgba(0,212,255,0.5)' : 'rgba(0,212,255,0.12)'}
                strokeWidth={isActive ? 1.5 : 0.8}
                strokeDasharray={isActive ? 'none' : '4 6'}
                markerEnd={isActive ? 'url(#arrow-active)' : 'url(#arrow)'}
              />
              {/* Relationship label on hover (only when this agent selected) */}
              {isActive && label && (
                <text x={midX} y={midY - 4} textAnchor="middle"
                      fill="rgba(0,212,255,0.6)" fontSize="7"
                      fontFamily="JetBrains Mono" letterSpacing="0.5">
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* Beam animations */}
        {beams.map((beam) => {
          const a = pos(beam.from), b = pos(beam.to);
          if (!a || !b) return null;
          const x = a.x + (b.x - a.x) * beam.t;
          const y = a.y + (b.y - a.y) * beam.t;
          const opacity = Math.sin(beam.t * Math.PI);
          return (
            <g key={beam.id}>
              <circle cx={x} cy={y} r={6} fill="rgba(0,212,255,0.15)" />
              <circle cx={x} cy={y} r={3} fill="#00D4FF" opacity={opacity} filter="url(#glow)" />
            </g>
          );
        })}

        {/* Agent nodes */}
        {Object.values(agents).map((agent) => {
          const p     = pos(agent.id);
          const color = agentColor(agent.id);
          const isSelected = selectedAgent === agent.id;
          const isWorking  = agent.status === 'working';
          const r = agent.id === 'sentinel' ? 26 : 20;

          return (
            <g key={agent.id} style={{ cursor: 'pointer' }}
               onClick={() => onSelect(agent.id)}>
              {/* Glow ring for working agents */}
              {isWorking && (
                <circle cx={p.x} cy={p.y} r={r + 8}
                        fill="none"
                        stroke={color}
                        strokeWidth="1"
                        opacity="0.3"
                        style={{ animation: 'status-pulse 2s ease-in-out infinite' }}
                />
              )}
              {/* Selected ring */}
              {isSelected && (
                <circle cx={p.x} cy={p.y} r={r + 6}
                        fill="none"
                        stroke="#00D4FF"
                        strokeWidth="2"
                        opacity="0.6"
                />
              )}
              {/* Node bg */}
              <circle cx={p.x} cy={p.y} r={r}
                      fill={`${color}20`}
                      stroke={color}
                      strokeWidth={isSelected ? 2 : 1}
                      opacity={agent.status === 'offline' ? 0.3 : 1}
              />
              {/* Emoji */}
              <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize={agent.id === 'sentinel' ? 16 : 12}
                    style={{ userSelect: 'none' }}>
                {agentEmoji(agent.id)}
              </text>
              {/* Name */}
              <text x={p.x} y={p.y + r + 14} textAnchor="middle"
                    fill={isSelected ? '#00D4FF' : 'rgba(255,255,255,0.7)'}
                    fontSize="9"
                    fontFamily="Space Grotesk"
                    letterSpacing="1"
                    style={{ textTransform: 'uppercase' }}
              >
                {agent.name}
              </text>
              {/* Status dot */}
              <circle cx={p.x + r - 4} cy={p.y - r + 4} r={3.5}
                      fill={statusColor(agent.status)}
                      stroke="#050A14"
                      strokeWidth="1.5"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function AgentDrawer({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const { agents } = useGhostStore();
  const agent = agents[agentId];
  if (!agent) return null;
  const color = agentColor(agentId);
  const meta  = AGENT_META[agentId];
  const [tab, setTab] = useState<'info' | 'events'>('info');

  // Check if bot image exists (fallback to emoji)
  const [hasLogo, setHasLogo] = useState(true);

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0,      opacity: 1 }}
      exit={{  x: '100%',  opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="absolute right-0 top-0 bottom-0 w-96 flex flex-col z-10"
      style={{
        background:  'rgba(5, 10, 20, 0.98)',
        borderLeft:  `1px solid ${color}30`,
        boxShadow:   `-20px 0 60px rgba(0,0,0,0.6)`,
      }}
    >
      {/* Gradient top bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5"
           style={{ background: `linear-gradient(90deg, transparent, ${color}80, transparent)` }} />

      {/* Header */}
      <div className="flex items-center gap-3 p-4 shrink-0" style={{ borderBottom: `1px solid ${color}15` }}>
        <div className="relative w-12 h-12 rounded-2xl overflow-hidden shrink-0"
             style={{ background: `${color}15`, border: `2px solid ${color}40` }}>
          {hasLogo ? (
            <Image
              src={`/bots/${agentId}.png`}
              alt={agent.name}
              width={48}
              height={48}
              style={{ objectFit: 'cover' }}
              onError={() => setHasLogo(false)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl">
              {agentEmoji(agentId)}
            </div>
          )}
          {/* Status dot */}
          <div className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border-2"
               style={{ background: statusColor(agent.status), borderColor: 'rgba(5,10,20,0.98)' }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight" style={{ fontFamily: 'Space Grotesk', color }}>{agent.name}</p>
          <p className="text-[10px] text-ghost-muted truncate">{agent.role}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[9px] capitalize font-mono" style={{ color: statusColor(agent.status) }}>
              ● {agent.status}
            </span>
            {agent.lastSeenAt && (
              <span className="text-[9px] text-ghost-muted/40 font-mono">· {formatRelative(agent.lastSeenAt)}</span>
            )}
          </div>
        </div>

        <button onClick={onClose} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all">
          <X size={14} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {(['info', 'events'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-2.5 text-[10px] font-medium uppercase tracking-wider transition-all ${
                    tab === t ? 'text-white border-b-2' : 'text-ghost-muted/50 hover:text-ghost-muted'
                  }`}
                  style={{ borderBottomColor: tab === t ? color : 'transparent' }}>
            {t === 'info' ? 'Role Info' : 'Live Events'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'info' ? (
          <div className="p-4 space-y-4">
            {/* Description */}
            {meta && (
              <div className="rounded-xl p-3" style={{ background: `${color}08`, border: `1px solid ${color}18` }}>
                <p className="text-[11px] text-ghost-muted leading-relaxed">{meta.desc}</p>
              </div>
            )}

            {/* Model */}
            {meta && (
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-ghost-muted/40 mb-1.5 flex items-center gap-1.5">
                  <Cpu size={9} /> Model
                </p>
                <span className="text-[10px] font-mono text-ghost-accent/80 px-2.5 py-1 rounded-lg"
                      style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.15)' }}>
                  {meta.model}
                </span>
              </div>
            )}

            {/* Reports to / Manages */}
            {meta && (
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-ghost-muted/40 mb-1.5 flex items-center gap-1.5">
                  <GitBranch size={9} /> Hierarchy
                </p>
                <div className="space-y-1.5">
                  {meta.reportsTo ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-ghost-muted/50">Reports to:</span>
                      <span className="text-[10px] font-medium capitalize"
                            style={{ color: agentColor(meta.reportsTo) }}>
                        {meta.reportsTo.charAt(0).toUpperCase() + meta.reportsTo.slice(1)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-ghost-muted/50">Reports to:</span>
                      <span className="text-[10px] font-medium text-ghost-accent">Top-level Orchestrator</span>
                    </div>
                  )}
                  {meta.manages && meta.manages.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] text-ghost-muted/50 shrink-0 mt-0.5">Manages:</span>
                      <div className="flex flex-wrap gap-1">
                        {meta.manages.map(m => (
                          <span key={m} className="text-[9px] px-1.5 py-0.5 rounded font-medium capitalize"
                                style={{ background: `${agentColor(m)}15`, color: agentColor(m) }}>
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Responsibilities */}
            {meta && (
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-ghost-muted/40 mb-1.5 flex items-center gap-1.5">
                  <ChevronRight size={9} /> Responsibilities
                </p>
                <div className="space-y-1">
                  {meta.details.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] text-ghost-muted py-0.5">
                      <span className="mt-1 w-1 h-1 rounded-full shrink-0" style={{ background: color }} />
                      {d}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {meta && meta.tags.length > 0 && (
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-ghost-muted/40 mb-1.5 flex items-center gap-1.5">
                  <Tag size={9} /> Tags
                </p>
                <div className="flex flex-wrap gap-1">
                  {meta.tags.map(t => (
                    <span key={t} className="text-[9px] px-2 py-0.5 rounded-full font-mono"
                          style={{ background: `${color}12`, color: `${color}CC`, border: `1px solid ${color}20` }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-1">Events</p>
                <p className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
                  {agent.events.length}
                </p>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-1">Last Seen</p>
                <p className="text-xs text-white font-mono">
                  {agent.lastSeenAt ? formatRelative(agent.lastSeenAt) : '—'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4">
            {agent.events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-ghost-muted/30">
                <Activity size={24} className="mb-2" />
                <p className="text-xs">No events yet</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {[...agent.events].reverse().slice(0, 30).map((e, i) => (
                  <div key={i} className="text-[11px] p-2.5 rounded-lg"
                       style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span className="text-ghost-muted/40 font-mono text-[9px] mr-2">{formatRelative(e.ts)}</span>
                    <span className="text-ghost-muted">{e.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 flex gap-2 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <button className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all hover:opacity-80"
                style={{ background: `${color}20`, color, border: `1px solid ${color}30` }}>
          <Zap size={12} /> Ping
        </button>
        <button className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all hover:opacity-80"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <MessageSquare size={12} /> Message
        </button>
      </div>
    </motion.div>
  );
}

export default function AgentsPage() {
  const { selectedAgent, selectAgent, agents, messages } = useGhostStore();
  const [filter, setFilter] = useState<'all' | 'online' | 'working' | 'offline'>('all');

  const agentList = Object.values(agents).filter(a => {
    if (filter === 'all')     return true;
    if (filter === 'online')  return a.status === 'online' || a.status === 'working';
    if (filter === 'working') return a.status === 'working';
    if (filter === 'offline') return a.status === 'offline';
    return true;
  });

  return (
    <div className="h-full flex flex-col p-6 gap-5">

      {/* Graph panel */}
      <div className="relative glass rounded-2xl overflow-hidden" style={{ height: '480px' }}>
        <div className="absolute top-0 left-0 right-0 h-0.5"
             style={{ background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.4), transparent)' }} />

        <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
          <div className="w-5 h-5 rounded-lg flex items-center justify-center"
               style={{ background: 'rgba(0,212,255,0.15)', border: '1px solid rgba(0,212,255,0.3)' }}>
            <Activity size={11} className="text-ghost-accent" />
          </div>
          <span className="text-xs font-semibold text-white tracking-wider" style={{ fontFamily: 'Space Grotesk' }}>
            AGENT NETWORK
          </span>
          <span className="text-[10px] text-ghost-muted font-mono">
            {Object.values(agents).filter(a => a.status !== 'offline').length} online
          </span>
        </div>

        <AgentGraph onSelect={selectAgent} />

        <AnimatePresence>
          {selectedAgent && (
            <AgentDrawer agentId={selectedAgent} onClose={() => selectAgent(null)} />
          )}
        </AnimatePresence>
      </div>

      {/* Activity stream */}
      <div className="glass rounded-2xl p-5 flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>
            Agent Activity Stream
          </h3>
          <div className="flex gap-1">
            {(['all', 'online', 'working', 'offline'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-all ${
                  filter === f ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted hover:text-white hover:bg-white/5'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {agentList.length === 0 ? (
            <p className="text-xs text-ghost-muted/40 italic text-center py-8">No agents match filter</p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {agentList.map((agent) => {
                const color = agentColor(agent.id);
                const lastEvent = agent.events[agent.events.length - 1];
                return (
                  <motion.div
                    key={agent.id}
                    whileHover={{ scale: 1.02 }}
                    onClick={() => selectAgent(agent.id)}
                    className="p-3 rounded-xl cursor-pointer transition-all"
                    style={{
                      background:  selectedAgent === agent.id ? `${color}15` : 'rgba(255,255,255,0.03)',
                      border:      `1px solid ${selectedAgent === agent.id ? color + '40' : 'rgba(255,255,255,0.06)'}`,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="relative w-7 h-7 rounded-lg overflow-hidden shrink-0"
                           style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
                        <Image src={`/bots/${agent.id}.png`} alt={agent.name}
                               width={28} height={28} style={{ objectFit: 'cover' }}
                               onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate" style={{ fontFamily: 'Space Grotesk', color }}>
                          {agent.name}
                        </p>
                      </div>
                      <span className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: statusColor(agent.status) }} />
                    </div>
                    <p className="text-[10px] text-ghost-muted truncate mb-1">{agent.role}</p>
                    {lastEvent && (
                      <p className="text-[9px] text-ghost-muted/40 font-mono truncate">{lastEvent.message}</p>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
