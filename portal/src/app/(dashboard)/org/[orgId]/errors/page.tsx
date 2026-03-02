'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck,
  ChevronDown, ChevronUp, Loader2, Terminal, XCircle, AlertCircle, Zap,
} from 'lucide-react';
import { formatRelative } from '@/lib/utils';
import { useGhostStore, ForgeProgressEvent } from '@/store';

// ── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
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
  id:      string;
  ts:      string;
  outcome: string;
  model?:  string;
  note?:   string;
}

interface FixResult {
  status:  'success' | 'fail' | 'pending';
  message: string;
}

type Tab = 'current' | 'fixed' | 'warnings';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Agent name → most likely source file (mirrors forge.js AGENT_FILE_MAP)
const AGENT_FILE_MAP: Record<string, string> = {
  sentinel:    'src/sentinel.js',
  scout:       'src/scout.js',
  scribe:      'src/scribe.js',
  forge:       'src/forge.js',
  helm:        'src/helm.js',
  lens:        'src/lens.js',
  keeper:      'src/keeper.js',
  warden:      'src/warden.js',
  archivist:   'src/archivist.js',
  courier:     'src/courier.js',
  ghost:       'src/routes/reception.js',
  switchboard: 'src/switchboard.js',
};

function extractFile(s = '') {
  const m = s.match(/(?:src|openclaw|portal)\/[\w/.-]+\.[jt]sx?/);
  return m ? m[0] : null;
}

function getErrorFile(err: LogEntry): string | null {
  return extractFile(err.note || '') ?? AGENT_FILE_MAP[err.agent.toLowerCase()] ?? null;
}

function getRepairStatus(err: LogEntry, repairs: RepairEntry[]): 'fixed' | 'failed' | null {
  const file    = getErrorFile(err);
  if (!file) return null;
  const errTime = new Date(err.ts).getTime();
  const matched = repairs.filter(r => extractFile(r.note || '') === file && new Date(r.ts).getTime() > errTime);
  if (matched.some(r => r.outcome === 'fixed'))  return 'fixed';
  if (matched.length > 0)                         return 'failed';
  return null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LevelBadge({ level }: { level: string }) {
  const map: Record<string, [string, string]> = {
    ERROR: ['#EF4444', 'rgba(239,68,68,0.1)'],
    WARN:  ['#F59E0B', 'rgba(245,158,11,0.1)'],
    INFO:  ['#00D4FF', 'rgba(0,212,255,0.08)'],
  };
  const [color, bg] = map[level] ?? map.INFO;
  return (
    <span className="text-[9px] px-2 py-0.5 rounded-full uppercase font-mono font-bold tracking-wider shrink-0"
          style={{ color, background: bg, border: `1px solid ${color}25` }}>
      {level}
    </span>
  );
}

function StatusBadge({ status }: { status: 'fixed' | 'failed' }) {
  const fixed = status === 'fixed';
  return (
    <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider shrink-0"
          style={{
            color:      fixed ? '#4ADE80' : '#F59E0B',
            background: fixed ? 'rgba(74,222,128,0.1)' : 'rgba(245,158,11,0.1)',
            border:     `1px solid ${fixed ? 'rgba(74,222,128,0.3)' : 'rgba(245,158,11,0.3)'}`,
          }}>
      {fixed ? <ShieldCheck size={9} /> : <XCircle size={9} />}
      {fixed ? 'Auto-Fixed' : 'Fix Failed'}
    </span>
  );
}

function FixResultBanner({ result }: { result: FixResult }) {
  const isSuccess = result.status === 'success';
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 p-3 rounded-xl mt-2"
      style={{
        background: isSuccess ? 'rgba(74,222,128,0.08)'  : 'rgba(239,68,68,0.08)',
        border:     `1px solid ${isSuccess ? 'rgba(74,222,128,0.25)' : 'rgba(239,68,68,0.2)'}`,
      }}>
      {isSuccess
        ? <CheckCircle2 size={14} className="text-green-400 shrink-0 mt-0.5" />
        : <XCircle      size={14} className="text-red-400 shrink-0 mt-0.5" />}
      <div>
        <p className={`text-xs font-semibold mb-0.5 ${isSuccess ? 'text-green-400' : 'text-red-400'}`}>
          {isSuccess ? 'Fix Applied' : 'Fix Failed'}
        </p>
        <p className="text-[10px] font-mono text-ghost-muted">{result.message}</p>
      </div>
    </motion.div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const messages: Record<Tab, { icon: React.ReactNode; title: string; sub: string }> = {
    current:  { icon: <CheckCircle2 size={32} className="text-green-400 mx-auto mb-3" />, title: 'All Clear', sub: 'No active errors.' },
    fixed:    { icon: <ShieldCheck  size={32} className="text-ghost-accent mx-auto mb-3" />, title: 'No Repairs Yet', sub: 'Auto-fixed errors will appear here.' },
    warnings: { icon: <AlertCircle  size={32} className="text-amber-400 mx-auto mb-3" />, title: 'No Warnings', sub: 'Warning-level log entries will appear here.' },
  };
  const { icon, title, sub } = messages[tab];
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      className="glass rounded-2xl p-12 text-center">
      {icon}
      <p className="text-sm font-semibold text-white mb-1" style={{ fontFamily: 'Space Grotesk' }}>{title}</p>
      <p className="text-xs text-ghost-muted">{sub}</p>
    </motion.div>
  );
}

// ── Fix All Progress Panel ────────────────────────────────────────────────────

interface FixAllItem {
  errorId: string;
  agent:   string;
  file:    string;
  status:  'pending' | 'running' | 'fixed' | 'failed';
  summary?: string;
}

function FixAllProgressPanel({ progress }: { progress: ForgeProgressEvent | null }) {
  const [items, setItems] = useState<FixAllItem[]>([]);
  const [done, setDone]   = useState(false);
  const [restartMsg, setRestartMsg] = useState('');

  useEffect(() => {
    if (!progress) return;

    if (progress.type === 'fix-all:start' && progress.total) {
      setItems([]);
      setDone(false);
      setRestartMsg('');
    }

    if (progress.type === 'fix-all:item-start' && progress.errorId) {
      setItems(prev => {
        const exists = prev.some(i => i.errorId === progress.errorId);
        const item: FixAllItem = {
          errorId: progress.errorId!,
          agent:   progress.agent || '',
          file:    progress.file  || '',
          status:  'running',
        };
        return exists
          ? prev.map(i => i.errorId === progress.errorId ? item : i)
          : [...prev, item];
      });
    }

    if (progress.type === 'fix-all:item-done' && progress.errorId) {
      setItems(prev => prev.map(i =>
        i.errorId === progress.errorId
          ? { ...i, status: progress.fixed ? 'fixed' : 'failed', summary: progress.summary }
          : i
      ));
    }

    if (progress.type === 'fix-all:complete') {
      setDone(true);
      setRestartMsg(progress.restartMsg || '');
    }
  }, [progress]);

  if (items.length === 0 && !done) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-4 space-y-3"
      style={{ background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.15)' }}>

      <div className="flex items-center gap-2">
        {done
          ? <CheckCircle2 size={14} className="text-green-400" />
          : <Loader2 size={14} className="text-ghost-accent animate-spin" />}
        <p className="text-xs font-semibold text-white">
          {done ? `Fix All complete — ${items.filter(i => i.status === 'fixed').length}/${items.length} fixed` : `Fixing ${items.length} error${items.length !== 1 ? 's' : ''}…`}
        </p>
      </div>

      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map(item => (
            <div key={item.errorId} className="flex items-start gap-2">
              {item.status === 'running'
                ? <Loader2 size={11} className="text-ghost-accent animate-spin mt-0.5 shrink-0" />
                : item.status === 'fixed'
                  ? <CheckCircle2 size={11} className="text-green-400 mt-0.5 shrink-0" />
                  : <XCircle size={11} className="text-red-400 mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <p className="text-[10px] font-mono text-white truncate">
                  {item.file || item.agent || item.errorId}
                </p>
                {item.summary && (
                  <p className="text-[9px] text-ghost-muted truncate">{item.summary}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {done && restartMsg && (
        <p className="text-[10px] font-mono text-ghost-muted">{restartMsg}</p>
      )}
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ErrorsPage() {
  const [errors,        setErrors]        = useState<LogEntry[]>([]);
  const [warnings,      setWarnings]      = useState<LogEntry[]>([]);
  const [repairs,       setRepairs]       = useState<RepairEntry[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [tab,           setTab]           = useState<Tab>('current');
  const [expanded,      setExpanded]      = useState<string | null>(null);
  const [fixing,        setFixing]        = useState<string | null>(null);
  const [fixResults,    setFixResults]    = useState<Record<string, FixResult>>({});
  const [fixAllRunning, setFixAllRunning] = useState(false);
  const [marking,       setMarking]       = useState<string | null>(null);

  const progress = useGhostStore(s => s.forgeProgress);

  const fetchData = useCallback(async () => {
    try {
      const [errRes, warnRes, repairRes] = await Promise.all([
        fetch('/api/errors?limit=50'),
        fetch('/api/logs?level=WARN&limit=50'),
        fetch('/api/logs?agent=Forge&action=autofix-claude&limit=30'),
      ]);
      const [errData, warnData, repairData] = await Promise.all([
        errRes.json(), warnRes.json(), repairRes.json(),
      ]);
      if (errData.errors)   setErrors(errData.errors);
      if (warnData.logs)    setWarnings(warnData.logs);
      if (repairData.logs)  setRepairs(repairData.logs);
    } catch { /* Ghost offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30_000);
    return () => clearInterval(t);
  }, [fetchData]);

  // Watch forge:progress events from WS
  useEffect(() => {
    if (progress?.type === 'fix-all:complete') {
      setFixAllRunning(false);
      setTimeout(fetchData, 2000); // refresh after restart
    }
    if (progress?.type === 'fix-one:complete' && progress.errorId) {
      setFixResults(prev => ({
        ...prev,
        [progress.errorId!]: {
          status:  progress.fixed ? 'success' : 'fail',
          message: progress.summary || '',
        },
      }));
      setFixing(prev => prev === progress.errorId ? null : prev);
      if (progress.fixed) setTimeout(fetchData, 2000);
    }
  }, [progress, fetchData]);

  const markFixed = useCallback(async (err: LogEntry) => {
    const file = getErrorFile(err);
    setMarking(err.id);
    try {
      await fetch('/api/errors', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filePath: file, agentName: err.agent }),
      });
      setTimeout(fetchData, 500);
    } catch { /* silently fail */ }
    finally { setMarking(null); }
  }, [fetchData]);

  const triggerFixOne = useCallback(async (err: LogEntry) => {
    setFixing(err.id);
    setFixResults(prev => ({ ...prev, [err.id]: { status: 'pending', message: '' } }));
    try {
      await fetch('/api/forge/fix-one', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          errorId:   err.id,
          errorNote: err.note || `${err.action}: ${err.outcome}`,
          agentName: err.agent,
        }),
      });
      // Don't clear fixing here — WS fix-one:complete clears it
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      setFixResults(prev => ({ ...prev, [err.id]: { status: 'fail', message: msg } }));
      setFixing(null);
    }
  }, []);

  const triggerFixAll = useCallback(async () => {
    if (fixAllRunning) return;
    setFixAllRunning(true);

    const payload = currentErrors.map(e => ({
      id:        e.id,
      errorNote: e.note || `${e.action}: ${e.outcome}`,
      agentName: e.agent,
    }));

    try {
      await fetch('/api/forge/fix-all', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ errors: payload }),
      });
      // Progress comes via WS; setFixAllRunning(false) when fix-all:complete arrives
    } catch {
      setFixAllRunning(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixAllRunning]);

  // Partition errors into current vs fixed
  const currentErrors = errors.filter(e => getRepairStatus(e, repairs) !== 'fixed');
  const fixedErrors   = errors.filter(e => getRepairStatus(e, repairs) === 'fixed');

  const tabItems: { key: Tab; label: string; count: number; color: string }[] = [
    { key: 'current',  label: 'Current Errors', count: currentErrors.length, color: currentErrors.length > 0 ? '#EF4444' : '#4ADE80' },
    { key: 'fixed',    label: 'Fixed Errors',   count: fixedErrors.length,   color: '#4ADE80' },
    { key: 'warnings', label: 'Warnings',        count: warnings.length,      color: '#F59E0B' },
  ];

  const activeList = tab === 'current' ? currentErrors : tab === 'fixed' ? fixedErrors : warnings;

  function rowBorderColor(entry: LogEntry): string {
    const status = getRepairStatus(entry, repairs);
    if (status === 'fixed')          return 'rgba(74,222,128,0.2)';
    if (entry.level === 'ERROR')     return 'rgba(239,68,68,0.15)';
    return 'rgba(245,158,11,0.12)';
  }

  const showProgressPanel = fixAllRunning || (progress?.type?.startsWith('fix-all:') ?? false);

  return (
    <div className="p-3 sm:p-6 max-w-screen-xl mx-auto space-y-4 sm:space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={16} className="text-red-400" />
            <h2 className="text-lg sm:text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Error Console</h2>
          </div>
          <p className="text-[10px] sm:text-xs text-ghost-muted">Claude Code CLI · real-time via WebSocket</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Fix All button */}
          <button
            onClick={triggerFixAll}
            disabled={fixAllRunning || currentErrors.length === 0}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.3)', color: '#00D4FF' }}>
            {fixAllRunning
              ? <><Loader2 size={12} className="animate-spin" /> Fixing…</>
              : <><Zap size={12} /> <span className="hidden sm:inline">Fix All Errors</span><span className="sm:hidden">Fix All</span> ({currentErrors.length})</>}
          </button>

          {/* Refresh */}
          <button onClick={fetchData}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
            style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Fix All progress panel */}
      {showProgressPanel && <FixAllProgressPanel progress={progress} />}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {tabItems.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-lg text-[10px] sm:text-xs font-medium transition-all whitespace-nowrap ${
              tab === t.key ? 'bg-white/8 text-white shadow-sm' : 'text-ghost-muted hover:text-white'
            }`}>
            <span style={{ color: tab === t.key ? t.color : undefined }}>{t.label}</span>
            <span className="font-mono text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded-md"
                  style={{
                    background: `${t.color}18`,
                    color: t.color,
                    border: `1px solid ${t.color}30`,
                  }}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="glass rounded-2xl p-12 text-center">
          <Loader2 size={20} className="text-ghost-accent animate-spin mx-auto mb-2" />
          <p className="text-xs text-ghost-muted">Loading…</p>
        </div>
      ) : activeList.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {activeList.map((entry, i) => {
              const repairStatus = getRepairStatus(entry, repairs);
              const fixResult    = fixResults[entry.id];
              const isExpanded   = expanded === entry.id;

              return (
                <motion.div key={entry.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: i * 0.03 }}
                  className="glass rounded-xl overflow-hidden row-strip"
                  style={{ border: `1px solid ${rowBorderColor(entry)}`, '--strip-color': entry.level === 'ERROR' ? '#EF4444' : entry.level === 'WARN' ? '#F59E0B' : '#00D4FF' } as React.CSSProperties}>

                  {/* Row header — click to expand */}
                  <div className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 cursor-pointer select-none"
                       onClick={() => setExpanded(isExpanded ? null : entry.id)}>
                    <LevelBadge level={entry.level} />
                    <span className="text-[9px] sm:text-[10px] font-mono px-1.5 py-0.5 rounded text-ghost-muted/70 shrink-0 hidden sm:inline"
                          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      {entry.agent}
                    </span>
                    <p className="flex-1 text-[10px] sm:text-xs text-white truncate min-w-0">
                      {entry.action} → {entry.outcome}
                    </p>
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                      {repairStatus && <span className="hidden sm:flex"><StatusBadge status={repairStatus} /></span>}
                      <span className="text-[9px] sm:text-[10px] text-ghost-muted font-mono hidden sm:inline">{formatRelative(entry.ts)}</span>
                      {isExpanded ? <ChevronUp size={13} className="text-ghost-muted" /> : <ChevronDown size={13} className="text-ghost-muted" />}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="p-3 sm:p-4 space-y-3">

                          {/* Meta grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                            <div>
                              <p className="text-[9px] text-ghost-muted uppercase mb-1">Agent</p>
                              <p className="text-xs font-mono text-white">{entry.agent}</p>
                            </div>
                            <div>
                              <p className="text-[9px] text-ghost-muted uppercase mb-1">Timestamp</p>
                              <p className="text-xs font-mono text-white">{new Date(entry.ts).toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-[9px] text-ghost-muted uppercase mb-1">Action</p>
                              <p className="text-xs font-mono text-white">{entry.action}</p>
                            </div>
                            <div>
                              <p className="text-[9px] text-ghost-muted uppercase mb-1">Outcome</p>
                              <p className="text-xs font-mono text-red-400">{entry.outcome}</p>
                            </div>
                          </div>

                          {/* Error note */}
                          {entry.note && (
                            <div>
                              <p className="text-[9px] text-ghost-muted uppercase mb-1">Error Details</p>
                              <pre className="text-[10px] text-ghost-muted/80 font-mono whitespace-pre-wrap bg-black/30 p-3 rounded-lg leading-relaxed">
                                {entry.note}
                              </pre>
                            </div>
                          )}

                          {/* Fix button / fixed message */}
                          {entry.level === 'ERROR' && (
                            <div>
                              {repairStatus === 'fixed' ? (
                                <div className="flex items-center gap-2 text-xs text-green-400 py-1">
                                  <ShieldCheck size={13} />
                                  Repaired
                                  {getErrorFile(entry) && <span className="font-mono text-ghost-muted">({getErrorFile(entry)})</span>}
                                </div>
                              ) : (
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                  <button
                                    onClick={() => triggerFixOne(entry)}
                                    disabled={fixing === entry.id}
                                    className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-semibold transition-all disabled:opacity-60"
                                    style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.25)', color: '#00D4FF' }}>
                                    {fixing === entry.id
                                      ? <><Loader2 size={12} className="animate-spin" /> Analyzing…</>
                                      : <><Terminal size={12} /> Fix with Claude Code</>}
                                  </button>
                                  <button
                                    onClick={() => markFixed(entry)}
                                    disabled={marking === entry.id}
                                    className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-semibold transition-all disabled:opacity-60"
                                    style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ADE80' }}>
                                    {marking === entry.id
                                      ? <><Loader2 size={12} className="animate-spin" /> Marking…</>
                                      : <><CheckCircle2 size={12} /> Mark Fixed</>}
                                  </button>
                                </div>
                              )}

                              {/* Fix result banner */}
                              {fixResult && fixResult.status !== 'pending' && (
                                <FixResultBanner result={fixResult} />
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
      )}

      {/* Footer */}
      <div className="glass rounded-xl p-3 sm:p-4 flex items-start sm:items-center gap-2 sm:gap-3"
           style={{ border: '1px solid rgba(0,212,255,0.08)' }}>
        <AlertTriangle size={13} className="text-ghost-accent shrink-0 mt-0.5 sm:mt-0" />
        <p className="text-[10px] sm:text-xs text-ghost-muted">
          <span className="text-white font-medium">Forge</span> watches all agent errors in real-time.
          Fixed files are patched by <span className="text-white font-medium">Claude Code CLI</span> and Ghost restarts automatically.
          Use <span className="text-white font-medium">Fix All Errors</span> to repair all current errors sequentially with live WS progress.
          Fixed errors move to the <span className="text-white font-medium">Fixed Errors</span> tab.
        </p>
      </div>

    </div>
  );
}
