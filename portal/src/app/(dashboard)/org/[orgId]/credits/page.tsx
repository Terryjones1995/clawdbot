'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, TrendingDown, Zap, RefreshCw, Activity,
  CheckCircle2, XCircle, AlertTriangle, Clock, Cpu,
  ChevronDown, ChevronUp, Bot, Hash, ArrowUpRight,
  Server, DollarSign, Gauge, BarChart3,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { formatCost, formatRelative, agentColor, agentEmoji } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface ProviderStats {
  provider:             string;
  calls:                string;
  total_input_tokens:   string;
  total_output_tokens:  string;
  total_cost:           string;
  last_model:           string;
  last_call:            string;
}

interface UsageEntry {
  id:            number;
  ts:            string;
  provider:      string;
  model:         string;
  agent:         string;
  action:        string;
  input_tokens:  number;
  output_tokens: number;
  cost:          number;
  latency_ms:    number;
}

interface KeyStatus {
  active: boolean;
  error:  string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PROVIDER_META: Record<string, {
  name: string; color: string; gradient: string; icon: string; tier: string;
  models: string[];
}> = {
  ollama: {
    name: 'Ollama', color: '#27AE60', gradient: 'from-emerald-500/20 to-emerald-900/5',
    icon: '~', tier: 'LOCAL',
    models: ['qwen2.5:14b', 'deepseek-r1:14b', 'nomic-embed-text'],
  },
  deepseek: {
    name: 'DeepSeek', color: '#6366F1', gradient: 'from-indigo-500/20 to-indigo-900/5',
    icon: 'D', tier: 'PAID',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  openai: {
    name: 'OpenAI', color: '#10B981', gradient: 'from-teal-500/20 to-teal-900/5',
    icon: 'O', tier: 'PAID',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-5.3-codex', 'o4-mini'],
  },
  anthropic: {
    name: 'Anthropic', color: '#7C3AED', gradient: 'from-violet-500/20 to-violet-900/5',
    icon: 'A', tier: 'PAID',
    models: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6'],
  },
  xai: {
    name: 'xAI / Grok', color: '#3B82F6', gradient: 'from-blue-500/20 to-blue-900/5',
    icon: 'X', tier: 'PAID',
    models: ['grok-4-1-fast-reasoning', 'grok-3-fast-beta'],
  },
};

const ALL_PROVIDERS = ['ollama', 'deepseek', 'openai', 'anthropic', 'xai'];

// ── Components ───────────────────────────────────────────────────────────────

function StatusDot({ active, error }: { active: boolean; error: string | null }) {
  if (active) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-40" />
        </div>
        <span className="text-[9px] font-mono text-emerald-400 uppercase tracking-wider">Active</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full bg-red-400" />
      <span className="text-[9px] font-mono text-red-400 uppercase tracking-wider truncate max-w-24" title={error || 'Inactive'}>
        {error || 'Inactive'}
      </span>
    </div>
  );
}

function ProviderCard({
  provider, stats, keyStatus, loading
}: {
  provider: string;
  stats?: ProviderStats;
  keyStatus?: KeyStatus;
  loading: boolean;
}) {
  const meta = PROVIDER_META[provider];
  const isFree = provider === 'ollama';
  const totalCost = parseFloat(stats?.total_cost || '0');
  const calls = parseInt(stats?.calls || '0');
  const inputTokens = parseInt(stats?.total_input_tokens || '0');
  const outputTokens = parseInt(stats?.total_output_tokens || '0');
  const totalTokens = inputTokens + outputTokens;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className="relative glass rounded-2xl overflow-hidden group"
      style={{ border: `1px solid ${meta.color}18` }}
    >
      {/* Top gradient accent */}
      <div className="absolute top-0 left-0 right-0 h-1"
           style={{ background: `linear-gradient(90deg, ${meta.color}00, ${meta.color}80, ${meta.color}00)` }} />

      {/* Background glow */}
      <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full opacity-[0.03] group-hover:opacity-[0.06] transition-opacity"
           style={{ background: meta.color }} />

      <div className="relative p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black"
                 style={{ background: `${meta.color}12`, color: meta.color, border: `1px solid ${meta.color}20`,
                          boxShadow: `0 0 20px ${meta.color}10` }}>
              {meta.icon}
            </div>
            <div>
              <p className="text-sm font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>{meta.name}</p>
              <p className="text-[9px] font-mono text-ghost-muted/50">
                {stats?.last_model || meta.models[0]}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-[8px] px-2 py-0.5 rounded-full font-mono font-bold tracking-widest ${
              isFree
                ? 'text-emerald-300 bg-emerald-400/10 border border-emerald-400/20'
                : 'text-ghost-accent bg-ghost-accent/10 border border-ghost-accent/20'
            }`}>
              {meta.tier}
            </span>
            {keyStatus && <StatusDot active={keyStatus.active} error={keyStatus.error} />}
          </div>
        </div>

        {/* Cost display */}
        <div className="mb-4">
          <p className="text-[9px] text-ghost-muted/40 uppercase tracking-wider mb-1">Total Spend</p>
          <p className="text-2xl font-black tracking-tight"
             style={{ fontFamily: 'Space Grotesk', color: isFree ? '#10B981' : totalCost > 0 ? meta.color : 'rgba(255,255,255,0.3)' }}>
            {isFree ? '$0.00' : totalCost > 0 ? formatCost(totalCost) : '$0.00'}
          </p>
          {isFree && (
            <p className="text-[9px] text-emerald-400/60 font-mono mt-0.5">Always free — local inference</p>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2">
          <StatMini icon={Activity} label="Calls" value={calls.toLocaleString()} color={meta.color} />
          <StatMini icon={ArrowUpRight} label="In Tokens" value={formatTokens(inputTokens)} color={meta.color} />
          <StatMini icon={Gauge} label="Out Tokens" value={formatTokens(outputTokens)} color={meta.color} />
        </div>

        {/* Last call */}
        {stats?.last_call && (
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-[9px] text-ghost-muted/50 font-mono flex items-center gap-1">
              <Clock size={8} /> Last call {formatRelative(stats.last_call)}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StatMini({ icon: Icon, label, value, color }: {
  icon: any; label: string; value: string; color: string;
}) {
  return (
    <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <p className="text-[7px] sm:text-[8px] text-ghost-muted/50 uppercase tracking-wider mb-0.5 flex items-center gap-0.5">
        <Icon size={7} /> {label}
      </p>
      <p className="text-[10px] sm:text-xs font-bold text-white font-mono">{value}</p>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function UsageRow({ u, index }: { u: UsageEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const meta = PROVIDER_META[u.provider] ?? { name: u.provider, color: '#64748B', icon: '?', tier: '?' };
  const aColor = agentColor(u.agent || 'ghost');
  const totalTokens = (u.input_tokens || 0) + (u.output_tokens || 0);

  const ACTION_LABELS: Record<string, string> = {
    chat: 'Chat Completion', embed: 'Embedding', 'api-call': 'API Call',
    search: 'Web Search', vision: 'Vision', code: 'Code Generation',
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      className="group rounded-xl overflow-hidden transition-all"
      style={{
        background: expanded ? 'rgba(255,255,255,0.07)' : 'transparent',
        borderLeft: `3px solid ${meta.color}50`,
      }}
    >
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 cursor-pointer hover:bg-white/[0.05] transition-colors"
           onClick={() => setExpanded(!expanded)}>
        {/* Provider icon */}
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0"
             style={{ background: `${meta.color}12`, color: meta.color, border: `1px solid ${meta.color}20` }}>
          {meta.icon}
        </div>

        {/* Model + action */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[11px] sm:text-xs font-semibold text-white truncate">{u.model}</p>
            {u.agent && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0 hidden sm:inline-flex items-center gap-1"
                    style={{ color: aColor, background: `${aColor}10`, border: `1px solid ${aColor}15` }}>
                {agentEmoji(u.agent)} {u.agent}
              </span>
            )}
          </div>
          <p className="text-[9px] text-ghost-muted/40 font-mono flex items-center gap-1.5">
            <span className="sm:hidden">{u.agent || 'system'} · </span>
            {ACTION_LABELS[u.action] || u.action || 'api-call'}
            <span className="text-ghost-muted/20">·</span>
            <span>{formatRelative(u.ts)}</span>
          </p>
        </div>

        {/* Tokens pill */}
        <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md shrink-0"
             style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <ArrowUpRight size={8} className="text-ghost-muted/50" />
          <span className="text-[9px] font-mono text-ghost-muted/50">{formatTokens(totalTokens)}</span>
        </div>

        {/* Latency */}
        {u.latency_ms > 0 && (
          <span className="text-[9px] font-mono text-ghost-muted/50 hidden lg:inline shrink-0">
            {u.latency_ms < 1000 ? `${u.latency_ms}ms` : `${(u.latency_ms / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Cost badge */}
        <span className={`text-[10px] font-mono font-bold shrink-0 min-w-14 text-right px-2 py-0.5 rounded-md ${
          u.cost === 0
            ? 'text-emerald-400 bg-emerald-400/8'
            : 'text-white'
        }`}
              style={u.cost > 0 ? { color: meta.color, background: `${meta.color}10` } : undefined}>
          {u.cost === 0 ? 'FREE' : formatCost(u.cost)}
        </span>

        <ChevronDown size={12} className={`text-ghost-muted/20 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-1">
              <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <DetailCell icon={Hash} label="Call ID" value={`#${u.id}`} />
                  <DetailCell icon={Cpu} label="Model" value={u.model} valueColor={meta.color} />
                  <DetailCell icon={Bot} label="Agent" value={u.agent || 'system'} valueColor={aColor} />
                  <DetailCell icon={Clock} label="Latency" value={u.latency_ms ? `${u.latency_ms}ms` : 'n/a'} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <p className="text-[8px] text-ghost-muted/50 uppercase tracking-wider mb-0.5">Input</p>
                    <p className="text-[10px] sm:text-xs font-mono text-ghost-muted/70">{(u.input_tokens || 0).toLocaleString()} <span className="text-ghost-muted/50">tok</span></p>
                  </div>
                  <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <p className="text-[8px] text-ghost-muted/50 uppercase tracking-wider mb-0.5">Output</p>
                    <p className="text-[10px] sm:text-xs font-mono text-ghost-muted/70">{(u.output_tokens || 0).toLocaleString()} <span className="text-ghost-muted/50">tok</span></p>
                  </div>
                  <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <p className="text-[8px] text-ghost-muted/50 uppercase tracking-wider mb-0.5">Provider</p>
                    <p className="text-[10px] sm:text-xs font-mono" style={{ color: meta.color }}>{meta.name}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DetailCell({ icon: Icon, label, value, valueColor }: {
  icon: any; label: string; value: string; valueColor?: string;
}) {
  return (
    <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <p className="text-[8px] sm:text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-1 flex items-center gap-1">
        <Icon size={8} /> {label}
      </p>
      <p className="text-[10px] sm:text-xs font-mono text-white truncate" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CreditsPage() {
  const [period, setPeriod]       = useState<'today' | 'week' | 'month' | 'all'>('all');
  const [providers, setProviders] = useState<ProviderStats[]>([]);
  const [calls, setCalls]         = useState<UsageEntry[]>([]);
  const [keyStatus, setKeyStatus] = useState<Record<string, KeyStatus>>({});
  const [loading, setLoading]     = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);
  const [callsPage, setCallsPage] = useState(1);
  const CALLS_PER_PAGE = 10;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, recentRes] = await Promise.all([
        fetch(`/api/credits?period=${period}`),
        fetch(`/api/credits/recent?period=${period}&limit=50`),
      ]);
      const stats  = await statsRes.json();
      const recent = await recentRes.json();
      setProviders(stats.providers || []);
      setCalls(recent.calls || []);
    } catch { /* offline */ }
    setLoading(false);
  }, [period]);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch('/api/credits/status');
      const data = await res.json();
      setKeyStatus(data.status || {});
    } catch { /* offline */ }
    setStatusLoading(false);
  }, []);

  useEffect(() => { fetchData(); setCallsPage(1); }, [fetchData]);
  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const totalSpent = providers.reduce((s, p) => s + (parseFloat(p.total_cost) || 0), 0);
  const totalCalls = providers.reduce((s, p) => s + (parseInt(p.calls) || 0), 0);
  const freeCalls  = parseInt(providers.find(p => p.provider === 'ollama')?.calls || '0');
  const paidCalls  = totalCalls - freeCalls;
  const freePercent = totalCalls > 0 ? Math.round((freeCalls / totalCalls) * 100) : 0;

  // Build a map for quick stats lookup
  const statsMap: Record<string, ProviderStats> = {};
  for (const p of providers) statsMap[p.provider] = p;

  return (
    <div className="p-3 sm:p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 sm:mb-7 gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard size={18} className="text-ghost-accent" />
            <h2 className="text-lg sm:text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>API Credits</h2>
          </div>
          <p className="text-[10px] sm:text-xs text-ghost-muted">Live provider status, usage tracking, and cost analysis</p>
        </div>
        <button onClick={() => { fetchData(); fetchStatus(); }}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Hero stats bar */}
      <div className="glass rounded-2xl p-4 sm:p-5 mb-5 sm:mb-7 relative overflow-hidden"
           style={{ border: '1px solid rgba(0,212,255,0.1)' }}>
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-ghost-accent/5 via-transparent to-emerald-500/5" />

        <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
          <div>
            <p className="text-[9px] text-ghost-muted/40 uppercase tracking-wider mb-1 flex items-center gap-1">
              <DollarSign size={9} /> Total Spend
            </p>
            <p className="text-2xl sm:text-3xl font-black text-white" style={{ fontFamily: 'Space Grotesk' }}>
              {formatCost(totalSpent)}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-ghost-muted/40 uppercase tracking-wider mb-1 flex items-center gap-1">
              <BarChart3 size={9} /> API Calls
            </p>
            <p className="text-2xl sm:text-3xl font-black text-white" style={{ fontFamily: 'Space Grotesk' }}>
              {totalCalls.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-ghost-muted/40 uppercase tracking-wider mb-1 flex items-center gap-1">
              <Zap size={9} /> Free Rate
            </p>
            <p className="text-2xl sm:text-3xl font-black" style={{ fontFamily: 'Space Grotesk', color: '#10B981' }}>
              {freePercent}%
            </p>
            <p className="text-[9px] text-ghost-muted/50 font-mono">{freeCalls.toLocaleString()} free / {paidCalls.toLocaleString()} paid</p>
          </div>
          <div>
            <p className="text-[9px] text-ghost-muted/40 uppercase tracking-wider mb-1 flex items-center gap-1">
              <Server size={9} /> Providers
            </p>
            <div className="flex items-center gap-2 mt-1">
              {ALL_PROVIDERS.map(prov => {
                const ks = keyStatus[prov];
                const meta = PROVIDER_META[prov];
                return (
                  <div key={prov} className="flex items-center gap-1" title={`${meta.name}: ${ks?.active ? 'Active' : ks?.error || 'Checking...'}`}>
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      !ks ? 'bg-ghost-muted/20 animate-pulse' :
                      ks.active ? 'bg-emerald-400' : 'bg-red-400'
                    }`} />
                    <span className="text-[9px] font-mono text-ghost-muted/50">{meta.icon}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Free-first progress bar */}
        <div className="relative mt-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[9px] text-ghost-muted/40 font-mono flex items-center gap-1">
              <Zap size={8} className="text-emerald-400" /> Free-first routing efficiency
            </p>
            <p className="text-[9px] font-mono text-emerald-400">{freePercent}% free</p>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #10B981, #34D399)' }}
              initial={{ width: 0 }}
              animate={{ width: `${freePercent}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>

      {/* Period filter */}
      <div className="flex gap-1 mb-4 sm:mb-5 p-1 rounded-xl w-fit" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}>
        {(['today','week','month','all'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-mono capitalize transition-all ${
                    period === p ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted/50 hover:text-white hover:bg-white/5'
                  }`}>{p}</button>
        ))}
      </div>

      {/* Provider cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {ALL_PROVIDERS.map((prov, i) => (
          <motion.div key={prov} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
            <ProviderCard
              provider={prov}
              stats={statsMap[prov]}
              keyStatus={keyStatus[prov]}
              loading={loading}
            />
          </motion.div>
        ))}
      </div>

      {/* Anthropic warning banner */}
      {keyStatus.anthropic && !keyStatus.anthropic.active && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-xl p-3 sm:p-4 mb-5 flex items-start gap-3"
          style={{ border: '1px solid rgba(239,68,68,0.15)', background: 'rgba(239,68,68,0.03)' }}
        >
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-red-300 mb-0.5">Anthropic API Inactive</p>
            <p className="text-[10px] text-ghost-muted/60">
              {keyStatus.anthropic.error || 'Key is not active.'}
              {keyStatus.anthropic.error?.includes('credit') && ' Add credits at console.anthropic.com to re-enable Claude models.'}
            </p>
          </div>
        </motion.div>
      )}

      {/* Recent API calls */}
      {(() => {
        const totalPages = Math.max(1, Math.ceil(calls.length / CALLS_PER_PAGE));
        const pagedCalls = calls.slice((callsPage - 1) * CALLS_PER_PAGE, callsPage * CALLS_PER_PAGE);
        const startIdx = (callsPage - 1) * CALLS_PER_PAGE + 1;
        const endIdx = Math.min(callsPage * CALLS_PER_PAGE, calls.length);

        return (
          <div className="mb-2">
            {/* Section header */}
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-ghost-accent" />
                <h3 className="text-sm font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Recent API Calls</h3>
                <span className="text-[9px] font-mono text-ghost-muted/40 px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}>
                  {calls.length} total
                </span>
              </div>
              {calls.length > CALLS_PER_PAGE && (
                <p className="text-[9px] font-mono text-ghost-muted/50">
                  {startIdx}–{endIdx} of {calls.length}
                </p>
              )}
            </div>

            {/* Table header row */}
            {!loading && calls.length > 0 && (
              <div className="hidden sm:flex items-center gap-2 sm:gap-3 px-4 py-2 mb-1 text-[8px] uppercase tracking-wider font-mono text-ghost-muted/25">
                <span className="w-7 shrink-0" />
                <span className="flex-1">Model / Action</span>
                <span className="w-20 text-center">Tokens</span>
                <span className="w-14 hidden lg:inline">Speed</span>
                <span className="w-14 text-right">Cost</span>
                <span className="w-3 shrink-0" />
              </div>
            )}

            {/* Calls list */}
            <div className="glass rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
              {loading ? (
                <div className="p-12 text-center">
                  <RefreshCw size={18} className="text-ghost-accent animate-spin mx-auto mb-2" />
                  <p className="text-xs text-ghost-muted">Loading usage data...</p>
                </div>
              ) : calls.length === 0 ? (
                <div className="p-12 text-center">
                  <Activity size={24} className="text-ghost-muted/20 mx-auto mb-2" />
                  <p className="text-xs text-ghost-muted/40">No API calls recorded for this period</p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.03]">
                  {pagedCalls.map((u, i) => <UsageRow key={u.id} u={u} index={i} />)}
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 gap-2">
                <p className="text-[9px] font-mono text-ghost-muted/25">
                  Page {callsPage} of {totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCallsPage(1)}
                    disabled={callsPage === 1}
                    className="px-2 py-1 rounded-md text-[9px] font-mono text-ghost-muted/40 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                    style={{ border: '1px solid rgba(255,255,255,0.10)' }}
                  >
                    First
                  </button>
                  <button
                    onClick={() => setCallsPage(p => Math.max(1, p - 1))}
                    disabled={callsPage === 1}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-ghost-muted/40 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                    style={{ border: '1px solid rgba(255,255,255,0.10)' }}
                  >
                    <ChevronLeft size={12} />
                  </button>
                  {/* Page number pills */}
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let page: number;
                    if (totalPages <= 5) {
                      page = i + 1;
                    } else if (callsPage <= 3) {
                      page = i + 1;
                    } else if (callsPage >= totalPages - 2) {
                      page = totalPages - 4 + i;
                    } else {
                      page = callsPage - 2 + i;
                    }
                    return (
                      <button
                        key={page}
                        onClick={() => setCallsPage(page)}
                        className={`w-7 h-7 flex items-center justify-center rounded-md text-[10px] font-mono transition-all ${
                          callsPage === page
                            ? 'text-ghost-accent bg-ghost-accent/15 font-bold'
                            : 'text-ghost-muted/40 hover:text-white hover:bg-white/5'
                        }`}
                        style={{ border: callsPage === page ? '1px solid rgba(0,212,255,0.2)' : '1px solid rgba(255,255,255,0.10)' }}
                      >
                        {page}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setCallsPage(p => Math.min(totalPages, p + 1))}
                    disabled={callsPage === totalPages}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-ghost-muted/40 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                    style={{ border: '1px solid rgba(255,255,255,0.10)' }}
                  >
                    <ChevronRight size={12} />
                  </button>
                  <button
                    onClick={() => setCallsPage(totalPages)}
                    disabled={callsPage === totalPages}
                    className="px-2 py-1 rounded-md text-[9px] font-mono text-ghost-muted/40 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                    style={{ border: '1px solid rgba(255,255,255,0.10)' }}
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Free-first footer */}
      <div className="mt-4 glass rounded-xl p-3 flex items-start sm:items-center gap-2 sm:gap-3"
           style={{ border: '1px solid rgba(39,174,96,0.12)' }}>
        <Zap size={13} className="text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
        <p className="text-[9px] sm:text-[10px] text-ghost-muted">
          <span className="text-emerald-400 font-medium">Free-first routing active</span> — Ghost defaults to Ollama (local, zero cost).
          Paid APIs are only called for real-time data, web research, code repair, or when Ollama is unavailable.
        </p>
      </div>
    </div>
  );
}
