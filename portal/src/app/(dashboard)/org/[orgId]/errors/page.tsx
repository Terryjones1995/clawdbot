'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, RefreshCw, Zap, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { formatRelative } from '@/lib/utils';

interface ErrorEntry {
  id:       string;
  ts:       string;
  level:    string;
  agent:    string;
  action:   string;
  outcome:  string;
  model?:   string;
  note?:    string;
}

function LevelBadge({ level }: { level: string }) {
  const config: Record<string, { color: string; bg: string }> = {
    ERROR: { color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
    WARN:  { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
    INFO:  { color: '#00D4FF', bg: 'rgba(0,212,255,0.08)' },
  };
  const c = config[level] ?? config.INFO;
  return (
    <span className="text-[9px] px-2 py-0.5 rounded-full uppercase font-mono font-bold tracking-wider"
          style={{ color: c.color, background: c.bg, border: `1px solid ${c.color}25` }}>
      {level}
    </span>
  );
}

export default function ErrorsPage() {
  const [errors,   setErrors]   = useState<ErrorEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter,   setFilter]   = useState<'all' | 'error' | 'warn'>('all');

  const fetchErrors = useCallback(async () => {
    try {
      const res  = await fetch('/api/errors?limit=50');
      const data = await res.json();
      if (data.errors) setErrors(data.errors);
    } catch { /* Ghost offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchErrors();
    const t = setInterval(fetchErrors, 30_000);
    return () => clearInterval(t);
  }, [fetchErrors]);

  const filtered = errors.filter(e => {
    if (filter === 'error') return e.level === 'ERROR';
    if (filter === 'warn')  return e.level === 'WARN';
    return true;
  });

  const errorCount = errors.filter(e => e.level === 'ERROR').length;

  return (
    <div className="p-6 max-w-screen-xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <AlertTriangle size={16} className={errorCount > 0 ? 'text-red-400' : 'text-green-400'} />
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Error Console</h2>
            {errorCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-mono text-red-400"
                    style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                {errorCount} errors
              </span>
            )}
          </div>
          <p className="text-xs text-ghost-muted">Real-time error monitoring · auto-refresh 30s</p>
        </div>

        <button onClick={fetchErrors}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
          style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-1 mb-4">
        {([
          { key: 'all',   label: `All (${errors.length})` },
          { key: 'error', label: `Errors (${errorCount})` },
          { key: 'warn',  label: `Warnings (${errors.filter(e => e.level === 'WARN').length})` },
        ] as const).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
              filter === f.key ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted hover:text-white hover:bg-white/5'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Status */}
      {loading ? (
        <div className="glass rounded-2xl p-12 text-center mb-4">
          <Loader2 size={20} className="text-ghost-accent animate-spin mx-auto mb-2" />
          <p className="text-xs text-ghost-muted">Loading errors…</p>
        </div>
      ) : errorCount === 0 && filter !== 'warn' && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="glass rounded-2xl p-12 text-center mb-4">
          <CheckCircle2 size={32} className="text-green-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-white mb-1" style={{ fontFamily: 'Space Grotesk' }}>All Clear</p>
          <p className="text-xs text-ghost-muted">No errors in recent logs.</p>
        </motion.div>
      )}

      {/* Error list */}
      <div className="space-y-2">
        <AnimatePresence>
          {filtered.map((err, i) => (
            <motion.div key={err.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }}
              transition={{ delay: i * 0.04 }}
              className="glass rounded-xl overflow-hidden"
              style={{ border: `1px solid ${err.level === 'ERROR' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.12)'}` }}>

              <div className="flex items-center gap-4 p-4 cursor-pointer"
                   onClick={() => setExpanded(expanded === err.id ? null : err.id)}>
                <LevelBadge level={err.level} />
                <span className="text-[10px] font-mono px-2 py-0.5 rounded text-ghost-muted/70"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {err.agent}
                </span>

                <p className="flex-1 text-xs text-white truncate">
                  {err.action} → {err.outcome}
                  {err.note ? ` · ${err.note}` : ''}
                </p>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[10px] text-ghost-muted font-mono">{formatRelative(err.ts)}</span>
                  {expanded === err.id ? <ChevronUp size={13} className="text-ghost-muted" /> : <ChevronDown size={13} className="text-ghost-muted" />}
                </div>
              </div>

              <AnimatePresence>
                {expanded === err.id && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} className="overflow-hidden"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="p-4 space-y-2">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[9px] text-ghost-muted uppercase mb-1">Agent</p>
                          <p className="text-xs font-mono text-white">{err.agent}</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-ghost-muted uppercase mb-1">Model</p>
                          <p className="text-xs font-mono text-white">{err.model || 'n/a'}</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-ghost-muted uppercase mb-1">Timestamp</p>
                          <p className="text-xs font-mono text-white">{new Date(err.ts).toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-ghost-muted uppercase mb-1">Outcome</p>
                          <p className="text-xs font-mono text-red-400">{err.outcome}</p>
                        </div>
                      </div>
                      {err.note && (
                        <div>
                          <p className="text-[9px] text-ghost-muted uppercase mb-1">Details</p>
                          <pre className="text-[10px] text-ghost-muted/70 font-mono whitespace-pre-wrap bg-black/30 p-3 rounded-lg">
                            {err.note}
                          </pre>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Helm info */}
      <div className="mt-6 glass rounded-xl p-4 flex items-center gap-3"
           style={{ border: '1px solid rgba(0,212,255,0.08)' }}>
        <Zap size={14} className="text-ghost-accent shrink-0" />
        <p className="text-xs text-ghost-muted">
          <span className="text-white font-medium">Helm Agent</span> monitors all error events in real-time.
          Errors here are sourced directly from the live agent_logs database.
        </p>
      </div>
    </div>
  );
}
