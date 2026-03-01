'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, TrendingDown, TrendingUp, Zap, RefreshCw, AlertTriangle } from 'lucide-react';
import { formatCost, formatRelative } from '@/lib/utils';

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

const PROVIDER_META: Record<string, { name: string; color: string; logo: string }> = {
  ollama:    { name: 'Ollama (Local)',  color: '#27AE60', logo: '\u25C9' },
  openai:    { name: 'OpenAI',          color: '#10B981', logo: '\u25CB' },
  anthropic: { name: 'Anthropic',       color: '#7C3AED', logo: '\u25C8' },
  xai:       { name: 'xAI / Grok',      color: '#1DA1F2', logo: '\u2715' },
};

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.06 } } },
  item:      { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } },
};

function ProviderCard({ p }: { p: ProviderStats }) {
  const meta = PROVIDER_META[p.provider] ?? { name: p.provider, color: '#64748B', logo: '\u2022' };
  const isFree = p.provider === 'ollama';
  const totalCost = parseFloat(p.total_cost) || 0;
  const calls = parseInt(p.calls) || 0;

  return (
    <motion.div
      variants={stagger.item}
      whileHover={{ y: -2 }}
      className="glass rounded-2xl p-5 relative overflow-hidden"
      style={{ border: `1px solid ${meta.color}20` }}
    >
      <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
           style={{ background: `linear-gradient(90deg, transparent, ${meta.color}60, transparent)` }} />

      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base font-bold"
               style={{ background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}25` }}>
            {meta.logo}
          </div>
          <div>
            <p className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>{meta.name}</p>
            <p className="text-[9px] text-ghost-muted/60 font-mono">{p.last_model || 'N/A'}</p>
          </div>
        </div>
        <span className={`text-[9px] px-2 py-0.5 rounded-full font-mono uppercase tracking-wider ${
          isFree ? 'text-green-400 bg-green-400/10' : 'text-blue-400 bg-blue-400/10'
        }`}>
          {isFree ? 'FREE' : 'PAID'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-0.5">Total Cost</p>
          <p className="text-lg font-bold" style={{ fontFamily: 'Space Grotesk', color: isFree ? '#10B981' : meta.color }}>
            {isFree ? 'Free' : formatCost(totalCost)}
          </p>
        </div>
        <div>
          <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-0.5">Total Calls</p>
          <p className="text-lg font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
            {calls.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-0.5">Input Tokens</p>
          <p className="text-sm font-semibold text-white">{parseInt(p.total_input_tokens || '0').toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-0.5">Output Tokens</p>
          <p className="text-sm font-semibold text-white">{parseInt(p.total_output_tokens || '0').toLocaleString()}</p>
        </div>
      </div>

      <p className="text-[9px] text-ghost-muted/40 font-mono">
        Last call: {p.last_call ? formatRelative(p.last_call) : 'never'}
      </p>
    </motion.div>
  );
}

export default function CreditsPage() {
  const [period, setPeriod]     = useState<'today' | 'week' | 'month' | 'all'>('all');
  const [providers, setProviders] = useState<ProviderStats[]>([]);
  const [calls, setCalls]       = useState<UsageEntry[]>([]);
  const [loading, setLoading]   = useState(true);

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

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalSpent = providers.reduce((s, p) => s + (parseFloat(p.total_cost) || 0), 0);
  const totalCalls = providers.reduce((s, p) => s + (parseInt(p.calls) || 0), 0);
  const freeCalls  = providers.find(p => p.provider === 'ollama')?.calls ?? '0';

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard size={16} className="text-ghost-accent" />
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>API Credits</h2>
          </div>
          <p className="text-xs text-ghost-muted">Provider usage and cost tracking</p>
        </div>
        <button onClick={fetchData}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Spend',      value: formatCost(totalSpent),      icon: TrendingDown, color: '#EF4444'  },
          { label: 'Total Calls',      value: totalCalls.toLocaleString(), icon: CreditCard,   color: '#F59E0B'  },
          { label: 'Free Calls',       value: parseInt(freeCalls).toLocaleString(), icon: Zap, color: '#10B981' },
          { label: 'Providers Active', value: providers.length,            icon: TrendingUp,   color: '#00D4FF'  },
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

      {/* Period filter */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {(['today','week','month','all'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-mono capitalize transition-all ${
                    period === p ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted hover:text-white hover:bg-white/5'
                  }`}>{p}</button>
        ))}
      </div>

      {/* Provider cards */}
      <motion.div
        variants={stagger.container}
        initial="initial"
        animate="animate"
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6"
      >
        {providers.length === 0 && !loading && (
          <div className="col-span-full glass rounded-2xl p-8 text-center" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-sm text-ghost-muted">No API usage recorded yet. Send a message to start tracking.</p>
          </div>
        )}
        {providers.map(p => <ProviderCard key={p.provider} p={p} />)}
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
              {calls.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[10px] text-ghost-muted/40">
                    {loading ? 'Loading...' : 'No API calls recorded yet'}
                  </td>
                </tr>
              ) : calls.map((u) => {
                const meta = PROVIDER_META[u.provider] ?? { name: u.provider, color: '#64748B', logo: '\u2022' };
                return (
                  <tr key={u.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 text-[10px] text-ghost-muted/60 font-mono">{formatRelative(u.ts)}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-medium" style={{ color: meta.color }}>
                        {meta.logo} {meta.name}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[10px] text-ghost-muted font-mono">{u.model}</td>
                    <td className="px-4 py-2.5 text-[10px] text-ghost-muted font-mono">{u.agent || '-'}</td>
                    <td className="px-4 py-2.5 text-[10px] text-ghost-muted font-mono">{((u.input_tokens || 0) + (u.output_tokens || 0)).toLocaleString()}</td>
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
          <span className="text-green-400 font-medium">Free-first routing active</span> — Ghost defaults to Ollama qwen3-coder (local, zero cost).
          Paid APIs are only called for real-time data, vision, or when Ollama is unavailable.
        </p>
      </div>
    </div>
  );
}
