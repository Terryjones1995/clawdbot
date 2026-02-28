'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CheckCircle2, RefreshCw, Zap,
  ChevronDown, ChevronUp, Loader2, Wrench, ShieldCheck, XCircle,
} from 'lucide-react';
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

interface RepairEntry {
  id:       string;
  ts:       string;
  outcome:  string;   // 'fixed' | 'no-fix'
  model?:   string;
  note?:    string;   // contains "file=src/xxx.js"
}

// Extract first JS/TS file path from a string
function extractFile(s = '') {
  const m = s.match(/(?:src|openclaw|portal)\/[\w/.-]+\.[jt]sx?/);
  return m ? m[0] : null;
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

function RepairBadge({ outcome }: { outcome: string }) {
  const fixed = outcome === 'fixed';
  return (
    <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider"
          style={{
            color:      fixed ? '#4ADE80' : '#F59E0B',
            background: fixed ? 'rgba(74,222,128,0.1)' : 'rgba(245,158,11,0.1)',
            border:     `1px solid ${fixed ? 'rgba(74,222,128,0.25)' : 'rgba(245,158,11,0.25)'}`,
          }}>
      {fixed ? <ShieldCheck size={9} /> : <XCircle size={9} />}
      {fixed ? 'Auto-Fixed' : 'Fix Failed'}
    </span>
  );
}

export default function ErrorsPage() {
  const [errors,    setErrors]    = useState<ErrorEntry[]>([]);
  const [repairs,   setRepairs]   = useState<RepairEntry[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [filter,    setFilter]    = useState<'all' | 'error' | 'warn'>('all');
  const [fixing,    setFixing]    = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    try {
      const [errRes, repairRes] = await Promise.all([
        fetch('/api/errors?limit=50'),
        fetch('/api/logs?agent=Forge&action=autofix&limit=30'),
      ]);
      const [errData, repairData] = await Promise.all([errRes.json(), repairRes.json()]);
      if (errData.errors)    setErrors(errData.errors);
      if (repairData.logs)   setRepairs(repairData.logs);
    } catch { /* Ghost offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30_000);
    return () => clearInterval(t);
  }, [fetchData]);

  const triggerAutoFix = useCallback(async (err: ErrorEntry) => {
    setFixing(err.id);
    setFixResult(prev => ({ ...prev, [err.id]: '' }));
    try {
      const res  = await fetch('/api/forge/autofix', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          errorNote: err.note || `${err.action}: ${err.outcome}`,
          agentName: err.agent,
        }),
      });
      const data = await res.json();
      setFixResult(prev => ({ ...prev, [err.id]: data.summary || data.error || 'Done.' }));
      // Refresh to pick up new repair log entry
      setTimeout(fetchData, 2000);
    } catch {
      setFixResult(prev => ({ ...prev, [err.id]: 'Request failed — Ghost offline?' }));
    } finally {
      setFixing(null);
    }
  }, [fetchData]);

  // Build a set of files that have been fixed, for badge matching
  const fixedFiles = new Set(repairs.filter(r => r.outcome === 'fixed').map(r => extractFile(r.note || '')).filter(Boolean));
  const failedFiles = new Set(repairs.filter(r => r.outcome !== 'fixed').map(r => extractFile(r.note || '')).filter(Boolean));

  function repairStatusForError(err: ErrorEntry): 'fixed' | 'failed' | null {
    const f = extractFile(err.note || '');
    if (!f) return null;
    if (fixedFiles.has(f))  return 'fixed';
    if (failedFiles.has(f)) return 'failed';
    return null;
  }

  const filtered = errors.filter(e => {
    if (filter === 'error') return e.level === 'ERROR';
    if (filter === 'warn')  return e.level === 'WARN';
    return true;
  });

  const errorCount = errors.filter(e => e.level === 'ERROR').length;
  const fixedCount = repairs.filter(r => r.outcome === 'fixed').length;

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
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
            {fixedCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-mono text-green-400"
                    style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)' }}>
                {fixedCount} auto-fixed
              </span>
            )}
          </div>
          <p className="text-xs text-ghost-muted">Real-time error monitoring · auto-refresh 30s · auto-repair via gpt-5.3-codex</p>
        </div>
        <button onClick={fetchData}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
          style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Auto-Repair History */}
      {repairs.length > 0 && (
        <div className="glass rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(74,222,128,0.15)' }}>
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <ShieldCheck size={13} className="text-green-400" />
            <span className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>Auto-Repair Log</span>
            <span className="text-[10px] text-ghost-muted ml-auto font-mono">gpt-5.3-codex</span>
          </div>
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            {repairs.slice(0, 8).map(r => {
              const file    = extractFile(r.note || '') ?? '—';
              const fixed   = r.outcome === 'fixed';
              return (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  {fixed
                    ? <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                    : <XCircle      size={12} className="text-amber-400 shrink-0" />}
                  <span className="text-[10px] font-mono text-white flex-1 truncate">{file}</span>
                  <span className="text-[10px] font-mono text-ghost-muted shrink-0">{formatRelative(r.ts)}</span>
                  <RepairBadge outcome={r.outcome} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1">
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
        <div className="glass rounded-2xl p-12 text-center">
          <Loader2 size={20} className="text-ghost-accent animate-spin mx-auto mb-2" />
          <p className="text-xs text-ghost-muted">Loading errors…</p>
        </div>
      ) : errorCount === 0 && filter !== 'warn' && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="glass rounded-2xl p-12 text-center">
          <CheckCircle2 size={32} className="text-green-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-white mb-1" style={{ fontFamily: 'Space Grotesk' }}>All Clear</p>
          <p className="text-xs text-ghost-muted">No errors in recent logs.</p>
        </motion.div>
      )}

      {/* Error list */}
      <div className="space-y-2">
        <AnimatePresence>
          {filtered.map((err, i) => {
            const repairStatus = repairStatusForError(err);
            return (
              <motion.div key={err.id}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }}
                transition={{ delay: i * 0.04 }}
                className="glass rounded-xl overflow-hidden"
                style={{ border: `1px solid ${
                  repairStatus === 'fixed'  ? 'rgba(74,222,128,0.2)'  :
                  err.level === 'ERROR'     ? 'rgba(239,68,68,0.15)'  :
                                              'rgba(245,158,11,0.12)'
                }` }}>

                <div className="flex items-center gap-3 p-4 cursor-pointer"
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

                  <div className="flex items-center gap-2 shrink-0">
                    {repairStatus && <RepairBadge outcome={repairStatus} />}
                    <span className="text-[10px] text-ghost-muted font-mono">{formatRelative(err.ts)}</span>
                    {expanded === err.id ? <ChevronUp size={13} className="text-ghost-muted" /> : <ChevronDown size={13} className="text-ghost-muted" />}
                  </div>
                </div>

                <AnimatePresence>
                  {expanded === err.id && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} className="overflow-hidden"
                      style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <div className="p-4 space-y-3">
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
                            <p className="text-[9px] text-ghost-muted uppercase mb-1">Error Details</p>
                            <pre className="text-[10px] text-ghost-muted/70 font-mono whitespace-pre-wrap bg-black/30 p-3 rounded-lg">
                              {err.note}
                            </pre>
                          </div>
                        )}
                        {err.level === 'ERROR' && (
                          <div className="flex items-center gap-3 pt-1">
                            {repairStatus === 'fixed' ? (
                              <div className="flex items-center gap-2 text-xs text-green-400">
                                <ShieldCheck size={12} />
                                This error was automatically repaired by gpt-5.3-codex.
                              </div>
                            ) : (
                              <button
                                onClick={() => triggerAutoFix(err)}
                                disabled={fixing === err.id}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                                style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.2)', color: '#00D4FF' }}>
                                {fixing === err.id
                                  ? <><Loader2 size={11} className="animate-spin" /> Fixing…</>
                                  : <><Wrench size={11} /> Auto-Fix with gpt-5.3-codex</>}
                              </button>
                            )}
                            {fixResult[err.id] && (
                              <span className={`text-[10px] font-mono ${fixResult[err.id].startsWith('Fixed') ? 'text-green-400' : 'text-red-400'}`}>
                                {fixResult[err.id]}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="glass rounded-xl p-4 flex items-center gap-3"
           style={{ border: '1px solid rgba(0,212,255,0.08)' }}>
        <Zap size={14} className="text-ghost-accent shrink-0" />
        <p className="text-xs text-ghost-muted">
          <span className="text-white font-medium">Forge</span> monitors errors in real-time and auto-repairs broken files using{' '}
          <span className="text-white font-medium">gpt-5.3-codex</span>. Fixed files are patched and Ghost restarts automatically.
        </p>
      </div>

    </div>
  );
}
