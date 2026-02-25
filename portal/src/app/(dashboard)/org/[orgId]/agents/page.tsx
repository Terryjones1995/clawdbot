'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGhostStore } from '@/store';
import { statusColor, formatRelative } from '@/lib/utils';
import { X, Activity, Zap, MessageSquare, ChevronRight, GitBranch, Cpu, Tag } from 'lucide-react';

// ── Agent colors (local, matches the new hierarchy) ─────────────────────────
function agentColor(id: string): string {
  const colors: Record<string, string> = {
    ghost:   '#00D4FF',
    oracle:  '#7C3AED',
    nexus:   '#00BFA5',
    viper:   '#EF4444',
    atlas:   '#10B981',
    pulse:   '#F59E0B',
    scout:   '#60A5FA',
    courier: '#A78BFA',
  };
  return colors[id] ?? '#64748B';
}

function agentEmoji(id: string): string {
  const emojis: Record<string, string> = {
    ghost:   '\u{1F451}',
    oracle:  '\u{1F441}\uFE0F',
    nexus:   '\u{1F500}',
    viper:   '\u26A1',
    atlas:   '\u{1F6E1}\uFE0F',
    pulse:   '\u{1F4C8}',
    scout:   '\u{1F3AF}',
    courier: '\u2709\uFE0F',
  };
  return emojis[id] ?? '\u{1F916}';
}

// ── Agent metadata — descriptions, model, responsibilities, reporting ─────────
const AGENT_META: Record<string, {
  desc:        string;
  model:       string;
  reportsTo:   string | null;
  manages?:    string[];
  tags:        string[];
  details:     string[];
}> = {
  ghost: {
    desc:      'The CEO and brain of the entire Ghost OS. Ghost handles the highest-level decisions, strategic thinking, and any request that requires deep reasoning. Everything escalates to Ghost ultimately.',
    model:     'Claude Opus 4.6',
    reportsTo: null,
    manages:   ['oracle'],
    tags:      ['CEO', 'Brain', 'Strategy', 'Opus'],
    details:   [
      'Ultimate decision authority across all departments',
      'Handles complex multi-step reasoning tasks',
      'Escalation target for all other agents',
      'Powered by Claude Opus 4.6 \u2014 highest capability',
      'Strategic planning and system architecture',
    ],
  },
  oracle: {
    desc:      'Operations Manager. Oracle coordinates across all departments, manages workflow, and serves as the bridge between Ghost\'s strategy and day-to-day execution.',
    model:     'Claude Sonnet 4.6',
    reportsTo: 'ghost',
    manages:   ['nexus', 'viper', 'atlas', 'pulse', 'scout', 'courier'],
    tags:      ['Operations', 'Sonnet', 'Coordination'],
    details:   [
      'Orchestrates multi-department workflows',
      'Manages department head assignments',
      'Monitors system performance and escalates issues',
      'Powered by Claude Sonnet 4.6',
    ],
  },
  nexus: {
    desc:      'The reception desk. Every message enters through Nexus, which instantly classifies the intent via keyword matching and routes to the correct department in milliseconds.',
    model:     'Keyword-first \u2192 Claude Haiku',
    reportsTo: 'oracle',
    tags:      ['Reception', 'Router', 'Instant', 'Haiku'],
    details:   [
      'Keyword pattern matching \u2014 zero latency for 80% of requests',
      'Claude Haiku fallback for unmatched messages (1-2s)',
      'Routes to: Viper, Atlas, Pulse, Scout, Courier',
      'Always-on, processes every incoming message',
    ],
  },
  viper: {
    desc:      'Social Media Head. Viper manages all X/Twitter activity, Discord social interactions, and social content strategy. Fast, sharp, on-brand.',
    model:     'GPT-4o',
    reportsTo: 'oracle',
    tags:      ['Social Media', 'X/Twitter', 'Discord', 'GPT-4o'],
    details:   [
      'Drafts and schedules X/Twitter posts',
      'Manages Discord social channels',
      'Social media content strategy',
      'Brand voice and engagement management',
    ],
  },
  atlas: {
    desc:      'Support Head. Atlas handles all customer support requests, Discord help channels, and issue resolution. Empathetic, fast, reliable.',
    model:     'Claude Haiku',
    reportsTo: 'oracle',
    tags:      ['Support', 'Discord', 'Customer', 'Haiku'],
    details:   [
      'Handles Discord support channel messages',
      'Resolves customer issues and inquiries',
      'Escalates complex issues to Oracle or Ghost',
      'Maintains support ticket awareness',
    ],
  },
  pulse: {
    desc:      'Marketing Head. Pulse drives campaigns, content creation, and marketing strategy. Data-driven, creative, results-focused.',
    model:     'GPT-4o',
    reportsTo: 'oracle',
    tags:      ['Marketing', 'Campaigns', 'Content', 'GPT-4o'],
    details:   [
      'Develops marketing campaigns and copy',
      'Content strategy for all channels',
      'Analyzes performance and optimizes messaging',
      'Coordinates with Viper for social distribution',
    ],
  },
  scout: {
    desc:      'Intelligence head. Scout provides real-time research, league data, web search, and competitive intelligence using Grok\'s live reasoning.',
    model:     'Grok grok-4-1-fast-reasoning',
    reportsTo: 'oracle',
    tags:      ['Research', 'League', 'Real-time', 'Grok'],
    details:   [
      'Real-time web search and fact-finding',
      'League data, scores, and standings',
      'Competitive intelligence and trend analysis',
      'Powered by Grok for live reasoning',
    ],
  },
  courier: {
    desc:      'Email specialist. Courier drafts and sends all outbound emails via Resend with professional tone and formatting. Every email reviewed before sending.',
    model:     'Claude Haiku + Resend',
    reportsTo: 'oracle',
    tags:      ['Email', 'Resend', 'Comms', 'Haiku'],
    details:   [
      'Drafts professional emails via Claude Haiku',
      'Sends via Resend API',
      'Requires approval for mass email sends',
      'Handles scheduling and follow-ups',
    ],
  },
};

// Agent layout positions for the graph (normalized 0-1)
const AGENT_POSITIONS: Record<string, { x: number; y: number; layer: number }> = {
  ghost:   { x: 0.5,   y: 0.12, layer: 0 }, // CEO -- top center
  oracle:  { x: 0.5,   y: 0.35, layer: 1 }, // Ops -- second row
  nexus:   { x: 0.15,  y: 0.60, layer: 2 }, // Reception
  viper:   { x: 0.35,  y: 0.60, layer: 2 }, // Social
  atlas:   { x: 0.55,  y: 0.60, layer: 2 }, // Support
  pulse:   { x: 0.73,  y: 0.60, layer: 2 }, // Marketing
  scout:   { x: 0.32,  y: 0.85, layer: 3 }, // Research
  courier: { x: 0.68,  y: 0.85, layer: 3 }, // Email
};

// Ghost -> Oracle -> Department heads -> Workers
const EDGES: [string, string, string?][] = [
  ['ghost',  'oracle',  'commands'],
  ['oracle', 'nexus',   'routes via'],
  ['oracle', 'viper',   'social'],
  ['oracle', 'atlas',   'support'],
  ['oracle', 'pulse',   'marketing'],
  ['scout',  'oracle',  'intel to'],
  ['courier','oracle',  'reports to'],
];

function nodeR(id: string): number {
  if (id === 'ghost') return 80;
  if (id === 'oracle') return 65;
  if (id === 'scout' || id === 'courier') return 48;
  return 52; // nexus, viper, atlas, pulse
}

/* ================================================================================
 *  AgentGraph -- SVG network visualization
 * ================================================================================ */
function AgentGraph({ onSelect }: { onSelect: (id: string) => void }) {
  const { agents, messages, selectedAgent } = useGhostStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 1100, h: 800 });

  useEffect(() => {
    function update() {
      if (svgRef.current) {
        const r = svgRef.current.getBoundingClientRect();
        setDims({ w: r.width || 1100, h: r.height || 800 });
      }
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Compute pixel positions
  const pos = useCallback((id: string) => {
    const p = AGENT_POSITIONS[id] ?? { x: 0.5, y: 0.5 };
    return { x: p.x * dims.w, y: p.y * dims.h };
  }, [dims]);

  // Determine which agents are currently "working" (for red reverse beams)
  const workingAgents = useMemo(() => {
    const set = new Set<string>();
    Object.values(agents).forEach(a => {
      if (a.status === 'working') set.add(a.id);
    });
    return set;
  }, [agents]);

  // Recent messages for beam highlighting (last 5s)
  const recentMessages = useMemo(() => {
    const now = Date.now();
    return messages.filter(m => now - new Date(m.ts).getTime() < 5000);
  }, [messages]);

  // Red reverse: 'to' agent is working → beams flow back toward parent
  const hasReverseBeam = useCallback((from: string, to: string) => {
    if (workingAgents.has(to)) return true;
    return recentMessages.some(m => m.fromAgentId === to && m.toAgentId === from);
  }, [workingAgents, recentMessages]);

  // Red forward: 'from' agent is working → beams radiate outward from it
  const hasForwardWorkingBeam = useCallback((from: string) => {
    return workingAgents.has(from);
  }, [workingAgents]);

  // Check if edge has recent forward message
  const hasForwardBeam = useCallback((from: string, to: string) => {
    return recentMessages.some(m => m.fromAgentId === from && m.toAgentId === to);
  }, [recentMessages]);

  // Separator line Y positions (between layers)
  const sep1Y = dims.h * 0.24;
  const sep2Y = dims.h * 0.48;
  const sep3Y = dims.h * 0.73;

  return (
    <div className="relative w-full h-full">
      <svg ref={svgRef} width="100%" height="100%">
        <defs>
          {/* Glow filters */}
          <filter id="edge-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="red-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Circular clip paths for each agent image */}
          {Object.keys(AGENT_POSITIONS).map(id => {
            const r = nodeR(id);
            const p = pos(id);
            return (
              <clipPath key={`clip-${id}`} id={`clip-${id}`}>
                <circle cx={p.x} cy={p.y} r={r} />
              </clipPath>
            );
          })}
        </defs>

        {/* Subtle horizontal separator lines between layers */}
        <line x1={dims.w * 0.05} y1={sep1Y} x2={dims.w * 0.95} y2={sep1Y}
          stroke="rgba(0,212,255,0.06)" strokeWidth="1" strokeDasharray="6 4" />
        <line x1={dims.w * 0.05} y1={sep2Y} x2={dims.w * 0.95} y2={sep2Y}
          stroke="rgba(0,212,255,0.06)" strokeWidth="1" strokeDasharray="6 4" />
        <line x1={dims.w * 0.05} y1={sep3Y} x2={dims.w * 0.95} y2={sep3Y}
          stroke="rgba(0,212,255,0.06)" strokeWidth="1" strokeDasharray="6 4" />

        {/* -- Edges with bidirectional beam animations -- */}
        {EDGES.map(([from, to, label]) => {
          const a = pos(from), b = pos(to);
          const rFrom = nodeR(from), rTo = nodeR(to);
          const isSelected = selectedAgent === from || selectedAgent === to;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          // Shorten line to start/end at node edges
          const sx = a.x + (dx / dist) * (rFrom + 4);
          const sy = a.y + (dy / dist) * (rFrom + 4);
          const ex = b.x - (dx / dist) * (rTo + 4);
          const ey = b.y - (dy / dist) * (rTo + 4);
          const fwdPathId = `fwd-${from}-${to}`;
          const revPathId = `rev-${from}-${to}`;
          const edgeDur = `${(dist / (dims.w * 0.4) * 2 + 1.5).toFixed(1)}s`;
          const showReverse = hasReverseBeam(from, to);
          const showForwardRed = hasForwardWorkingBeam(from);
          const showForwardHighlight = showForwardRed || hasForwardBeam(from, to);
          const anyRed = showReverse || showForwardRed;
          const bright = isSelected || showForwardHighlight || showReverse;

          return (
            <g key={`${from}-${to}`}>
              {/* Forward path */}
              <path id={fwdPathId} d={`M ${sx} ${sy} L ${ex} ${ey}`} fill="none" />
              {/* Reverse path */}
              <path id={revPathId} d={`M ${ex} ${ey} L ${sx} ${sy}`} fill="none" />

              {/* Base glow line — red tint when any agent on this edge is working */}
              <line x1={sx} y1={sy} x2={ex} y2={ey}
                stroke={anyRed ? 'rgba(239,68,68,0.30)' : bright ? 'rgba(0,212,255,0.30)' : 'rgba(0,212,255,0.10)'}
                strokeWidth={bright || anyRed ? 2 : 1}
                filter="url(#edge-glow)"
              />

              {/* Forward orbs — RED when 'from' agent is working, cyan otherwise */}
              {[0, 0.33, 0.66].map((offset, i) => (
                <circle key={`fwd-${i}`}
                  r={bright ? 4 : 2.5}
                  fill={showForwardRed ? '#EF4444' : bright ? '#00D4FF' : 'rgba(0,212,255,0.5)'}
                  opacity={bright ? 0.9 : 0.35}
                  filter={showForwardRed ? 'url(#red-glow)' : 'url(#edge-glow)'}
                >
                  <animateMotion
                    dur={edgeDur}
                    repeatCount="indefinite"
                    begin={`${offset * parseFloat(edgeDur)}s`}
                  >
                    <mpath href={`#${fwdPathId}`} />
                  </animateMotion>
                </circle>
              ))}

              {/* RED reverse orbs — 'to' agent is working, responding back up */}
              {showReverse && [0, 0.33, 0.66].map((offset, i) => (
                <circle key={`rev-${i}`}
                  r={4}
                  fill="#EF4444"
                  opacity={0.9}
                  filter="url(#red-glow)"
                >
                  <animateMotion
                    dur={edgeDur}
                    repeatCount="indefinite"
                    begin={`${offset * parseFloat(edgeDur)}s`}
                  >
                    <mpath href={`#${revPathId}`} />
                  </animateMotion>
                </circle>
              ))}

              {/* Edge label on hover/select */}
              {isSelected && label && (
                <text x={(sx + ex) / 2} y={(sy + ey) / 2 - 8} textAnchor="middle"
                  fill="rgba(0,212,255,0.6)" fontSize="9" fontFamily="JetBrains Mono" letterSpacing="0.5">
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* -- Agent nodes -- */}
        {Object.keys(AGENT_POSITIONS).map((id) => {
          const agent = agents[id];
          if (!agent) return null;
          const p = pos(id);
          const color = agentColor(id);
          const r = nodeR(id);
          const isSelected = selectedAgent === id;
          const isWorking = agent.status === 'working';

          return (
            <g key={id} style={{ cursor: 'pointer' }} onClick={() => onSelect(id)}>
              {/* Outer pulse ring for working agents */}
              {isWorking && (
                <circle cx={p.x} cy={p.y} r={r + 12} fill="none" stroke={color}
                  strokeWidth="2" opacity="0.5">
                  <animate attributeName="r" values={`${r + 10};${r + 22};${r + 10}`} dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Selected ring */}
              {isSelected && (
                <circle cx={p.x} cy={p.y} r={r + 8} fill="none"
                  stroke="#00D4FF" strokeWidth="2.5" opacity="0.7"
                  filter="url(#node-glow)"
                />
              )}

              {/* Node background circle */}
              <circle cx={p.x} cy={p.y} r={r}
                fill={`${color}20`}
                stroke={color}
                strokeWidth={isSelected ? 3 : 2}
                opacity={agent.status === 'offline' ? 0.35 : 1}
                filter={isSelected ? 'url(#node-glow)' : undefined}
              />

              {/* Bot SVG image */}
              <image
                href={`/bots/${id}.svg`}
                x={p.x - r}
                y={p.y - r}
                width={r * 2}
                height={r * 2}
                clipPath={`url(#clip-${id})`}
                preserveAspectRatio="xMidYMid slice"
                opacity={agent.status === 'offline' ? 0.35 : 1}
              />

              {/* Agent name label -- positioned below node */}
              <text x={p.x} y={p.y + r + 20} textAnchor="middle"
                fill={isSelected ? '#00D4FF' : 'rgba(255,255,255,0.8)'}
                fontSize={id === 'ghost' ? '14' : '12'}
                fontWeight="600"
                fontFamily="Space Grotesk"
                letterSpacing="1.5"
                style={{ textTransform: 'uppercase' } as React.CSSProperties}
                filter={isSelected ? 'url(#edge-glow)' : undefined}
              >
                {agent.name}
              </text>

              {/* Status dot -- top right of node */}
              <circle cx={p.x + r - 6} cy={p.y - r + 6} r={6}
                fill={statusColor(agent.status)}
                stroke="#050A14"
                strokeWidth="2"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}


/* ================================================================================
 *  AgentDrawer -- Right panel with agent details
 * ================================================================================ */
function AgentDrawer({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const { agents, setAgentStatus, pushAgentEvent, pushMessage } = useGhostStore();
  const agent = agents[agentId];
  if (!agent) return null;
  const color = agentColor(agentId);
  const meta  = AGENT_META[agentId];
  const [tab, setTab] = useState<'info' | 'events'>('info');
  const [pinging, setPinging] = useState(false);

  const handlePing = useCallback(() => {
    if (pinging) return;
    setPinging(true);

    // 1. Set the whole chain working: ghost → oracle → target
    //    This lights up red beams on EVERY edge in the chain
    setAgentStatus('ghost', 'working');
    setAgentStatus('oracle', 'working');
    setAgentStatus(agentId, 'working');
    pushAgentEvent(agentId, '🔔 Ping received — responding...', 'info');

    // 2. Outbound beam ghost → oracle → agent
    pushMessage({ id: Date.now().toString(),       fromAgentId: 'ghost',   toAgentId: 'oracle', content: 'ping', ts: new Date().toISOString() });
    pushMessage({ id: (Date.now()+1).toString(),   fromAgentId: 'oracle',  toAgentId: agentId,  content: 'ping', ts: new Date().toISOString() });

    // 3. After 1.5s, return beam agent → oracle → ghost (all edges light up red)
    setTimeout(() => {
      pushMessage({ id: (Date.now()+2).toString(), fromAgentId: agentId,  toAgentId: 'oracle', content: 'pong', ts: new Date().toISOString() });
      pushMessage({ id: (Date.now()+3).toString(), fromAgentId: 'oracle', toAgentId: 'ghost',  content: 'pong', ts: new Date().toISOString() });
      pushAgentEvent(agentId, '✅ Ping acknowledged', 'success');
    }, 1500);

    // 4. After 3s, restore entire chain and unlock
    setTimeout(() => {
      setAgentStatus('ghost', 'online');
      setAgentStatus('oracle', 'online');
      setAgentStatus(agentId, 'online');
      setPinging(false);
    }, 3000);
  }, [agentId, pinging, setAgentStatus, pushAgentEvent, pushMessage]);

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="absolute right-0 top-0 bottom-0 w-[480px] flex flex-col z-10"
      style={{
        background: 'rgba(5, 10, 20, 0.98)',
        borderLeft: `1px solid ${color}30`,
        boxShadow: '-24px 0 80px rgba(0,0,0,0.7)',
      }}
    >
      {/* Gradient top bar */}
      <div className="absolute top-0 left-0 right-0 h-1"
           style={{ background: `linear-gradient(90deg, transparent, ${color}90, transparent)` }} />

      {/* -- Header -- */}
      <div className="flex items-center gap-4 p-6 shrink-0" style={{ borderBottom: `1px solid ${color}15` }}>
        <div className="relative w-20 h-20 rounded-2xl overflow-hidden shrink-0"
             style={{ background: `${color}15`, border: `2px solid ${color}40` }}>
          <img
            src={`/bots/${agentId}.svg`}
            alt={agent.name}
            width={80}
            height={80}
            style={{ objectFit: 'cover', width: '100%', height: '100%' }}
          />
          {/* Status dot */}
          <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full border-2"
               style={{ background: statusColor(agent.status), borderColor: 'rgba(5,10,20,0.98)' }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-2xl font-bold leading-tight" style={{ fontFamily: 'Space Grotesk', color }}>{agent.name}</p>
          <p className="text-sm text-ghost-muted mt-0.5">{agent.role}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs capitalize font-mono flex items-center gap-1.5" style={{ color: statusColor(agent.status) }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: statusColor(agent.status) }} />
              {agent.status}
            </span>
            {agent.lastSeenAt && (
              <span className="text-xs text-ghost-muted/50 font-mono">&middot; {formatRelative(agent.lastSeenAt)}</span>
            )}
          </div>
        </div>

        <button onClick={onClose} className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl text-ghost-muted hover:text-white hover:bg-white/10 transition-all">
          <X size={18} />
        </button>
      </div>

      {/* -- Tab bar -- */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {(['info', 'events'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-all ${
                    tab === t ? 'text-white border-b-2' : 'text-ghost-muted/50 hover:text-ghost-muted'
                  }`}
                  style={{ borderBottomColor: tab === t ? color : 'transparent' }}>
            {t === 'info' ? 'Role Info' : 'Live Events'}
          </button>
        ))}
      </div>

      {/* -- Content -- */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {tab === 'info' ? (
          <div className="p-6 space-y-6">
            {/* Description */}
            {meta && (
              <div className="rounded-xl p-5" style={{ background: `${color}08`, border: `1px solid ${color}18` }}>
                <p className="text-sm text-ghost-muted leading-relaxed">{meta.desc}</p>
              </div>
            )}

            {/* Model */}
            {meta && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-ghost-muted/50 mb-2 flex items-center gap-2">
                  <Cpu size={12} /> Model
                </p>
                <span className="text-sm font-mono text-ghost-accent/90 px-3 py-1.5 rounded-lg inline-block"
                      style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.15)' }}>
                  {meta.model}
                </span>
              </div>
            )}

            {/* Hierarchy */}
            {meta && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-ghost-muted/50 mb-2 flex items-center gap-2">
                  <GitBranch size={12} /> Hierarchy
                </p>
                <div className="space-y-2">
                  {meta.reportsTo ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ghost-muted/60">Reports to:</span>
                      <span className="text-sm font-medium capitalize"
                            style={{ color: agentColor(meta.reportsTo) }}>
                        {meta.reportsTo.charAt(0).toUpperCase() + meta.reportsTo.slice(1)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ghost-muted/60">Reports to:</span>
                      <span className="text-sm font-medium text-ghost-accent">Top-level CEO</span>
                    </div>
                  )}
                  {meta.manages && meta.manages.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-sm text-ghost-muted/60 shrink-0 mt-0.5">Manages:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {meta.manages.map(m => (
                          <span key={m} className="text-xs px-2 py-0.5 rounded font-medium capitalize"
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
                <p className="text-xs font-semibold uppercase tracking-widest text-ghost-muted/50 mb-2 flex items-center gap-2">
                  <ChevronRight size={12} /> Responsibilities
                </p>
                <div className="space-y-1.5">
                  {meta.details.map((d, i) => (
                    <div key={i} className="flex items-start gap-3 text-sm text-ghost-muted py-1">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      {d}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {meta && meta.tags.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-ghost-muted/50 mb-2 flex items-center gap-2">
                  <Tag size={12} /> Tags
                </p>
                <div className="flex flex-wrap gap-2">
                  {meta.tags.map(t => (
                    <span key={t} className="text-xs px-3 py-1 rounded-full font-mono"
                          style={{ background: `${color}12`, color: `${color}CC`, border: `1px solid ${color}20` }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-xs text-ghost-muted/50 uppercase tracking-wider mb-1">Events</p>
                <p className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
                  {agent.events.length}
                </p>
              </div>
              <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-xs text-ghost-muted/50 uppercase tracking-wider mb-1">Last Seen</p>
                <p className="text-sm text-white font-mono mt-1">
                  {agent.lastSeenAt ? formatRelative(agent.lastSeenAt) : '\u2014'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6">
            {agent.events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-ghost-muted/30">
                <Activity size={32} className="mb-3" />
                <p className="text-sm">No events yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {[...agent.events].reverse().slice(0, 30).map((e, i) => (
                  <div key={i} className="p-3 rounded-xl"
                       style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className="text-ghost-muted/50 font-mono text-xs mr-3">{formatRelative(e.ts)}</span>
                    <span className="text-sm text-ghost-muted">{e.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* -- Actions -- */}
      <div className="p-5 flex gap-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={handlePing}
          disabled={pinging}
          className="flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-80 disabled:opacity-50"
          style={{ background: `${color}20`, color, border: `1px solid ${color}30` }}
        >
          <Zap size={16} /> {pinging ? 'Pinging...' : 'Ping'}
        </button>
        <button className="flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-80"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <MessageSquare size={16} /> Message
        </button>
      </div>
    </motion.div>
  );
}


/* ================================================================================
 *  Activity Stream -- Agent roster / team directory
 * ================================================================================ */
function ActivityStream({
  agents,
  filter,
  selectedAgent,
  onSelect,
}: {
  agents: Record<string, { id: string; name: string; role: string; status: string; lastSeenAt: string | null; events: { ts: string; message: string; type: string }[] }>;
  filter: string;
  selectedAgent: string | null;
  onSelect: (id: string) => void;
}) {
  const agentList = Object.values(agents).filter(a => {
    if (filter === 'all') return true;
    if (filter === 'online') return a.status === 'online' || a.status === 'working';
    if (filter === 'working') return a.status === 'working';
    if (filter === 'offline') return a.status === 'offline';
    return true;
  });

  if (agentList.length === 0) {
    return (
      <p className="text-sm text-ghost-muted/40 italic text-center py-12">No agents match filter</p>
    );
  }

  return (
    <div className="space-y-1">
      {agentList.map((agent) => {
        const color = agentColor(agent.id);
        const lastEvent = agent.events[agent.events.length - 1];
        const isSelected = selectedAgent === agent.id;

        return (
          <div
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className="flex items-center gap-4 px-4 py-3 rounded-xl cursor-pointer transition-all hover:bg-white/[0.03]"
            style={{
              background: isSelected ? `${color}10` : 'transparent',
              border: isSelected ? `1px solid ${color}30` : '1px solid transparent',
            }}
          >
            {/* Bot SVG image */}
            <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0"
                 style={{ background: `${color}12`, border: `1px solid ${color}25` }}>
              <img
                src={`/bots/${agent.id}.svg`}
                alt={agent.name}
                width={56}
                height={56}
                style={{ objectFit: 'cover', width: '100%', height: '100%' }}
              />
            </div>

            {/* Name + role */}
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-white truncate" style={{ fontFamily: 'Space Grotesk' }}>
                {agent.name}
              </p>
              <p className="text-sm text-ghost-muted/70 truncate">{agent.role}</p>
            </div>

            {/* Last event */}
            <div className="hidden md:block flex-1 min-w-0 max-w-xs">
              {lastEvent ? (
                <p className="text-sm text-ghost-muted/50 truncate">{lastEvent.message}</p>
              ) : (
                <p className="text-sm text-ghost-muted/20 italic">No activity</p>
              )}
            </div>

            {/* Last seen */}
            <div className="hidden lg:block w-24 text-right">
              <p className="text-xs text-ghost-muted/40 font-mono">
                {agent.lastSeenAt ? formatRelative(agent.lastSeenAt) : '\u2014'}
              </p>
            </div>

            {/* Status badge */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: statusColor(agent.status) }} />
              <span className="text-xs font-mono capitalize text-ghost-muted/60 hidden sm:inline">{agent.status}</span>
            </div>

            {/* Chevron */}
            <ChevronRight size={16} className="text-ghost-muted/20 shrink-0" />
          </div>
        );
      })}
    </div>
  );
}


/* ================================================================================
 *  Page -- Main layout
 * ================================================================================ */
export default function AgentsPage() {
  const { selectedAgent, selectAgent, agents, messages } = useGhostStore();
  const [filter, setFilter] = useState<'all' | 'online' | 'working' | 'offline'>('all');

  return (
    <div className="p-6 flex flex-col gap-6" style={{ zoom: '0.8' }}>

      {/* -- Graph panel -- */}
      <div className="relative glass rounded-2xl overflow-hidden" style={{ height: '800px' }}>
        <div className="absolute top-0 left-0 right-0 h-[2px]"
             style={{ background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.5), transparent)' }} />

        {/* Header badge -- top left */}
        <div className="absolute top-5 left-5 z-10 flex items-center gap-3">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center"
               style={{ background: 'rgba(0,212,255,0.15)', border: '1px solid rgba(0,212,255,0.3)' }}>
            <Activity size={13} className="text-ghost-accent" />
          </div>
          <span className="text-sm font-bold text-white tracking-wider" style={{ fontFamily: 'Space Grotesk' }}>
            AGENT NETWORK
          </span>
          <span className="text-xs text-ghost-muted font-mono ml-1">
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

      {/* -- Activity stream -- */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
            Agent Roster
          </h3>
          <div className="flex gap-1">
            {(['all', 'online', 'working', 'offline'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                  filter === f ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted hover:text-white hover:bg-white/5'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <ActivityStream
          agents={agents}
          filter={filter}
          selectedAgent={selectedAgent}
          onSelect={selectAgent}
        />
      </div>
    </div>
  );
}
