'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, TrendingDown, TrendingUp, Zap, RefreshCw, AlertTriangle } from 'lucide-react';
import { formatCost, formatRelative } from '@/lib/utils';

interface Provider {
  id:         string;
  name:       string;
  color:      string;
  logo:       string;
  balance?:   number;
  used:       number;
  limit?:     number;
  lastCall:   string;
  model:      string;
  status:     'active' | 'low' | 'depleted' | 'free';
  callsToday: number;
  costToday:  number;
  costTotal:  number;
}

interface UsageEntry {
  ts:       string;
  provider: string;
  model:    string;
  agentId:  string;
  tokens:   number;
  cost:     number;
}

const PROVIDERS: Provider[] = [
  {
    id:         'anthropic',
    name:       'Anthropic',
    color:      '#7C3AED',
    logo:       '◈',
    balance:    0,
    used:       12.47,
    limit:      25,
    lastCall:   new Date(Date.now()-86400000*2).toISOString(),
    model:      'claude-sonnet-4-6',
    status:     'depleted',
    callsToday: 0,
    costToday:  0,
    costTotal:  12.47,
  },
  {
    id:         'openai',
    name:       'OpenAI',
    color:      '#10B981',
    logo:       '○',
    balance:    18.32,
    used:       6.68,
    limit:      25,
    lastCall:   new Date(Date.now()-300000).toISOString(),
    model:      'gpt-4o / gpt-4o-mini-search',
    status:     'active',
    callsToday: 47,
    costToday:  0.14,
    costTotal:  6.68,
  },
  {
    id:         'xai',
    name:       'xAI / Grok',
    color:      '#1DA1F2',
    logo:       '✕',
    balance:    40.15,
    used:       9.85,
    limit:      50,
    lastCall:   new Date(Date.now()-120000).toISOString(),
    model:      'grok-4-1-fast-reasoning',
    status:     'active',
    callsToday: 312,
    costToday:  0.87,
    costTotal:  9.85,
  },
  {
    id:         'ollama',
    name:       'Ollama (Local)',
    color:      '#27AE60',
    logo:       '◉',
    used:       0,
    lastCall:   new Date(Date.now()-60000).toISOString(),
    model:      'qwen3:8b / nomic-embed-text',
    status:     'free',
    callsToday: 1847,
    costToday:  0,
    costTotal:  0,
  },
  {
    id:         'pinecone',
    name:       'Pinecone',
    color:      '#00D4FF',
    logo:       '◈',
    balance:    undefined,
    used:       0.23,
    lastCall:   new Date(Date.now()-900000).toISOString(),
    model:      'ghost-memory (768-dim)',
    status:     'active',
    callsToday: 94,
    costToday:  0.01,
    costTotal:  0.23,
  },
];

const MOCK_USAGE: UsageEntry[] = [
  { ts: new Date(Date.now()-120000).toISOString(),   provider: 'xai',       model: 'grok-4-1-fast', agentId: 'scout',    tokens: 1247, cost: 0.0031 },
  { ts: new Date(Date.now()-300000).toISOString(),   provider: 'openai',    model: 'gpt-4o-mini',   agentId: 'sentinel', tokens: 312,  cost: 0.0001 },
  { ts: new Date(Date.now()-900000).toISOString(),   provider: 'pinecone',  model: 'ghost-memory',  agentId: 'archivist',tokens: 0,    cost: 0.0010 },
  { ts: new Date(Date.now()-1800000).toISOString(),  provider: 'xai',       model: 'grok-3-fast',   agentId: 'codex',    tokens: 892,  cost: 0.0022 },
  { ts: new Date(Date.now()-3600000).toISOString(),  provider: 'openai',    model: 'gpt-4o',        agentId: 'sentinel', tokens: 2100, cost: 0.0168 },
  { ts: new Date(Date.now()-7200000).toISOString(),  provider: 'xai',       model: 'grok-3-fast',   agentId: 'scout',    tokens: 4321, cost: 0.0108 },
  { ts: new Date(Date.now()-14400000).toISOString(), provider: 'openai',    model: 'gpt-4o-mini',   agentId: 'sentinel', tokens: 410,  cost: 0.0001 },
  { ts: new Date(Date.now()-86400000).toISOString(), provider: 'anthropic', model: 'claude-sonnet', agentId: 'forge',    tokens: 8240, cost: 0.2472 },
];

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.06 } } },
  item:      { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } },
};

function ProviderCard({ p }: { p: Provider }) {
  const pct = p.limit ? (p.used / p.limit) * 100 : 0;
  const isLow = pct > 75;
  const isDepleted = p.status === 'depleted';
  const isFree = p.status === 'free';

  return (
    <motion.div
      variants={stagger.item}
      whileHover={{ y: -2 }}
      className="glass rounded-2xl p-5 relative overflow-hidden"
      style={{ border: `1px solid ${isDepleted ? 'rgba(239,68,68,0.2)' : `${p.color}20`}` }}
    >
      {/* Top gradient line */}
      <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
           style={{ background: `linear-gradient(90deg, transparent, ${p.color}60, transparent)` }} />

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base font-bold"
               style={{ background: `${p.color}15`, color: p.color, border: `1px solid ${p.color}25` }}>
            {p.logo}
          </div>
          <div>
            <p className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>{p.name}</p>
            <p className="text-[9px] text-ghost-muted/60 font-mono">{p.model}</p>
          </div>
        </div>

        {/* Status badge */}
        <span className={`text-[9px] px-2 py-0.5 rounded-full font-mono uppercase tracking-wider ${
          isFree      ? 'text-green-400 bg-green-400/10'  :
          isDepleted  ? 'text-red-400 bg-red-400/10'      :
          isLow       ? 'text-yellow-400 bg-yellow-400/10' :
                        'text-green-400 bg-green-400/10'
        }`}>
          {isFree ? 'FREE' : isDepleted ? 'DEPLETED' : isLow ? 'LOW' : 'ACTIVE'}
        </span>
      </div>

      {/* Balance / usage */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-0.5">
            {isFree ? 'Cost' : 'Balance'}
          </p>
          <p className="text-lg font-bold" style={{ fontFamily: 'Space Grotesk', color: isDepleted ? '#EF4444' : p.color }}>
            {isFree ? 'Free' : p.balance !== undefined ? formatCost(p.balance) : '—'}
          </p>
        </div>
        <div>
          <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-0.5">Spent Total</p>
          <p className="text-lg font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
            {formatCost(p.costTotal)}
          </p>
        </div>
        <div>
          <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-0.5">Today</p>
          <p className="text-sm font-semibold text-white">{formatCost(p.costToday)}</p>
        </div>
        <div>
          <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-0.5">Calls Today</p>
          <p className="text-sm font-semibold text-white">{p.callsToday.toLocaleString()}</p>
        </div>
      </div>

      {/* Usage bar */}
      {p.limit && (
        <div className="mb-3">
          <div className="flex justify-between text-[9px] font-mono text-ghost-muted/50 mb-1">
            <span>{formatCost(p.used)} used</span>
            <span>{formatCost(p.limit)} limit</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(pct, 100)}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ background: isDepleted ? '#EF4444' : isLow ? '#F59E0B' : p.color }}
            />
          </div>
          <p className="text-[9px] text-ghost-muted/40 font-mono mt-1 text-right">{pct.toFixed(0)}% used</p>
        </div>
      )}

      {/* Last call */}
      <p className="text-[9px] text-ghost-muted/40 font-mono">
        Last call: {formatRelative(p.lastCall)}
      </p>

      {/* Depleted warning */}
      {isDepleted && (
        <div className="mt-3 flex items-center gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/15">
          <AlertTriangle size={11} className="text-red-400 shrink-0" />
          <p className="text-[9px] text-red-400/80">Credits depleted. Add credits to restore service.</p>
        </div>
      )}
    </motion.div>
  );
}

export default function CreditsPage() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('today');

  const totalSpent = PROVIDERS.reduce((s, p) => s + p.costTotal, 0);
  const spentToday = PROVIDERS.reduce((s, p) => s + p.costToday, 0);
  const freeCallsToday = PROVIDERS.find(p => p.id === 'ollama')?.callsToday ?? 0;

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard size={16} className="text-ghost-accent" />
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>API Credits</h2>
          </div>
          <p className="text-xs text-ghost-muted">Provider balances and usage tracking</p>
        </div>
        <button className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Spent Today',     value: formatCost(spentToday),  icon: TrendingDown, color: '#EF4444'  },
          { label: 'Spent Total',     value: formatCost(totalSpent),  icon: CreditCard,   color: '#F59E0B'  },
          { label: 'Free Calls Today',value: freeCallsToday.toLocaleString(), icon: Zap, color: '#10B981' },
          { label: 'Active Providers',value: PROVIDERS.filter(p => p.status === 'active' || p.status === 'free').length,
            icon: TrendingUp, color: '#00D4FF' },
        ].map((kpi) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2 }}
            className="glass rounded-xl p-4"
            style={{ border: `1px solid ${kpi.color}20` }}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
                 style={{ background: `${kpi.color}15`, border: `1px solid ${kpi.color}25` }}>
              <kpi.icon size={14} style={{ color: kpi.color }} />
            </div>
            <p className="text-xl font-bold text-white mb-1" style={{ fontFamily: 'Space Grotesk' }}>{kpi.value}</p>
            <p className="text-[10px] text-ghost-muted">{kpi.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Provider cards */}
      <motion.div
        variants={stagger.container}
        initial="initial"
        animate="animate"
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6"
      >
        {PROVIDERS.map(p => <ProviderCard key={p.id} p={p} />)}
      </motion.div>

      {/* Recent usage log */}
      <div className="glass rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>Recent API Calls</h3>
          <div className="flex gap-1">
            {(['today','week','month','all'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                      className={`px-2.5 py-1 rounded text-[10px] font-mono capitalize transition-all ${
                        period === p ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted hover:text-white hover:bg-white/5'
                      }`}>{p}</button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5">
                {['Time', 'Provider', 'Model', 'Agent', 'Tokens', 'Cost'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[9px] uppercase tracking-wider text-ghost-muted/50 font-mono">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MOCK_USAGE.map((u, i) => {
                const prov = PROVIDERS.find(p => p.id === u.provider);
                return (
                  <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 text-[10px] text-ghost-muted/60 font-mono">{formatRelative(u.ts)}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-medium" style={{ color: prov?.color ?? '#64748B' }}>
                        {prov?.logo} {prov?.name ?? u.provider}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[10px] text-ghost-muted font-mono">{u.model}</td>
                    <td className="px-4 py-2.5 text-[10px] text-ghost-muted font-mono">{u.agentId}</td>
                    <td className="px-4 py-2.5 text-[10px] text-ghost-muted font-mono">{u.tokens > 0 ? u.tokens.toLocaleString() : '—'}</td>
                    <td className="px-4 py-2.5 text-[10px] font-mono" style={{ color: u.cost === 0 ? '#10B981' : '#F59E0B' }}>
                      {u.cost === 0 ? 'free' : formatCost(u.cost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Free-first note */}
      <div className="mt-4 glass rounded-xl p-3 flex items-center gap-3"
           style={{ border: '1px solid rgba(39,174,96,0.12)' }}>
        <Zap size={13} className="text-green-400 shrink-0" />
        <p className="text-[10px] text-ghost-muted">
          <span className="text-green-400 font-medium">Free-first routing active</span> — Ghost defaults to Ollama qwen3:8b (local, zero cost).
          Paid APIs are only called for real-time data, vision, or when Ollama is unavailable.
        </p>
      </div>
    </div>
  );
}
