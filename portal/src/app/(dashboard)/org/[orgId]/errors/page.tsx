'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, X, RefreshCw, Zap, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { formatRelative } from '@/lib/utils';

interface ErrorEntry {
  id:          string;
  source:      string;
  level:       string;
  message:     string;
  stack?:      string;
  resolved:    boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt:   string;
}

// Simulated errors for demo
const MOCK_ERRORS: ErrorEntry[] = [
  { id: '1', source: 'archivist', level: 'error', message: 'Pinecone upsert timeout after 30s', resolved: false, createdAt: new Date(Date.now()-300000).toISOString() },
  { id: '2', source: 'courier',   level: 'warn',  message: 'RESEND_API_KEY not configured — email delivery disabled', resolved: false, createdAt: new Date(Date.now()-600000).toISOString() },
  { id: '3', source: 'sentinel',  level: 'error', message: 'Discord rate limit hit: 429 Too Many Requests', resolved: true,  resolvedBy: 'helm', resolvedAt: new Date(Date.now()-120000).toISOString(), createdAt: new Date(Date.now()-900000).toISOString() },
  { id: '4', source: 'scout',     level: 'warn',  message: 'Grok API latency > 5000ms, consider fallback', resolved: false, createdAt: new Date(Date.now()-180000).toISOString() },
  { id: '5', source: 'codex',     level: 'error', message: 'qwen3:8b response timeout after 300s — escalated to Grok', resolved: true,  resolvedBy: 'codex', resolvedAt: new Date(Date.now()-60000).toISOString(), createdAt: new Date(Date.now()-1200000).toISOString() },
];

function LevelBadge({ level }: { level: string }) {
  const config: Record<string, { color: string; bg: string }> = {
    fatal: { color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
    error: { color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
    warn:  { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
    info:  { color: '#00D4FF', bg: 'rgba(0,212,255,0.08)' },
  };
  const c = config[level] ?? config.info;
  return (
    <span className="text-[9px] px-2 py-0.5 rounded-full uppercase font-mono font-bold tracking-wider"
          style={{ color: c.color, background: c.bg, border: `1px solid ${c.color}25` }}>
      {level}
    </span>
  );
}

export default function ErrorsPage() {
  const [errors,    setErrors]    = useState<ErrorEntry[]>(MOCK_ERRORS);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [filter,    setFilter]    = useState<'all' | 'open' | 'resolved'>('all');
  const [autoFix,   setAutoFix]   = useState(false);
  const [fixing,    setFixing]    = useState<string | null>(null);

  const filtered = errors.filter(e => {
    if (filter === 'open')     return !e.resolved;
    if (filter === 'resolved') return  e.resolved;
    return true;
  });

  const openCount = errors.filter(e => !e.resolved).length;

  async function handleAutoFix(err: ErrorEntry) {
    setFixing(err.id);
    await new Promise(r => setTimeout(r, 2000));
    setErrors(prev => prev.map(e =>
      e.id === err.id
        ? { ...e, resolved: true, resolvedBy: 'helm (auto)', resolvedAt: new Date().toISOString() }
        : e
    ));
    setFixing(null);
  }

  async function handleResolve(id: string) {
    setErrors(prev => prev.map(e =>
      e.id === id
        ? { ...e, resolved: true, resolvedBy: 'admin', resolvedAt: new Date().toISOString() }
        : e
    ));
  }

  return (
    <div className="p-6 max-w-screen-xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <AlertTriangle size={16} className={openCount > 0 ? 'text-red-400' : 'text-green-400'} />
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Error Console</h2>
            {openCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-mono text-red-400"
                    style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                {openCount} open
              </span>
            )}
          </div>
          <p className="text-xs text-ghost-muted">Real-time error monitoring with AI-powered auto-fix</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-fix toggle */}
          <button
            onClick={() => setAutoFix(!autoFix)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              autoFix
                ? 'text-green-400 bg-green-400/10 border-green-400/25'
                : 'text-ghost-muted hover:text-white bg-white/5 border-white/08'
            } border`}
          >
            <Zap size={12} />
            Auto-Fix {autoFix ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => setErrors(MOCK_ERRORS)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
            style={{ border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 mb-4">
        {(['all', 'open', 'resolved'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
              filter === f ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted hover:text-white hover:bg-white/5'
            }`}
          >
            {f} {f === 'open' ? `(${openCount})` : ''}
          </button>
        ))}
      </div>

      {/* Error list */}
      {openCount === 0 && filter !== 'resolved' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass rounded-2xl p-12 text-center mb-4"
        >
          <CheckCircle2 size={32} className="text-green-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-white mb-1" style={{ fontFamily: 'Space Grotesk' }}>All Clear</p>
          <p className="text-xs text-ghost-muted">No open errors. System running nominally.</p>
        </motion.div>
      )}

      <div className="space-y-2">
        <AnimatePresence>
          {filtered.map((err, i) => (
            <motion.div
              key={err.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ delay: i * 0.04 }}
              className="glass rounded-xl overflow-hidden"
              style={{
                border: `1px solid ${err.resolved ? 'rgba(16,185,129,0.12)' : err.level === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.12)'}`,
                opacity: err.resolved ? 0.7 : 1,
              }}
            >
              <div
                className="flex items-center gap-4 p-4 cursor-pointer"
                onClick={() => setExpanded(expanded === err.id ? null : err.id)}
              >
                {/* Level + source */}
                <LevelBadge level={err.level} />
                <span className="text-[10px] font-mono px-2 py-0.5 rounded text-ghost-muted/70"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {err.source}
                </span>

                {/* Message */}
                <p className="flex-1 text-xs text-white truncate">{err.message}</p>

                {/* Time + resolved */}
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[10px] text-ghost-muted font-mono">{formatRelative(err.createdAt)}</span>
                  {err.resolved && (
                    <span className="text-[10px] text-green-400 flex items-center gap-1">
                      <CheckCircle2 size={11} /> {err.resolvedBy}
                    </span>
                  )}
                  {!err.resolved && (
                    <div className="flex items-center gap-1.5">
                      {fixing === err.id ? (
                        <RefreshCw size={12} className="text-ghost-accent animate-spin" />
                      ) : (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAutoFix(err); }}
                            className="px-2 py-0.5 rounded text-[10px] text-ghost-accent hover:bg-ghost-accent/10 transition-all font-medium"
                            title="Let Helm agent auto-fix this"
                          >
                            Auto-Fix
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleResolve(err.id); }}
                            className="px-2 py-0.5 rounded text-[10px] text-ghost-muted hover:text-white transition-all"
                          >
                            Resolve
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {expanded === err.id ? <ChevronUp size={13} className="text-ghost-muted" /> : <ChevronDown size={13} className="text-ghost-muted" />}
                </div>
              </div>

              {/* Expanded: stack trace */}
              <AnimatePresence>
                {expanded === err.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <div className="p-4 space-y-2">
                      <p className="text-[10px] text-ghost-muted uppercase tracking-wider">Details</p>
                      {err.stack ? (
                        <pre className="text-[10px] text-ghost-muted/70 font-mono whitespace-pre-wrap bg-black/30 p-3 rounded-lg overflow-x-auto">
                          {err.stack}
                        </pre>
                      ) : (
                        <p className="text-xs text-ghost-muted/50 italic">No stack trace available</p>
                      )}
                      {err.resolved && (
                        <p className="text-[10px] text-green-400">
                          ✓ Resolved by {err.resolvedBy} · {err.resolvedAt ? formatRelative(err.resolvedAt) : ''}
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Auto-fix agent info */}
      <div className="mt-6 glass rounded-xl p-4 flex items-center gap-3"
           style={{ border: '1px solid rgba(0,212,255,0.08)' }}>
        <Zap size={14} className="text-ghost-accent shrink-0" />
        <p className="text-xs text-ghost-muted">
          <span className="text-white font-medium">Helm Agent</span> can automatically diagnose and resolve common errors.
          Enable Auto-Fix to have Helm respond to new errors in real-time.
        </p>
      </div>
    </div>
  );
}
