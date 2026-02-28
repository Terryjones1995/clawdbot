'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck,
  ChevronDown, ChevronUp, Loader2, Wrench, XCircle, AlertCircle,
} from 'lucide-react';
import { formatRelative } from '@/lib/utils';

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
  codex:       'src/codex.js',
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
  // Only repairs that happened AFTER this error
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ErrorsPage() {
  const [errors,     setErrors]     = useState<LogEntry[]>([]);
  const [warnings,   setWarnings]   = useState<LogEntry[]>([]);
  const [repairs,    setRepairs]    = useState<RepairEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState<Tab>('current');
  const [expanded,   setExpanded]   = useState<string | null>(null);
  const [fixing,     setFixing]     = useState<string | null>(null);
  const [fixResults, setFixResults] = useState<Record<string, FixResult>>({});

  const fetchData = useCallback(async () => {
    try {
      const [errRes, warnRes, repairRes] = await Promise.all([
        fetch('/api/errors?limit=50'),
        fetch('/api/logs?level=WARN&limit=50'),
        fetch('/api/logs?agent=Forge&action=autofix&limit=30'),
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

  const triggerAutoFix = useCallback(async (err: LogEntry) => {
    setFixing(err.id);
    setFixResults(prev => ({ ...prev, [err.id]: { status: 'pending', message: 'Sending to gpt-5.3-codex…' } }));
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
      setFixResults(prev => ({
        ...prev,
        [err.id]: {
          status:  data.fixed ? 'success' : 'fail',
          message: data.summary || data.error || 'Unknown response.',
        },
      }));
      // Refresh data so the error moves to the Fixed tab
      setTimeout(fetchData, 2500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      setFixResults(prev => ({ ...prev, [err.id]: { status: 'fail', message: msg } }));
    } finally {
      setFixing(null);
    }
  }, [fetchData]);

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

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1" style={{ fontFamily: 'Space Grotesk' }}>Error Console</h2>
          <p className="text-xs text-ghost-muted">Auto-repair via gpt-5.3-codex · refresh every 30s</p>
        </div>
        <button onClick={fetchData}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
          style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {tabItems.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              tab === t.key ? 'bg-white/8 text-white shadow-sm' : 'text-ghost-muted hover:text-white'
            }`}>
            <span style={{ color: tab === t.key ? t.color : undefined }}>{t.label}</span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md"
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
                  className="glass rounded-xl overflow-hidden"
                  style={{ border: `1px solid ${rowBorderColor(entry)}` }}>

                  {/* Row header — click to expand */}
                  <div className="flex items-center gap-3 p-4 cursor-pointer select-none"
                       onClick={() => setExpanded(isExpanded ? null : entry.id)}>
                    <LevelBadge level={entry.level} />
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded text-ghost-muted/70 shrink-0"
                          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      {entry.agent}
                    </span>
                    <p className="flex-1 text-xs text-white truncate min-w-0">
                      {entry.action} → {entry.outcome}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      {repairStatus && <StatusBadge status={repairStatus} />}
                      <span className="text-[10px] text-ghost-muted font-mono">{formatRelative(entry.ts)}</span>
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
                        <div className="p-4 space-y-3">

                          {/* Meta grid */}
                          <div className="grid grid-cols-2 gap-3">
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
                                  Automatically repaired by gpt-5.3-codex
                                  {getErrorFile(entry) && <span className="font-mono text-ghost-muted">({getErrorFile(entry)})</span>}
                                </div>
                              ) : (
                                <button
                                  onClick={() => triggerAutoFix(entry)}
                                  disabled={fixing === entry.id}
                                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-60"
                                  style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.25)', color: '#00D4FF' }}>
                                  {fixing === entry.id
                                    ? <><Loader2 size={12} className="animate-spin" /> Analyzing with gpt-5.3-codex…</>
                                    : <><Wrench size={12} /> Auto-Fix with gpt-5.3-codex</>}
                                </button>
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
      <div className="glass rounded-xl p-4 flex items-center gap-3"
           style={{ border: '1px solid rgba(0,212,255,0.08)' }}>
        <AlertTriangle size={13} className="text-ghost-accent shrink-0" />
        <p className="text-xs text-ghost-muted">
          <span className="text-white font-medium">Forge</span> watches all agent errors in real-time.
          Fixed files are patched by <span className="text-white font-medium">gpt-5.3-codex</span> and Ghost restarts automatically.
          Fixed errors move to the <span className="text-white font-medium">Fixed Errors</span> tab.
        </p>
      </div>

    </div>
  );
}
