'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGhostStore } from '@/store';
import { statusColor, formatRelative } from '@/lib/utils';
import {
  Activity, Cpu, GitBranch, Tag, X, Zap, MessageSquare,
  Search, AlertTriangle, CheckCircle2, Clock, BarChart3,
  TrendingUp, Shield, RefreshCw,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────
interface AgentStats {
  agent:        string;
  total_calls:  number;
  total_errors: number;
  calls_today:  number;
  errors_today: number;
  successes:    number;
  last_active:  string | null;
}

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
  helm:        '#6EE7B7',
};
const agentColor = (id: string) => AGENT_COLORS[id] ?? '#64748B';

// ── Tier definitions ──────────────────────────────────────────────────────────
const TIERS = [
  { label: 'COMMANDER', desc: 'Primary intelligence',    agents: ['ghost'] },
  { label: 'DIRECTORS', desc: 'Control & coordination', agents: ['switchboard', 'warden', 'scribe', 'archivist'] },
  { label: 'WORKERS',   desc: 'Specialized execution',  agents: ['scout', 'forge', 'courier', 'lens', 'keeper', 'sentinel', 'helm'] },
];

// ── Agent metadata ────────────────────────────────────────────────────────────
const AGENT_META: Record<string, {
  name: string; role: string; desc: string; model: string;
  reportsTo: string | null; manages?: string[]; tags: string[]; details: string[];
}> = {
  ghost: {
    name: 'Ghost', role: 'Terminal AI / CEO',
    desc: 'The primary AI interface. Ghost routes through Ollama (free, local) by default and escalates to paid models when needed. Persistent memory across sessions via Keeper + Archivist.',
    model: 'Ollama → DeepSeek → Claude', reportsTo: null,
    manages: ['switchboard', 'warden', 'scribe', 'archivist'],
    tags: ['CEO', 'Memory', 'Free-first', 'Terminal'],
    details: ['Primary user-facing AI (portal terminal)', 'Default: Ollama qwen2.5:14b (free, local)', 'Mid-tier: DeepSeek V3.2 (cheap, agent-optimized)', 'Escalation: Claude claude-sonnet-4-6 (paid)', 'Full conversation memory via Keeper threads'],
  },
  switchboard: {
    name: 'Switchboard', role: 'Router / Classifier',
    desc: 'Intent classifier and message router. Every message flows through Switchboard, which uses keyword matching first, then Ollama for ambiguous intents.',
    model: 'Keyword → Ollama qwen2.5:14b', reportsTo: 'ghost',
    tags: ['Router', 'Classifier', 'Instant'],
    details: ['Keyword pattern matching — zero latency for common intents', 'Routes to: Scout, Courier, Ghost', 'Ollama qwen2.5:14b fallback for unmatched messages', 'Always-on, processes every message'],
  },
  warden: {
    name: 'Warden', role: 'Command & Control',
    desc: 'Manages approval workflows for dangerous operations. Nothing dangerous runs without Warden sign-off. Redis-backed approval queue.',
    model: 'None (logic only)', reportsTo: 'ghost',
    tags: ['Security', 'Approvals', 'Control'],
    details: ['Approval gate for dangerous operations', 'OWNER/ADMIN permission checks', 'Redis hash queue (warden:approvals)', 'Discord approval request routing'],
  },
  scribe: {
    name: 'Scribe', role: 'Ops / Summaries',
    desc: 'Operations agent. Scribe handles scheduled summaries, daily briefs, and reminders. Uses Ollama for text generation.',
    model: 'Ollama qwen2.5:14b', reportsTo: 'ghost',
    tags: ['Reports', 'Reminders', 'Daily Brief'],
    details: ['Generates daily operational brief for portal', 'Scheduled summary generation via Ollama', 'Stores structured notes in memory', 'Handles reminder and scheduling requests'],
  },
  archivist: {
    name: 'Archivist', role: 'Long-term Memory',
    desc: 'Long-term memory agent. Archivist embeds and retrieves information using pgvector for semantic search across sessions.',
    model: 'Ollama nomic-embed-text', reportsTo: 'ghost',
    tags: ['Memory', 'pgvector', 'Semantic Search'],
    details: ['Semantic storage and retrieval via pgvector (Neon)', 'Embeds content with nomic-embed-text (768-dim)', 'Conflict resolution for duplicate facts', 'User profile auto-merging from extracted facts'],
  },
  scout: {
    name: 'Scout', role: 'Intelligence / Research',
    desc: 'Intelligence agent. Scout handles real-time web research, trend analysis, and competitive intelligence. Multi-model routing: Grok for trends, OpenAI for live data, Claude for deep synthesis.',
    model: 'DeepSeek / Grok / OpenAI / Claude', reportsTo: 'ghost',
    tags: ['Research', 'Web', 'Multi-model'],
    details: ['Factual/competitive queries via DeepSeek V3.2 (cheap)', 'Trend and competitive analysis via Grok grok-4-1-fast-reasoning', 'Live news and scores via gpt-4o-mini-search-preview', 'Deep synthesis escalation to Claude claude-sonnet-4-6', 'Stores research facts to Archivist (pgvector)'],
  },
  forge: {
    name: 'Forge', role: 'Dev / Auto-fix',
    desc: 'Code repair agent. Forge auto-fixes runtime errors using gpt-5.3-codex or Claude CLI. Reads error logs, generates patches, validates JS, and restarts services.',
    model: 'gpt-5.3-codex / Claude CLI', reportsTo: 'ghost',
    tags: ['Code', 'Auto-fix', 'Codex'],
    details: ['Auto-fix via gpt-5.3-codex (Responses API)', 'Claude CLI fallback for complex fixes', 'File-change detection + JS validation', '10-min cooldown per unique error signature'],
  },
  courier: {
    name: 'Courier', role: 'Email / Comms',
    desc: 'Email specialist. Courier drafts and sends all outbound emails via Resend. Uses Ollama for drafting, requires Warden approval for bulk sends.',
    model: 'Ollama qwen2.5:14b + Resend', reportsTo: 'ghost',
    tags: ['Email', 'Resend', 'Comms'],
    details: ['Drafts professional emails via Ollama', 'Sends via Resend API', 'Requires Warden approval for mass sends', 'Handles follow-up scheduling'],
  },
  lens: {
    name: 'Lens', role: 'Analytics',
    desc: 'Analytics agent. Lens tracks PostHog analytics — page views, retention, funnel performance, and usage patterns. System alerts monitoring.',
    model: 'None (PostHog API)', reportsTo: 'ghost',
    tags: ['PostHog', 'Analytics', 'Metrics'],
    details: ['PostHog event and funnel analysis', 'System alerts and health monitoring', 'Retention and engagement metrics', 'Custom analytics queries'],
  },
  keeper: {
    name: 'Keeper', role: 'Conversation Memory',
    desc: 'Conversation persistence agent. Keeper manages per-thread conversation history in Neon DB with Redis write-through caching.',
    model: 'Ollama → DeepSeek (fallback)', reportsTo: 'ghost',
    tags: ['Threads', 'Memory', 'Neon DB'],
    details: ['Persists conversations to Neon PostgreSQL', 'Redis write-through cache (24h TTL)', 'Ollama → DeepSeek V3.2 → gpt-4o-mini fallback chain', 'Per-thread isolation (portal, discord, global)'],
  },
  sentinel: {
    name: 'Sentinel', role: 'Discord Connector',
    desc: 'Discord connector. Sentinel monitors all guilds, handles @Ghost mentions, routes messages to the Ghost pipeline, and manages bot presence.',
    model: 'None (connector)', reportsTo: 'ghost',
    tags: ['Discord', 'Bot', 'Multi-guild'],
    details: ['discord.js bot event handler', 'Routes #reception messages to Switchboard', 'Responds only to direct @Ghost mentions', 'Multi-guild aware, rate-limited (5 per 5s)'],
  },
  helm: {
    name: 'Helm', role: 'SRE / Deploy',
    desc: 'SRE / Deploy agent. Helm monitors system health, manages PM2 processes, handles deployments, and triggers alerts when things go wrong.',
    model: 'None (system tooling)', reportsTo: 'ghost',
    tags: ['Deploy', 'SRE', 'PM2'],
    details: ['PM2 process monitoring and restart', 'System health checks (Redis, DB, Ollama)', 'Deployment pipeline management', 'Coordinates with Forge on auto-fixes'],
  },
};

// ── Shared avatar component ───────────────────────────────────────────────────
function AgentAvatar({ agentId, size = 48 }: { agentId: string; size?: number }) {
  const color = agentColor(agentId);
  const meta  = AGENT_META[agentId];
  const [svgOk, setSvgOk] = useState(true);

  const iconSize = Math.round(size * 0.55);

  return (
    <div className="relative shrink-0 flex items-center justify-center rounded-xl overflow-hidden"
         style={{
           width: size, height: size,
           background: `${color}15`,
           border: `1.5px solid ${color}30`,
           flexShrink: 0,
           boxShadow: `0 0 12px ${color}08`,
         }}>
      {svgOk ? (
        <img src={`/bots/${agentId}.svg`} alt={meta?.name ?? agentId}
             width={iconSize} height={iconSize}
             style={{ filter: `drop-shadow(0 0 4px ${color}40)` }}
             onError={() => setSvgOk(false)} />
      ) : (
        <span className="font-black select-none"
              style={{ color, fontFamily: 'Space Grotesk', fontSize: size * 0.38 }}>
          {meta?.name.charAt(0)}
        </span>
      )}
    </div>
  );
}

// ── Stat helpers ──────────────────────────────────────────────────────────────
function MiniStat({ icon: Icon, value, label, color }: {
  icon: any; value: string | number; label: string; color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={10} style={{ color }} className="shrink-0" />
      <span className="text-[10px] font-mono text-white/80">{value}</span>
      <span className="text-[9px] text-ghost-muted/50 hidden sm:inline">{label}</span>
    </div>
  );
}

function SuccessBar({ rate, color }: { rate: number; color: string }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${rate}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[9px] font-mono shrink-0" style={{ color }}>{rate}%</span>
    </div>
  );
}

/* ================================================================================
 *  CommanderCard — Ghost hero card (full width)
 * ================================================================================ */
function CommanderCard({
  agentId, isSelected, onSelect, liveStatus, stats,
}: {
  agentId: string; isSelected: boolean; onSelect: (id: string) => void;
  liveStatus: string; stats?: AgentStats;
}) {
  const color     = agentColor(agentId);
  const meta      = AGENT_META[agentId];
  const isWorking = liveStatus === 'working';
  const isOnline  = liveStatus === 'online' || isWorking;
  if (!meta) return null;

  const successRate = stats && stats.total_calls > 0
    ? Math.round((stats.successes / stats.total_calls) * 100)
    : null;

  return (
    <motion.div
      whileHover={{ scale: 1.004 }}
      whileTap={{ scale: 0.998 }}
      onClick={() => onSelect(agentId)}
      className="cursor-pointer rounded-2xl relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${color}0C 0%, rgba(5,10,20,0.9) 45%, ${color}06 100%)`,
        border:     isSelected ? `1px solid ${color}50` : `1px solid ${color}20`,
        boxShadow:  isSelected ? `0 0 60px ${color}20, 0 4px 30px rgba(0,0,0,0.5)` : `0 4px 24px rgba(0,0,0,0.4)`,
      }}
    >
      {/* Animated gradient top border */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-[2px]"
           style={{ background: `linear-gradient(90deg, transparent, ${color}70, ${color}30, transparent)` }} />
      {/* Ambient corner glow */}
      <div className="pointer-events-none absolute -top-16 -left-16 w-56 h-56 rounded-full blur-3xl"
           style={{ background: color, opacity: 0.07 }} />
      <div className="pointer-events-none absolute -bottom-20 -right-20 w-40 h-40 rounded-full blur-3xl"
           style={{ background: color, opacity: 0.04 }} />

      <div className="flex items-start gap-3 sm:gap-6 p-4 sm:p-6">
        {/* Avatar with pulse ring */}
        <div className="relative shrink-0">
          {isOnline && (
            <motion.div className="absolute -inset-2 rounded-2xl"
              style={{ border: `1.5px solid ${color}`, borderRadius: 20 }}
              animate={{ opacity: [0.2, 0.6, 0.2], scale: [1, 1.05, 1] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }} />
          )}
          <div className="block sm:hidden"><AgentAvatar agentId={agentId} size={52} /></div>
          <div className="hidden sm:block"><AgentAvatar agentId={agentId} size={80} /></div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Name + status row */}
          <div className="flex items-start justify-between gap-2 sm:gap-4 mb-1">
            <div>
              <p className="text-lg sm:text-2xl font-black leading-none tracking-wide"
                 style={{ fontFamily: 'Space Grotesk', color: isSelected ? color : '#FFFFFF' }}>
                {meta.name}
              </p>
              <p className="text-xs sm:text-sm mt-1" style={{ color: `${color}80` }}>{meta.role}</p>
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
          <p className="text-xs sm:text-sm text-ghost-muted/60 leading-relaxed mt-2 mb-3 sm:mb-4 max-w-2xl line-clamp-2 sm:line-clamp-none">
            {meta.desc}
          </p>

          {/* Stats row */}
          {stats && (
            <div className="flex items-center gap-3 sm:gap-5 mb-3 flex-wrap">
              <MiniStat icon={BarChart3} value={stats.calls_today} label="today" color={color} />
              <MiniStat icon={TrendingUp} value={stats.total_calls.toLocaleString()} label="total" color="#10B981" />
              {stats.errors_today > 0 && (
                <MiniStat icon={AlertTriangle} value={stats.errors_today} label="errors" color="#EF4444" />
              )}
              {successRate !== null && (
                <div className="hidden sm:flex items-center gap-2 flex-1 max-w-48">
                  <span className="text-[9px] text-ghost-muted/50">success</span>
                  <SuccessBar rate={successRate} color={successRate >= 90 ? '#10B981' : successRate >= 70 ? '#F59E0B' : '#EF4444'} />
                </div>
              )}
            </div>
          )}

          {/* Bottom row: model + tags */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] sm:text-[11px] font-mono px-2 sm:px-2.5 py-1 rounded-lg flex items-center gap-1.5"
                  style={{ background: `${color}12`, color: `${color}CC`, border: `1px solid ${color}22` }}>
              <Cpu size={10} /> {meta.model}
            </span>
            {meta.tags.map(t => (
              <span key={t} className="hidden sm:inline text-[10px] px-2 py-0.5 rounded-full font-medium tracking-wide"
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
 *  DirectorCard — medium card with color top accent + stats
 * ================================================================================ */
function DirectorCard({
  agentId, isSelected, onSelect, liveStatus, stats,
}: {
  agentId: string; isSelected: boolean; onSelect: (id: string) => void;
  liveStatus: string; stats?: AgentStats;
}) {
  const color     = agentColor(agentId);
  const meta      = AGENT_META[agentId];
  const isWorking = liveStatus === 'working';
  if (!meta) return null;

  const successRate = stats && stats.total_calls > 0
    ? Math.round((stats.successes / stats.total_calls) * 100) : null;

  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onSelect(agentId)}
      className="cursor-pointer rounded-xl overflow-hidden flex flex-col group/dir"
      style={{
        background: isSelected ? `${color}0E` : 'rgba(255,255,255,0.025)',
        border:     isSelected ? `1px solid ${color}45` : '1px solid rgba(255,255,255,0.06)',
        boxShadow:  isSelected ? `0 0 32px ${color}1A, 0 4px 16px rgba(0,0,0,0.3)` : '0 2px 12px rgba(0,0,0,0.2)',
        transition: 'box-shadow 0.25s, background 0.25s',
      }}
    >
      {/* Color top bar */}
      <div className="h-1 w-full shrink-0"
           style={{ background: `linear-gradient(90deg, ${color}, ${color}30, transparent)` }} />
      {/* Hover gradient overlay */}
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover/dir:opacity-100 transition-opacity duration-300"
           style={{ background: `linear-gradient(135deg, ${color}08 0%, transparent 50%)` }} />

      <div className="p-3 sm:p-4 flex flex-col gap-2.5 flex-1">
        {/* Avatar + status */}
        <div className="flex items-center justify-between">
          <div className="relative">
            {isWorking && (
              <motion.div className="absolute -inset-1.5 rounded-xl"
                style={{ border: `1px solid ${color}70` }}
                animate={{ opacity: [0.4, 0.9, 0.4] }}
                transition={{ duration: 1.2, repeat: Infinity }} />
            )}
            <AgentAvatar agentId={agentId} size={38} />
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
          <p className="text-[10px] sm:text-[11px] text-ghost-muted/50 mt-0.5 truncate">{meta.role}</p>
        </div>

        {/* Live stats */}
        {stats && (
          <div className="flex items-center gap-3 text-[9px] font-mono">
            <span className="flex items-center gap-1" style={{ color }}>
              <BarChart3 size={9} /> {stats.calls_today}
            </span>
            {stats.errors_today > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <AlertTriangle size={9} /> {stats.errors_today}
              </span>
            )}
            <span className="text-ghost-muted/50 ml-auto">
              {stats.total_calls.toLocaleString()}
            </span>
          </div>
        )}

        {/* Success bar */}
        {successRate !== null && (
          <SuccessBar rate={successRate} color={successRate >= 90 ? '#10B981' : successRate >= 70 ? '#F59E0B' : '#EF4444'} />
        )}

        {/* Model chip */}
        <span className="text-[9px] sm:text-[10px] font-mono px-2 py-1 rounded-lg truncate mt-auto"
              style={{ background: `${color}08`, color: `${color}80`, border: `1px solid ${color}12` }}>
          {meta.model}
        </span>
      </div>
    </motion.div>
  );
}


/* ================================================================================
 *  WorkerCard — compact horizontal card + stats
 * ================================================================================ */
function WorkerCard({
  agentId, isSelected, onSelect, liveStatus, stats,
}: {
  agentId: string; isSelected: boolean; onSelect: (id: string) => void;
  liveStatus: string; stats?: AgentStats;
}) {
  const color     = agentColor(agentId);
  const meta      = AGENT_META[agentId];
  const isWorking = liveStatus === 'working';
  if (!meta) return null;

  return (
    <motion.div
      whileHover={{ x: 3 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(agentId)}
      className="cursor-pointer rounded-xl p-2.5 sm:p-3 flex items-center gap-2.5 sm:gap-3 relative overflow-hidden group/worker"
      style={{
        background:  isSelected ? `${color}0C` : 'rgba(255,255,255,0.02)',
        border:      `1px solid ${isSelected ? `${color}35` : 'rgba(255,255,255,0.05)'}`,
        borderLeft:  `2.5px solid ${isSelected ? color : `${color}50`}`,
        boxShadow:   isSelected ? `0 0 16px ${color}12` : 'none',
        transition:  'background 0.2s, box-shadow 0.2s',
      }}
    >
      {/* Ambient bg on selected + hover */}
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${isSelected ? 'opacity-30' : 'opacity-0 group-hover/worker:opacity-20'}`}
           style={{ background: `radial-gradient(ellipse at left, ${color}15, transparent 70%)` }} />

      <AgentAvatar agentId={agentId} size={32} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold leading-none truncate"
             style={{ fontFamily: 'Space Grotesk', color: isSelected ? color : 'rgba(255,255,255,0.9)' }}>
            {meta.name}
          </p>
          {stats && stats.calls_today > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: `${color}10`, color: `${color}AA` }}>
              {stats.calls_today}
            </span>
          )}
        </div>
        <p className="text-[10px] text-ghost-muted/40 mt-0.5 truncate">{meta.role}</p>
      </div>

      {/* Error indicator */}
      {stats && stats.errors_today > 0 && (
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 text-red-400"
              style={{ background: 'rgba(239,68,68,0.1)' }}>
          {stats.errors_today}
        </span>
      )}

      <motion.span className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: statusColor(liveStatus) }}
        animate={isWorking ? { opacity: [1, 0.2, 1] } : {}}
        transition={isWorking ? { duration: 0.8, repeat: Infinity } : {}} />
    </motion.div>
  );
}


/* ================================================================================
 *  AgentDrawer — right-side detail panel with 3 tabs
 * ================================================================================ */
function AgentDrawer({ agentId, stats, onClose }: {
  agentId: string; stats?: AgentStats; onClose: () => void;
}) {
  const { agents, setAgentStatus, pushAgentEvent } = useGhostStore();
  const liveAgent = agents[agentId];
  const color     = agentColor(agentId);
  const meta      = AGENT_META[agentId];
  const [tab, setTab]       = useState<'info' | 'stats' | 'events'>('info');
  const [pinging, setPinging] = useState(false);
  if (!meta) return null;

  const liveStatus = liveAgent?.status ?? 'idle';
  const events     = liveAgent?.events ?? [];

  const handlePing = async () => {
    if (pinging) return;
    setPinging(true);
    setAgentStatus(agentId, 'working');
    pushAgentEvent(agentId, 'Ping received — checking system health...', 'info');
    try {
      const res = await fetch('/api/heartbeat');
      const data = await res.json();
      const uptime = data.uptime ? `${Math.round(data.uptime / 60000)}m` : '?';
      pushAgentEvent(agentId, `System healthy — uptime: ${uptime}`, 'success');
    } catch {
      pushAgentEvent(agentId, 'Ping failed — system may be offline', 'error');
    }
    setAgentStatus(agentId, 'online');
    setPinging(false);
  };

  const successRate = stats && stats.total_calls > 0
    ? Math.round((stats.successes / stats.total_calls) * 100) : null;

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="absolute right-0 top-0 bottom-0 w-full sm:w-[420px] flex flex-col z-10"
      style={{
        background: 'rgba(4, 8, 18, 0.97)',
        borderLeft: `1px solid ${color}25`,
        boxShadow: `-32px 0 80px rgba(0,0,0,0.8), inset 1px 0 0 ${color}10`,
      }}
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-px"
           style={{ background: `linear-gradient(90deg, transparent, ${color}70, transparent)` }} />
      <div className="pointer-events-none absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl"
           style={{ background: color, opacity: 0.04 }} />

      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 shrink-0" style={{ borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
        <div className="relative">
          <AgentAvatar agentId={agentId} size={48} />
          <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2"
               style={{ background: statusColor(liveStatus), borderColor: 'rgba(4,8,18,0.97)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base sm:text-lg font-black leading-tight" style={{ fontFamily: 'Space Grotesk', color }}>{meta.name}</p>
          <p className="text-[10px] sm:text-xs text-ghost-muted/60 truncate">{meta.role}</p>
        </div>
        <button onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-ghost-muted/50 hover:text-white hover:bg-white/10 transition-all shrink-0">
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {(['info', 'stats', 'events'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-2.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider transition-all ${
                    tab === t ? 'text-white' : 'text-ghost-muted/50 hover:text-ghost-muted/60'
                  }`}
                  style={{ borderBottom: `2px solid ${tab === t ? color : 'transparent'}` }}>
            {t === 'info' ? 'Role Info' : t === 'stats' ? 'Stats' : 'Events'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {tab === 'info' ? (
          <div className="p-4 sm:p-5 space-y-4 sm:space-y-5">
            <div className="rounded-xl p-3 sm:p-4" style={{ background: `${color}07`, border: `1px solid ${color}12` }}>
              <p className="text-[11px] sm:text-xs text-ghost-muted/70 leading-relaxed">{meta.desc}</p>
            </div>

            {/* Model */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ghost-muted/50 mb-2 flex items-center gap-1.5">
                <Cpu size={10} /> Model
              </p>
              <span className="text-[10px] sm:text-[11px] font-mono px-3 py-1.5 rounded-lg inline-block"
                    style={{ background: 'rgba(0,212,255,0.07)', color: 'rgba(0,212,255,0.85)', border: '1px solid rgba(0,212,255,0.12)' }}>
                {meta.model}
              </span>
            </div>

            {/* Hierarchy */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ghost-muted/50 mb-2 flex items-center gap-1.5">
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
              <p className="text-[10px] font-bold uppercase tracking-widest text-ghost-muted/50 mb-2">Responsibilities</p>
              <div className="space-y-1.5">
                {meta.details.map((d, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-[11px] sm:text-xs text-ghost-muted/60">
                    <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ background: color }} />
                    {d}
                  </div>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ghost-muted/50 mb-2 flex items-center gap-1.5">
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
          </div>
        ) : tab === 'stats' ? (
          <div className="p-4 sm:p-5 space-y-4">
            {!stats ? (
              <div className="flex flex-col items-center justify-center py-16 text-ghost-muted/20">
                <BarChart3 size={28} className="mb-3" />
                <p className="text-xs">No stats available</p>
              </div>
            ) : (
              <>
                {/* Metric cards */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Total Calls',  value: stats.total_calls.toLocaleString(), color: '#00D4FF', icon: BarChart3 },
                    { label: 'Calls Today',  value: stats.calls_today,                   color, icon: TrendingUp },
                    { label: 'Total Errors', value: stats.total_errors,                   color: '#EF4444', icon: AlertTriangle },
                    { label: 'Errors Today', value: stats.errors_today,                   color: stats.errors_today > 0 ? '#EF4444' : '#10B981', icon: Shield },
                  ].map(m => (
                    <div key={m.label} className="rounded-xl p-3" style={{ background: `${m.color}06`, border: `1px solid ${m.color}12` }}>
                      <m.icon size={12} style={{ color: m.color }} className="mb-2" />
                      <p className="text-lg font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>{m.value}</p>
                      <p className="text-[9px] text-ghost-muted/40 uppercase tracking-wider mt-0.5">{m.label}</p>
                    </div>
                  ))}
                </div>

                {/* Success rate */}
                {successRate !== null && (
                  <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-ghost-muted/50 flex items-center gap-1.5">
                        <CheckCircle2 size={10} /> Success Rate
                      </p>
                      <span className="text-sm font-bold" style={{
                        fontFamily: 'Space Grotesk',
                        color: successRate >= 90 ? '#10B981' : successRate >= 70 ? '#F59E0B' : '#EF4444',
                      }}>
                        {successRate}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: successRate >= 90 ? '#10B981' : successRate >= 70 ? '#F59E0B' : '#EF4444' }}
                        initial={{ width: 0 }}
                        animate={{ width: `${successRate}%` }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                      />
                    </div>
                    <p className="text-[9px] text-ghost-muted/50 mt-2">
                      {stats.successes.toLocaleString()} successful out of {stats.total_calls.toLocaleString()} total calls
                    </p>
                  </div>
                )}

                {/* Last active */}
                <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <Clock size={14} className="text-ghost-muted/50 shrink-0" />
                  <div>
                    <p className="text-[10px] text-ghost-muted/50 uppercase tracking-wider">Last Active</p>
                    <p className="text-xs font-medium text-white">{stats.last_active ? formatRelative(stats.last_active) : 'Never'}</p>
                  </div>
                </div>

                {/* Live events count */}
                <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <Activity size={14} className="text-ghost-muted/50 shrink-0" />
                  <div>
                    <p className="text-[10px] text-ghost-muted/50 uppercase tracking-wider">Live Events</p>
                    <p className="text-xs font-medium text-white">{events.length} in session</p>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            {events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-ghost-muted/20">
                <Activity size={28} className="mb-3" />
                <p className="text-xs">No events yet</p>
                <p className="text-[10px] text-ghost-muted/15 mt-1">Events appear when agents process requests</p>
              </div>
            ) : (
              <div className="space-y-2">
                {[...events].reverse().slice(0, 30).map((e, i) => {
                  const evColor = e.type === 'error' ? '#EF4444' : e.type === 'success' ? '#10B981' : e.type === 'warning' ? '#F59E0B' : color;
                  return (
                    <div key={i} className="p-3 rounded-xl" style={{ background: `${evColor}05`, border: `1px solid ${evColor}10` }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: evColor }} />
                        <p className="text-[10px] text-ghost-muted/50 font-mono">{formatRelative(e.ts)}</p>
                      </div>
                      <p className="text-[11px] sm:text-xs text-ghost-muted/70 pl-3.5">{e.message}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-3 sm:p-4 flex gap-2 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <button onClick={handlePing} disabled={pinging}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all hover:opacity-80 disabled:opacity-40"
                style={{ background: `${color}15`, color, border: `1px solid ${color}25` }}>
          <Zap size={13} /> {pinging ? 'Pinging...' : 'Ping'}
        </button>
        <button
          onClick={() => {
            const store = useGhostStore.getState();
            store.setTerminalOpen(true);
            store.pushTerminalLine({ type: 'system', content: `Switched context to ${meta.name} agent` });
          }}
          className="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all hover:bg-white/[0.06]"
          style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <MessageSquare size={13} /> Terminal
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
    <div className="flex items-center gap-2 sm:gap-3 my-1">
      <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.12))' }} />
      <div className="flex items-center gap-1.5 sm:gap-2.5 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full shrink-0"
           style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.10)', boxShadow: '0 0 16px rgba(0,212,255,0.04)' }}>
        <span className="text-[8px] sm:text-[9px] font-black tracking-[0.2em] sm:tracking-[0.25em] text-ghost-accent/70 uppercase">{label}</span>
        <span className="hidden sm:inline text-[9px] text-ghost-muted/25">&middot;</span>
        <span className="hidden sm:inline text-[9px] text-ghost-muted/50 tracking-wide">{desc}</span>
      </div>
      <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, rgba(0,212,255,0.12), transparent)' }} />
    </div>
  );
}


/* ================================================================================
 *  Page
 * ================================================================================ */
export default function AgentsPage() {
  const { agents, selectedAgent, selectAgent } = useGhostStore();
  const [agentStats, setAgentStats] = useState<Record<string, AgentStats>>({});
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading]       = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/stats');
      const data = await res.json();
      setAgentStats(data.stats || {});
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const vals     = Object.values(agents);
  const online   = vals.filter(a => a.status === 'online').length;
  const working  = vals.filter(a => a.status === 'working').length;
  const idle     = vals.filter(a => a.status === 'idle').length;

  // Aggregate KPIs
  const totalCallsToday  = Object.values(agentStats).reduce((s, a) => s + (a.calls_today || 0), 0);
  const totalErrorsToday = Object.values(agentStats).reduce((s, a) => s + (a.errors_today || 0), 0);

  const handleSelect = (id: string) => selectAgent(id === selectedAgent ? null : id);

  // Filter logic
  const matchesSearch = (id: string) => {
    if (!search) return true;
    const meta = AGENT_META[id];
    if (!meta) return false;
    const q = search.toLowerCase();
    return meta.name.toLowerCase().includes(q)
        || meta.role.toLowerCase().includes(q)
        || meta.tags.some(t => t.toLowerCase().includes(q));
  };

  const matchesStatus = (id: string) => {
    if (statusFilter === 'all') return true;
    const status = agents[id]?.status ?? 'idle';
    return status === statusFilter;
  };

  const filterAgent = (id: string) => matchesSearch(id) && matchesStatus(id);

  const filteredTiers = TIERS.map(tier => ({
    ...tier,
    agents: tier.agents.filter(filterAgent),
  })).filter(t => t.agents.length > 0);

  const hasFilters = search || statusFilter !== 'all';
  const totalFiltered = filteredTiers.reduce((s, t) => s + t.agents.length, 0);

  return (
    <div className="p-3 sm:p-6 pb-24 flex flex-col gap-4 sm:gap-5">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
               style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.15)' }}>
            <Activity size={15} className="text-ghost-accent" />
          </div>
          <div>
            <h1 className="text-base font-black tracking-wider text-white" style={{ fontFamily: 'Space Grotesk' }}>
              AGENT NETWORK
            </h1>
            <p className="text-[10px] sm:text-[11px] text-ghost-muted/40">12 agents &middot; 3-tier hierarchy</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Header KPIs */}
          <div className="flex items-center gap-3 sm:gap-4 mr-1">
            {totalCallsToday > 0 && (
              <div className="flex items-center gap-1.5">
                <BarChart3 size={11} className="text-ghost-accent" />
                <span className="text-[10px] sm:text-xs text-ghost-muted/60">
                  <span className="text-white font-semibold">{totalCallsToday}</span> today
                </span>
              </div>
            )}
            {totalErrorsToday > 0 && (
              <div className="flex items-center gap-1.5">
                <AlertTriangle size={11} className="text-red-400" />
                <span className="text-[10px] sm:text-xs text-red-400/70">
                  <span className="text-red-400 font-semibold">{totalErrorsToday}</span>
                </span>
              </div>
            )}
          </div>

          {/* Live counts */}
          <div className="hidden md:flex items-center gap-3">
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

          <button onClick={fetchStats}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ghost-muted/40 hover:text-white hover:bg-white/5 transition-all shrink-0"
            style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Search & filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost-muted/50" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-ghost-muted/25 outline-none focus:border-ghost-accent/30 transition-colors"
          />
        </div>
        <div className="flex gap-1 p-0.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          {[
            { key: 'all',     label: 'All'     },
            { key: 'online',  label: 'Online'  },
            { key: 'working', label: 'Active'  },
            { key: 'idle',    label: 'Idle'    },
          ].map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
                    className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] font-mono capitalize transition-all ${
                      statusFilter === f.key ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted/40 hover:text-white hover:bg-white/5'
                    }`}>
              {f.label}
            </button>
          ))}
        </div>
        {hasFilters && (
          <span className="text-[10px] text-ghost-muted/50 font-mono">{totalFiltered} matched</span>
        )}
      </div>

      {/* Main panel with tiers + drawer */}
      <div className="relative">
        <div className="glass rounded-2xl p-3 sm:p-6 flex flex-col gap-4 sm:gap-6">

          {filteredTiers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-ghost-muted/20">
              <Search size={28} className="mb-3" />
              <p className="text-sm font-medium">No agents match your search</p>
              <p className="text-xs text-ghost-muted/15 mt-1">Try a different name, role, or tag</p>
            </div>
          ) : filteredTiers.map(tier => (
            <div key={tier.label} className="flex flex-col gap-3">
              <TierDivider label={tier.label} desc={tier.desc} />

              {tier.label === 'COMMANDER' ? (
                tier.agents.map(id => (
                  <CommanderCard key={id} agentId={id}
                    isSelected={selectedAgent === id}
                    onSelect={handleSelect}
                    liveStatus={agents[id]?.status ?? 'idle'}
                    stats={agentStats[id]} />
                ))
              ) : tier.label === 'DIRECTORS' ? (
                <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  {tier.agents.map(id => (
                    <DirectorCard key={id} agentId={id}
                      isSelected={selectedAgent === id}
                      onSelect={handleSelect}
                      liveStatus={agents[id]?.status ?? 'idle'}
                      stats={agentStats[id]} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 sm:gap-2">
                  {tier.agents.map(id => (
                    <WorkerCard key={id} agentId={id}
                      isSelected={selectedAgent === id}
                      onSelect={handleSelect}
                      liveStatus={agents[id]?.status ?? 'idle'}
                      stats={agentStats[id]} />
                  ))}
                </div>
              )}
            </div>
          ))}

        </div>

        {/* Drawer */}
        <AnimatePresence>
          {selectedAgent && AGENT_META[selectedAgent] && (
            <AgentDrawer
              key={selectedAgent}
              agentId={selectedAgent}
              stats={agentStats[selectedAgent]}
              onClose={() => selectAgent(null)}
            />
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
