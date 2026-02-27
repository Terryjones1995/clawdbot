'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollText, RefreshCw, Loader2, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { formatRelative } from '@/lib/utils';

interface LogEntry {
  id:        string;
  ts:        string;
  level:     string;
  agent:     string;
  action:    string;
  outcome:   string;
  model?:    string;
  user_role?: string;
  note?:     string;
}

const LEVEL_COLORS: Record<string, { color: string; bg: string }> = {
  INFO:  { color: '#00D4FF', bg: 'rgba(0,212,255,0.08)'  },
  WARN:  { color: '#F59E0B', bg: 'rgba(245,158,11,0.10)' },
  ERROR: { color: '#EF4444', bg: 'rgba(239,68,68,0.10)'  },
  BLOCK: { color: '#A855F7', bg: 'rgba(168,85,247,0.10)' },
  APPROVE: { color: '#10B981', bg: 'rgba(16,185,129,0.10)' },
  DENY:  { color: '#EF4444', bg: 'rgba(239,68,68,0.10)'  },
};

function LevelBadge({ level }: { level: string }) {
  const c = LEVEL_COLORS[level] ?? LEVEL_COLORS.INFO;
  return (
    <span className="shrink-0 text-[9px] px-2 py-0.5 rounded-full uppercase font-mono font-bold tracking-wider"
          style={{ color: c.color, background: c.bg, border: `1px solid ${c.color}25` }}>
      {level}
    </span>
  );
}

const AGENTS = ['All', 'Sentinel', 'Switchboard', 'Warden', 'Scout', 'Scribe', 'Forge', 'Lens', 'Courier', 'Archivist', 'Keeper'];
const LEVELS = ['All', 'INFO', 'WARN', 'ERROR', 'BLOCK', 'APPROVE', 'DENY'];

export default function LogsPage() {
  const [logs,     setLogs]     = useState<LogEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search,   setSearch]   = useState('');
  const [agent,    setAgent]    = useState('All');
  const [level,    setLevel]    = useState('All');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (level !== 'All') params.set('level', level);
      if (agent !== 'All') params.set('agent', agent);
      const res  = await fetch(`/api/logs?${params}`);
      const data = await res.json();
      if (data.logs) setLogs(data.logs);
    } catch { /* Ghost offline */ }
    finally { setLoading(false); }
  }, [level, agent]);

  useEffect(() => {
    fetchLogs();
    const t = setInterval(fetchLogs, 30_000);
    return () => clearInterval(t);
  }, [fetchLogs]);

  const filtered = logs.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.agent?.toLowerCase().includes(q)  ||
      l.action?.toLowerCase().includes(q) ||
      l.outcome?.toLowerCase().includes(q)||
      l.note?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 max-w-screen-xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <ScrollText size={16} className="text-ghost-accent" />
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Command Logs</h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-mono text-ghost-accent"
                  style={{ background: 'rgba(0,212,255,0.10)', border: '1px solid rgba(0,212,255,0.2)' }}>
              {logs.length} entries
            </span>
          </div>
          <p className="text-xs text-ghost-muted">Live agent audit trail · auto-refresh 30s</p>
        </div>
        <button onClick={fetchLogs}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
          style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filters */}
      <div className="glass rounded-xl p-4 mb-5 space-y-3" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost-muted" />
          <input
            type="text"
            placeholder="Search logs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg text-xs text-white placeholder-ghost-muted/50 outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          />
        </div>
        {/* Agent + Level filters */}
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ghost-muted uppercase tracking-wider">Agent</span>
            <div className="flex flex-wrap gap-1">
              {AGENTS.map(a => (
                <button key={a} onClick={() => setAgent(a)}
                  className={`px-2 py-1 rounded-md text-[10px] font-mono transition-all ${
                    agent === a ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted hover:text-white hover:bg-white/5'
                  }`}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ghost-muted uppercase tracking-wider">Level</span>
            <div className="flex flex-wrap gap-1">
              {LEVELS.map(l => (
                <button key={l} onClick={() => setLevel(l)}
                  className={`px-2 py-1 rounded-md text-[10px] font-mono transition-all ${
                    level === l ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted hover:text-white hover:bg-white/5'
                  }`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Log list */}
      {loading ? (
        <div className="glass rounded-2xl p-12 text-center">
          <Loader2 size={20} className="text-ghost-accent animate-spin mx-auto mb-2" />
          <p className="text-xs text-ghost-muted">Loading logs…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <ScrollText size={24} className="text-ghost-muted/30 mx-auto mb-2" />
          <p className="text-xs text-ghost-muted/40">No log entries found</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <AnimatePresence>
            {filtered.map((log, i) => (
              <motion.div key={log.id}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.3) }}
                className="glass rounded-xl overflow-hidden"
                style={{ border: '1px solid rgba(255,255,255,0.05)' }}>

                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                     onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                  <LevelBadge level={log.level} />
                  <span className="text-[10px] font-mono text-ghost-accent/70 shrink-0 w-20 truncate">{log.agent}</span>
                  <p className="flex-1 text-xs text-white/80 truncate font-mono">
                    {log.action}
                    {log.outcome ? <span className="text-ghost-muted"> → {log.outcome}</span> : ''}
                  </p>
                  <span className="text-[10px] text-ghost-muted font-mono shrink-0">{formatRelative(log.ts)}</span>
                  {expanded === log.id
                    ? <ChevronUp size={12} className="text-ghost-muted shrink-0" />
                    : <ChevronDown size={12} className="text-ghost-muted shrink-0" />}
                </div>

                <AnimatePresence>
                  {expanded === log.id && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} className="overflow-hidden"
                      style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <div className="px-4 py-3 grid grid-cols-3 gap-3">
                        <div>
                          <p className="text-[9px] text-ghost-muted uppercase mb-1">Model</p>
                          <p className="text-xs font-mono text-white">{log.model || 'n/a'}</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-ghost-muted uppercase mb-1">Role</p>
                          <p className="text-xs font-mono text-white">{log.user_role || 'n/a'}</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-ghost-muted uppercase mb-1">Timestamp</p>
                          <p className="text-xs font-mono text-white">{new Date(log.ts).toLocaleString()}</p>
                        </div>
                        {log.note && (
                          <div className="col-span-3">
                            <p className="text-[9px] text-ghost-muted uppercase mb-1">Note</p>
                            <pre className="text-[10px] text-ghost-muted/70 font-mono whitespace-pre-wrap bg-black/30 p-3 rounded-lg">
                              {log.note}
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
      )}
    </div>
  );
}
