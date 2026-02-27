'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGhostStore } from '@/store';
import { statusColor, formatRelative } from '@/lib/utils';
import { Activity, Cpu, GitBranch, Tag, X, Zap, MessageSquare } from 'lucide-react';

// ── Agent colors ──────────────────────────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  ghost:       '#00D4FF',
  switchboard: '#7C3AED',
  warden:      '#EF4444',
  scribe:      '#10B981',
  archivist:   '#F59E0B',
  scout:       '#60A5FA',
  forge:       '#FB923C',
  courier:     '#A78BFA',
  lens:        '#34D399',
  keeper:      '#38BDF8',
  sentinel:    '#E879F9',
  crow:        '#94A3B8',
  operator:    '#FCD34D',
  helm:        '#6EE7B7',
  codex:       '#FCA5A5',
};
const agentColor = (id: string) => AGENT_COLORS[id] ?? '#64748B';

// ── Tier definitions ──────────────────────────────────────────────────────────
const TIERS = [
  { label: 'COMMANDER', desc: 'Primary intelligence',    agents: ['ghost'] },
  { label: 'DIRECTORS', desc: 'Control & coordination', agents: ['switchboard', 'warden', 'scribe', 'archivist'] },
  { label: 'WORKERS',   desc: 'Specialized execution',  agents: ['scout', 'forge', 'courier', 'lens', 'keeper', 'sentinel', 'crow', 'operator', 'helm', 'codex'] },
];

// ── Agent metadata ────────────────────────────────────────────────────────────
const AGENT_META: Record<string, {
  name: string; role: string; desc: string; model: string;
  reportsTo: string | null; manages?: string[]; tags: string[]; details: string[];
}> = {
  ghost: {
    name: 'Ghost', role: 'Terminal AI / CEO',
    desc: 'The primary AI interface. Ghost handles all terminal conversations with persistent memory across sessions. Backed by Claude Opus 4.6 for highest-capability reasoning and escalation authority over all agents.',
    model: 'Claude Opus 4.6', reportsTo: null,
    manages: ['switchboard', 'warden', 'scribe', 'archivist'],
    tags: ['CEO', 'Memory', 'Opus', 'Terminal'],
    details: ['Primary user-facing AI (portal terminal)', 'Full conversation memory via Keeper threads', 'Long-term recall via Pinecone (Archivist)', 'Escalation target for all agents', 'Powered by Claude Opus 4.6'],
  },
  switchboard: {
    name: 'Switchboard', role: 'Router / Classifier',
    desc: 'Intent classifier and message router. Every portal message flows through Switchboard, which uses keyword matching to route to the correct agent instantly.',
    model: 'Keyword → gpt-4o-mini', reportsTo: 'ghost',
    tags: ['Router', 'Classifier', 'Instant'],
    details: ['Keyword pattern matching — zero latency for common intents', 'Routes to: Codex, Scout, Courier, Ghost', 'gpt-4o-mini fallback for unmatched messages', 'Always-on, processes every message'],
  },
  warden: {
    name: 'Warden', role: 'Command & Control',
    desc: 'Manages approval workflows for dangerous operations. Nothing dangerous runs without Warden sign-off.',
    model: 'gpt-4o-mini', reportsTo: 'ghost',
    tags: ['Security', 'Approvals', 'Control'],
    details: ['Approval gate for dangerous operations', 'Manages OWNER/ADMIN permission checks', 'Audit trail for all approved actions', 'Discord approval request routing'],
  },
  scribe: {
    name: 'Scribe', role: 'Ops / Summaries',
    desc: 'Operations agent. Scribe handles scheduled summaries, daily briefs, and reminders. The portal Daily Brief comes from Scribe.',
    model: 'gpt-4o-mini', reportsTo: 'ghost',
    tags: ['Reports', 'Reminders', 'Daily Brief'],
    details: ['Generates daily operational brief for portal overview', 'Scheduled summary generation', 'Stores structured notes in memory', 'Handles reminder and scheduling requests'],
  },
  archivist: {
    name: 'Archivist', role: 'Long-term Memory',
    desc: 'Long-term memory agent. Archivist embeds and retrieves information from Pinecone for long-term recall across sessions.',
    model: 'Pinecone + nomic-embed-text', reportsTo: 'ghost',
    tags: ['Memory', 'Pinecone', 'Semantic Search'],
    details: ['Semantic storage and retrieval via Pinecone', 'Embeds content with nomic-embed-text (768-dim)', 'TTL-managed entries (90-180 day default)', 'Recalls relevant context for Keeper threads'],
  },
  scout: {
    name: 'Scout', role: 'Intelligence / Research',
    desc: 'Intelligence agent. Scout handles real-time web research, trend analysis, and competitive intelligence using Grok\'s live reasoning.',
    model: 'Grok / gpt-4o-mini-search', reportsTo: 'ghost',
    tags: ['Research', 'Web', 'Real-time'],
    details: ['Real-time web search and fact-finding', 'Trend and competitive analysis via Grok', 'Live news and score queries via GPT-4o search', 'Stores research summaries to Archivist'],
  },
  forge: {
    name: 'Forge', role: 'Dev / Architect',
    desc: 'Dev & architecture agent. Forge handles coding requests, system design, and debugging. Escalates to Claude Sonnet for complex work.',
    model: 'gpt-4o-mini → Sonnet', reportsTo: 'ghost',
    tags: ['Code', 'DevOps', 'Architect'],
    details: ['Code generation and debugging', 'System architecture decisions', 'Escalates complex tasks to Claude Sonnet', 'Coordinates with Helm for deployments'],
  },
  courier: {
    name: 'Courier', role: 'Email / Comms',
    desc: 'Email specialist. Courier drafts and sends all outbound emails via Resend. Requires approval for bulk sends.',
    model: 'gpt-4o-mini + Resend', reportsTo: 'ghost',
    tags: ['Email', 'Resend', 'Comms'],
    details: ['Drafts professional emails', 'Sends via Resend API', 'Requires Warden approval for mass sends', 'Handles follow-up scheduling'],
  },
  lens: {
    name: 'Lens', role: 'Analytics',
    desc: 'Analytics agent. Lens tracks and reports on PostHog analytics — page views, retention, funnel performance, and usage patterns.',
    model: 'gpt-4o-mini', reportsTo: 'ghost',
    tags: ['PostHog', 'Analytics', 'Metrics'],
    details: ['PostHog event and funnel analysis', 'Usage pattern reporting', 'Retention and engagement metrics', 'Custom analytics queries'],
  },
  keeper: {
    name: 'Keeper', role: 'Conversation Memory',
    desc: 'Conversation memory agent. Keeper manages per-thread conversation history in JSON files, with rolling summaries pushed to Pinecone.',
    model: 'gpt-4o-mini (summarization)', reportsTo: 'ghost',
    tags: ['Threads', 'Memory', 'JSON'],
    details: ['Persists conversation history to memory/conversations/', 'Rolling summarization at 80 messages', 'Pushes summaries to Archivist (Pinecone)', 'Per-thread isolation (portal, discord, global)'],
  },
  sentinel: {
    name: 'Sentinel', role: 'Discord Connector',
    desc: 'Discord connector. Sentinel monitors the guild, handles slash commands, routes messages to the Ghost pipeline, and manages bot presence.',
    model: '— (connector)', reportsTo: 'ghost',
    tags: ['Discord', 'Bot', 'Connector'],
    details: ['discord.js bot event handler', 'Routes #reception messages to Switchboard', 'Slash command registration and handling', 'Guild-isolated (DISCORD_GUILD_ID only)'],
  },
  crow: {
    name: 'Crow', role: 'Social Media / X',
    desc: 'Social media agent. Crow manages X/Twitter activity — drafting posts, scheduling content, and monitoring social media trends.',
    model: 'gpt-4o-mini', reportsTo: 'ghost',
    tags: ['Twitter', 'Social', 'X'],
    details: ['X/Twitter post drafting and scheduling', 'Social media content strategy', 'Brand voice management', 'Coordinates with Scout for trend data'],
  },
  operator: {
    name: 'Operator', role: 'Task Decomposition',
    desc: 'Task decomposition agent. Operator breaks complex requests into sub-tasks and orchestrates multi-agent workflows.',
    model: 'gpt-4o-mini', reportsTo: 'ghost',
    tags: ['Orchestration', 'Tasks', 'Decomposition'],
    details: ['Decomposes complex requests into steps', 'Multi-agent workflow orchestration', 'Task assignment and progress tracking', 'Coordinates between specialized agents'],
  },
  helm: {
    name: 'Helm', role: 'SRE / Deploy',
    desc: 'SRE / Deploy agent. Helm monitors system health, manages PM2 processes, handles deployments, and triggers alerts when things go wrong.',
    model: 'gpt-4o-mini', reportsTo: 'ghost',
    tags: ['Deploy', 'SRE', 'Monitor'],
    details: ['PM2 process monitoring and restart', 'Deployment pipeline management', 'System health alerts', 'Coordinates with Forge on deployments'],
  },
  codex: {
    name: 'Codex', role: 'League Knowledge',
    desc: 'League knowledge agent. Codex answers questions about HOF League — rules, rosters, standings, registration — from official league files.',
    model: 'gpt-4o-mini + file reads', reportsTo: 'ghost',
    tags: ['HOF', 'League', 'Knowledge'],
    details: ['Reads HOF League official files', 'Answers rules, roster, and registration questions', 'Season structure and playoff info', 'File-grounded answers — no hallucination'],
  },
};

// ── Shared avatar component ───────────────────────────────────────────────────
function AgentAvatar({ agentId, size = 48 }: { agentId: string; size?: number }) {
  const color = agentColor(agentId);
  const meta  = AGENT_META[agentId];
  const [imgOk, setImgOk] = useState(true);

  return (
    <div className="relative shrink-0 flex items-center justify-center rounded-xl overflow-hidden"
         style={{ width: size, height: size, background: `${color}15`, border: `1.5px solid ${color}30`, flexShrink: 0 }}>
      {imgOk && (
        <img src={`/bots/${agentId}.png`} alt={meta?.name ?? agentId}
             width={size} height={size}
             style={{ objectFit: 'cover', width: '100%', height: '100%', position: 'absolute', inset: 0 }}
             onError={() => setImgOk(false)} />
      )}
      <span className="relative z-10 font-black select-none"
            style={{ color, fontFamily: 'Space Grotesk', fontSize: size * 0.38, opacity: imgOk ? 0 : 1 }}>
        {meta?.name.charAt(0)}
      </span>
    </div>
  );
}


/* ================================================================================
 *  CommanderCard — Ghost hero card (full width)
 * ================================================================================ */
function CommanderCard({
  agentId, isSelected, onSelect, liveStatus,
}: { agentId: string; isSelected: boolean; onSelect: (id: string) => void; liveStatus: string }) {
  const color     = agentColor(agentId);
  const meta      = AGENT_META[agentId];
  const isWorking = liveStatus === 'working';
  const isOnline  = liveStatus === 'online' || isWorking;
  if (!meta) return null;

  return (
    <motion.div
      whileHover={{ scale: 1.004 }}
      whileTap={{ scale: 0.998 }}
      onClick={() => onSelect(agentId)}
      className="cursor-pointer rounded-2xl relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${color}08 0%, rgba(5,10,20,0.9) 55%, rgba(5,10,20,0.6) 100%)`,
        border:     isSelected ? `1px solid ${color}50` : `1px solid ${color}18`,
        boxShadow:  isSelected ? `0 0 50px ${color}18` : `0 4px 24px rgba(0,0,0,0.4)`,
      }}
    >
      {/* Ambient corner glow */}
      <div className="pointer-events-none absolute -top-16 -left-16 w-48 h-48 rounded-full blur-3xl"
           style={{ background: color, opacity: 0.06 }} />
      <div className="pointer-events-none absolute top-0 right-0 h-px w-64"
           style={{ background: `linear-gradient(90deg, transparent, ${color}50)` }} />
      <div className="pointer-events-none absolute top-0 left-0 w-px h-20"
           style={{ background: `linear-gradient(180deg, ${color}40, transparent)` }} />

      <div className="flex items-start gap-6 p-6">
        {/* Avatar with pulse ring */}
        <div className="relative shrink-0">
          {isOnline && (
            <motion.div className="absolute -inset-2 rounded-2xl"
              style={{ border: `1.5px solid ${color}`, borderRadius: 20 }}
              animate={{ opacity: [0.2, 0.6, 0.2], scale: [1, 1.05, 1] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }} />
          )}
          <AgentAvatar agentId={agentId} size={80} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Name + status row */}
          <div className="flex items-start justify-between gap-4 mb-1">
            <div>
              <p className="text-2xl font-black leading-none tracking-wide"
                 style={{ fontFamily: 'Space Grotesk', color: isSelected ? color : '#FFFFFF' }}>
                {meta.name}
              </p>
              <p className="text-sm mt-1" style={{ color: `${color}80` }}>{meta.role}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 mt-0.5">
              <motion.span className="w-2 h-2 rounded-full"
                style={{ background: statusColor(liveStatus) }}
                animate={isWorking ? { opacity: [1, 0.2, 1] } : {}}
                transition={isWorking ? { duration: 0.9, repeat: Infinity } : {}} />
              <span className="text-xs font-semibold capitalize tracking-wide"
                    style={{ color: statusColor(liveStatus) }}>
                {liveStatus}
              </span>
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-ghost-muted/60 leading-relaxed mt-2 mb-4 max-w-2xl">
            {meta.desc}
          </p>

          {/* Bottom row: model + tags */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg flex items-center gap-1.5"
                  style={{ background: `${color}12`, color: `${color}CC`, border: `1px solid ${color}22` }}>
              <Cpu size={10} /> {meta.model}
            </span>
            {meta.tags.map(t => (
              <span key={t} className="text-[10px] px-2 py-0.5 rounded-full font-medium tracking-wide"
                    style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.07)' }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}


/* ================================================================================
 *  DirectorCard — medium card with color top accent
 * ================================================================================ */
function DirectorCard({
  agentId, isSelected, onSelect, liveStatus,
}: { agentId: string; isSelected: boolean; onSelect: (id: string) => void; liveStatus: string }) {
  const color     = agentColor(agentId);
  const meta      = AGENT_META[agentId];
  const isWorking = liveStatus === 'working';
  if (!meta) return null;

  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onSelect(agentId)}
      className="cursor-pointer rounded-xl overflow-hidden flex flex-col"
      style={{
        background: isSelected ? `${color}0E` : 'rgba(255,255,255,0.025)',
        border:     isSelected ? `1px solid ${color}45` : '1px solid rgba(255,255,255,0.06)',
        boxShadow:  isSelected ? `0 0 28px ${color}18, 0 4px 16px rgba(0,0,0,0.3)` : '0 2px 12px rgba(0,0,0,0.2)',
        transition: 'box-shadow 0.2s',
      }}
    >
      {/* Color top bar */}
      <div className="h-1 w-full shrink-0"
           style={{ background: `linear-gradient(90deg, ${color}, ${color}30, transparent)` }} />

      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Avatar + status */}
        <div className="flex items-center justify-between">
          <div className="relative">
            {isWorking && (
              <motion.div className="absolute -inset-1.5 rounded-xl"
                style={{ border: `1px solid ${color}70` }}
                animate={{ opacity: [0.4, 0.9, 0.4] }}
                transition={{ duration: 1.2, repeat: Infinity }} />
            )}
            <AgentAvatar agentId={agentId} size={42} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: statusColor(liveStatus) }} />
            <span className="text-[10px] font-mono capitalize" style={{ color: statusColor(liveStatus) }}>
              {liveStatus}
            </span>
          </div>
        </div>

        {/* Name + role */}
        <div>
          <p className="text-sm font-bold leading-tight"
             style={{ fontFamily: 'Space Grotesk', color: isSelected ? color : 'white' }}>
            {meta.name}
          </p>
          <p className="text-[11px] text-ghost-muted/50 mt-0.5 truncate">{meta.role}</p>
        </div>

        {/* Desc snippet */}
        <p className="text-[10px] text-ghost-muted/40 leading-relaxed line-clamp-2 flex-1">
          {meta.desc}
        </p>

        {/* Model chip */}
        <span className="text-[10px] font-mono px-2 py-1 rounded-lg truncate"
              style={{ background: `${color}08`, color: `${color}80`, border: `1px solid ${color}12` }}>
          {meta.model}
        </span>
      </div>
    </motion.div>
  );
}


/* ================================================================================
 *  WorkerCard — compact horizontal card
 * ================================================================================ */
function WorkerCard({
  agentId, isSelected, onSelect, liveStatus,
}: { agentId: string; isSelected: boolean; onSelect: (id: string) => void; liveStatus: string }) {
  const color     = agentColor(agentId);
  const meta      = AGENT_META[agentId];
  const isWorking = liveStatus === 'working';
  if (!meta) return null;

  return (
    <motion.div
      whileHover={{ x: 3 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(agentId)}
      className="cursor-pointer rounded-xl p-3 flex items-center gap-3 relative overflow-hidden"
      style={{
        background:  isSelected ? `${color}0C` : 'rgba(255,255,255,0.02)',
        border:      `1px solid ${isSelected ? `${color}35` : 'rgba(255,255,255,0.05)'}`,
        borderLeft:  `2.5px solid ${isSelected ? color : `${color}50`}`,
        boxShadow:   isSelected ? `0 0 16px ${color}12` : 'none',
      }}
    >
      {/* Ambient bg on selected */}
      {isSelected && (
        <div className="pointer-events-none absolute inset-0 opacity-30"
             style={{ background: `radial-gradient(ellipse at left, ${color}15, transparent 70%)` }} />
      )}

      <AgentAvatar agentId={agentId} size={32} />

      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold leading-none truncate"
           style={{ fontFamily: 'Space Grotesk', color: isSelected ? color : 'rgba(255,255,255,0.9)' }}>
          {meta.name}
        </p>
        <p className="text-[10px] text-ghost-muted/40 mt-0.5 truncate">{meta.role}</p>
      </div>

      <motion.span className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: statusColor(liveStatus) }}
        animate={isWorking ? { opacity: [1, 0.2, 1] } : {}}
        transition={isWorking ? { duration: 0.8, repeat: Infinity } : {}} />
    </motion.div>
  );
}


/* ================================================================================
 *  AgentDrawer — right-side detail panel
 * ================================================================================ */
function AgentDrawer({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const { agents, setAgentStatus, pushAgentEvent } = useGhostStore();
  const liveAgent = agents[agentId];
  const color     = agentColor(agentId);
  const meta      = AGENT_META[agentId];
  const [tab, setTab]       = useState<'info' | 'events'>('info');
  const [pinging, setPinging] = useState(false);
  if (!meta) return null;

  const liveStatus = liveAgent?.status ?? 'idle';
  const events     = liveAgent?.events ?? [];

  const handlePing = () => {
    if (pinging) return;
    setPinging(true);
    setAgentStatus(agentId, 'working');
    pushAgentEvent(agentId, '🔔 Ping received — responding...', 'info');
    setTimeout(() => {
      pushAgentEvent(agentId, '✅ Ping acknowledged', 'success');
      setAgentStatus(agentId, 'online');
      setPinging(false);
    }, 1500);
  };

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="absolute right-0 top-0 bottom-0 w-[400px] flex flex-col z-10"
      style={{
        background: 'rgba(4, 8, 18, 0.97)',
        borderLeft: `1px solid ${color}25`,
        boxShadow: `-32px 0 80px rgba(0,0,0,0.8), inset 1px 0 0 ${color}10`,
      }}
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-px"
           style={{ background: `linear-gradient(90deg, transparent, ${color}70, transparent)` }} />
      {/* Ambient corner */}
      <div className="pointer-events-none absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl"
           style={{ background: color, opacity: 0.04 }} />

      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-4 shrink-0" style={{ borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
        <div className="relative">
          <AgentAvatar agentId={agentId} size={52} />
          <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2"
               style={{ background: statusColor(liveStatus), borderColor: 'rgba(4,8,18,0.97)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-black leading-tight" style={{ fontFamily: 'Space Grotesk', color }}>{meta.name}</p>
          <p className="text-xs text-ghost-muted/60 truncate">{meta.role}</p>
        </div>
        <button onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-ghost-muted/50 hover:text-white hover:bg-white/10 transition-all shrink-0">
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {(['info', 'events'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-all ${
                    tab === t ? 'text-white' : 'text-ghost-muted/30 hover:text-ghost-muted/60'
                  }`}
                  style={{ borderBottom: `2px solid ${tab === t ? color : 'transparent'}` }}>
            {t === 'info' ? 'Role Info' : 'Live Events'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {tab === 'info' ? (
          <div className="p-5 space-y-5">
            <div className="rounded-xl p-4" style={{ background: `${color}07`, border: `1px solid ${color}12` }}>
              <p className="text-xs text-ghost-muted/70 leading-relaxed">{meta.desc}</p>
            </div>

            {/* Model */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ghost-muted/30 mb-2 flex items-center gap-1.5">
                <Cpu size={10} /> Model
              </p>
              <span className="text-[11px] font-mono px-3 py-1.5 rounded-lg inline-block"
                    style={{ background: 'rgba(0,212,255,0.07)', color: 'rgba(0,212,255,0.85)', border: '1px solid rgba(0,212,255,0.12)' }}>
                {meta.model}
              </span>
            </div>

            {/* Hierarchy */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ghost-muted/30 mb-2 flex items-center gap-1.5">
                <GitBranch size={10} /> Hierarchy
              </p>
              <div className="space-y-1.5 text-xs">
                {meta.reportsTo ? (
                  <p className="text-ghost-muted/50">Reports to: <span className="font-semibold" style={{ color: agentColor(meta.reportsTo) }}>{AGENT_META[meta.reportsTo]?.name ?? meta.reportsTo}</span></p>
                ) : (
                  <p className="text-ghost-muted/50">Reports to: <span className="font-semibold text-ghost-accent">Top-level</span></p>
                )}
                {meta.manages && (
                  <div className="flex items-center gap-1.5 flex-wrap mt-1">
                    <span className="text-ghost-muted/40">Manages:</span>
                    {meta.manages.map(m => (
                      <span key={m} className="px-2 py-0.5 rounded text-[10px] font-medium"
                            style={{ background: `${agentColor(m)}15`, color: agentColor(m) }}>
                        {AGENT_META[m]?.name ?? m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Details */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ghost-muted/30 mb-2">Responsibilities</p>
              <div className="space-y-1.5">
                {meta.details.map((d, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs text-ghost-muted/60">
                    <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ background: color }} />
                    {d}
                  </div>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ghost-muted/30 mb-2 flex items-center gap-1.5">
                <Tag size={10} /> Tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {meta.tags.map(t => (
                  <span key={t} className="text-[10px] px-2.5 py-0.5 rounded-full font-mono"
                        style={{ background: `${color}0E`, color: `${color}AA`, border: `1px solid ${color}15` }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Events', value: events.length },
                { label: 'Last seen', value: liveAgent?.lastSeenAt ? formatRelative(liveAgent.lastSeenAt) : '—' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <p className="text-[10px] text-ghost-muted/30 uppercase tracking-wider mb-1">{label}</p>
                  <p className="text-sm font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-5">
            {events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-ghost-muted/20">
                <Activity size={28} className="mb-3" />
                <p className="text-xs">No events yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {[...events].reverse().slice(0, 30).map((e, i) => (
                  <div key={i} className="p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <p className="text-[10px] text-ghost-muted/30 font-mono mb-0.5">{formatRelative(e.ts)}</p>
                    <p className="text-xs text-ghost-muted/70">{e.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 flex gap-2 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <button onClick={handlePing} disabled={pinging}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all hover:opacity-80 disabled:opacity-40"
                style={{ background: `${color}15`, color, border: `1px solid ${color}25` }}>
          <Zap size={13} /> {pinging ? 'Pinging…' : 'Ping'}
        </button>
        <button className="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all hover:opacity-80"
                style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <MessageSquare size={13} /> Message
        </button>
      </div>
    </motion.div>
  );
}


/* ================================================================================
 *  TierDivider
 * ================================================================================ */
function TierDivider({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.10))' }} />
      <div className="flex items-center gap-2 px-3 py-1 rounded-full shrink-0"
           style={{ background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.08)' }}>
        <span className="text-[9px] font-black tracking-[0.25em] text-ghost-accent/60 uppercase">{label}</span>
        <span className="text-[9px] text-ghost-muted/25">·</span>
        <span className="text-[9px] text-ghost-muted/25 tracking-wide">{desc}</span>
      </div>
      <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, rgba(0,212,255,0.10), transparent)' }} />
    </div>
  );
}


/* ================================================================================
 *  Page
 * ================================================================================ */
export default function AgentsPage() {
  const { agents, selectedAgent, selectAgent } = useGhostStore();

  const vals     = Object.values(agents);
  const online   = vals.filter(a => a.status === 'online').length;
  const working  = vals.filter(a => a.status === 'working').length;
  const idle     = vals.filter(a => a.status === 'idle').length;

  const handleSelect = (id: string) => selectAgent(id === selectedAgent ? null : id);

  return (
    <div className="p-6 flex flex-col gap-5">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
               style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.15)' }}>
            <Activity size={15} className="text-ghost-accent" />
          </div>
          <div>
            <h1 className="text-base font-black tracking-wider text-white" style={{ fontFamily: 'Space Grotesk' }}>
              AGENT NETWORK
            </h1>
            <p className="text-[11px] text-ghost-muted/40">15 agents · 3-tier hierarchy</p>
          </div>
        </div>

        {/* Live counts */}
        <div className="flex items-center gap-4">
          {[
            { color: '#10B981', count: online,  label: 'online'  },
            { color: '#F59E0B', count: working, label: 'working' },
            { color: '#475569', count: idle,    label: 'idle'    },
          ].map(({ color, count, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
              <span className="text-xs text-ghost-muted/60">
                <span className="text-white font-semibold">{count}</span> {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Main panel with tiers + drawer */}
      <div className="relative">
        <div className="glass rounded-2xl p-6 flex flex-col gap-6">

          {/* ── COMMANDER ── */}
          <div className="flex flex-col gap-3">
            <TierDivider label="COMMANDER" desc="Primary intelligence" />
            <CommanderCard
              agentId="ghost"
              isSelected={selectedAgent === 'ghost'}
              onSelect={handleSelect}
              liveStatus={agents['ghost']?.status ?? 'idle'}
            />
          </div>

          {/* ── DIRECTORS ── */}
          <div className="flex flex-col gap-3">
            <TierDivider label="DIRECTORS" desc="Control & coordination" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {['switchboard', 'warden', 'scribe', 'archivist'].map(id => (
                <DirectorCard key={id} agentId={id}
                  isSelected={selectedAgent === id}
                  onSelect={handleSelect}
                  liveStatus={agents[id]?.status ?? 'idle'} />
              ))}
            </div>
          </div>

          {/* ── WORKERS ── */}
          <div className="flex flex-col gap-3">
            <TierDivider label="WORKERS" desc="Specialized execution" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {['scout', 'forge', 'courier', 'lens', 'keeper', 'sentinel', 'crow', 'operator', 'helm', 'codex'].map(id => (
                <WorkerCard key={id} agentId={id}
                  isSelected={selectedAgent === id}
                  onSelect={handleSelect}
                  liveStatus={agents[id]?.status ?? 'idle'} />
              ))}
            </div>
          </div>

        </div>

        {/* Drawer */}
        <AnimatePresence>
          {selectedAgent && AGENT_META[selectedAgent] && (
            <AgentDrawer key={selectedAgent} agentId={selectedAgent} onClose={() => selectAgent(null)} />
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
