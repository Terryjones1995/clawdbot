'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScrollText, RefreshCw, Loader2, ChevronDown, ChevronUp, Search, User,
  ChevronLeft, ChevronRight, Clock, Bot, Cpu, Hash, FileText, Shield,
  CheckCircle2, XCircle, AlertTriangle,
} from 'lucide-react';
import { agentColor, agentEmoji, formatRelative } from '@/lib/utils';
import Image from 'next/image';

// ── Types ────────────────────────────────────────────────────────────────────

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

interface DiscordUser {
  id:       string;
  username: string | null;
  avatar:   string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const LEVEL_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  INFO:    { color: '#00D4FF', icon: CheckCircle2,  label: 'Info'    },
  WARN:    { color: '#F59E0B', icon: AlertTriangle,  label: 'Warning' },
  ERROR:   { color: '#EF4444', icon: XCircle,        label: 'Error'   },
  BLOCK:   { color: '#A855F7', icon: Shield,         label: 'Block'   },
  APPROVE: { color: '#10B981', icon: CheckCircle2,   label: 'Approve' },
  DENY:    { color: '#EF4444', icon: XCircle,        label: 'Deny'    },
};

const ACTION_LABELS: Record<string, string> = {
  'mention':          'Discord mention received',
  'mention-chat':     'Discord chat response',
  'mention-admin':    'Discord admin command',
  'chat':             'Chat conversation',
  'memory-hit':       'Memory recall',
  'answer':           'Knowledge answer',
  'research':         'Web research',
  'autofix-claude':   'Auto-fix (Claude CLI)',
  'autofix':          'Auto-fix (Codex)',
  'send-email':       'Email sent',
  'draft-email':      'Email drafted',
  'store':            'Memory stored',
  'retrieve':         'Memory retrieved',
  'classify':         'Intent classified',
  'daily_summary':    'Daily summary',
  'health-check':     'Health check',
  'restart':          'Service restart',
  'discord-admin':    'Discord admin action',
  'reception':        'Reception routing',
  'connect':          'Service connected',
  'discord-error':    'Discord error',
  'command-handler':  'Command handler',
  'switchboard-route':'Switchboard routing',
  'agent-route':      'Agent channel routing',
  'dm-reception':     'DM reception',
  'mention-handler':  'Mention handler',
};

const OUTCOME_LABELS: Record<string, string> = {
  'success':   'Success',
  'received':  'Received',
  'fixed':     'Fix applied',
  'no-fix':    'No fix found',
  'failed':    'Failed',
  'denied':    'Denied',
  'running':   'In progress',
  'working':   'Working',
  'sent':      'Sent',
  'drafted':   'Drafted',
  'stored':    'Stored',
  'completed': 'Completed',
  'queued':    'Queued',
};

function formatAction(action: string): string {
  return ACTION_LABELS[action] || action.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatOutcome(outcome: string): string {
  if (!outcome) return '';
  return OUTCOME_LABELS[outcome] || outcome.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractUserIds(logs: LogEntry[]): string[] {
  const ids = new Set<string>();
  for (const log of logs) {
    if (!log.note) continue;
    const match = log.note.match(/user=(\d{17,20})/);
    if (match) ids.add(match[1]);
  }
  return Array.from(ids);
}

function parseNote(
  note: string,
  action: string,
  users: Record<string, DiscordUser>,
): { summary: string; details: { label: string; value: string; avatar?: string }[]; userId?: string } {
  if (!note) return { summary: '', details: [] };

  const details: { label: string; value: string; avatar?: string }[] = [];
  const userMatch   = note.match(/user=(\d{17,20})/);
  const nameMatch   = note.match(/name=(\S+)/);
  const channelMatch= note.match(/channel=(\d+)/);
  const textMatch   = note.match(/text="([^"]*)"/);
  const fileMatch   = note.match(/file=(\S+)/);
  const qMatch      = note.match(/q="([^"]*)"/);
  const cmdMatch    = note.match(/cmd="([^"]*)"/);
  const msgMatch    = note.match(/msg="([^"]*)"/);
  const stackMatch  = note.match(/stack:\s*(.+)/);

  let summary = '';
  let userId: string | undefined;

  if (action.startsWith('mention') || action === 'dm-reception') {
    userId = userMatch?.[1];
    const resolved = userId ? users[userId] : undefined;
    const displayName = resolved?.username || nameMatch?.[1] || (userId ? `User ...${userId.slice(-4)}` : undefined);

    if (textMatch) {
      summary = textMatch[1].length > 140 ? textMatch[1].slice(0, 140) + '...' : textMatch[1];
    } else if (cmdMatch) {
      summary = cmdMatch[1].length > 140 ? cmdMatch[1].slice(0, 140) + '...' : cmdMatch[1];
    } else if (displayName) {
      summary = `Request from ${displayName}`;
    }
    if (displayName) details.push({ label: 'User', value: displayName, avatar: resolved?.avatar || undefined });
    if (channelMatch) details.push({ label: 'Channel', value: `#${channelMatch[1]}` });
  } else if (action === 'autofix-claude' || action === 'autofix') {
    if (fileMatch) {
      summary = `Target: ${fileMatch[1]}`;
      details.push({ label: 'File', value: fileMatch[1] });
    }
    const pipeIdx = note.indexOf('|');
    if (pipeIdx > -1) {
      const after = note.slice(pipeIdx + 1).trim();
      if (stackMatch) {
        summary += ` — ${after.replace(/stack:.*/, '').trim()}`;
      } else if (after) {
        summary += after.length > 100 ? ` — ${after.slice(0, 100)}...` : ` — ${after}`;
      }
    }
  } else if (action === 'chat' || action === 'memory-hit' || action === 'research') {
    if (msgMatch) {
      summary = msgMatch[1].length > 140 ? msgMatch[1].slice(0, 140) + '...' : msgMatch[1];
    } else if (qMatch) {
      summary = qMatch[1].length > 140 ? qMatch[1].slice(0, 140) + '...' : qMatch[1];
    } else {
      summary = note.length > 160 ? note.slice(0, 160) + '...' : note;
    }
    userId = userMatch?.[1];
  } else if (stackMatch) {
    // Error with stack trace — show the error message before the stack
    const pipeIdx = note.indexOf('|');
    summary = pipeIdx > -1 ? note.slice(0, pipeIdx).trim() : note.replace(/stack:.*/, '').trim();
    if (summary.length > 160) summary = summary.slice(0, 160) + '...';
  } else if (qMatch) {
    summary = qMatch[1];
  } else {
    summary = note.length > 160 ? note.slice(0, 160) + '...' : note;
    userId = userMatch?.[1];
  }

  return { summary, details, userId };
}

// ── Components ───────────────────────────────────────────────────────────────

function UserAvatar({ user, size = 20 }: { user?: DiscordUser; size?: number }) {
  if (!user?.avatar) {
    return (
      <div className="rounded-full bg-ghost-accent/20 flex items-center justify-center shrink-0"
           style={{ width: size, height: size }}>
        <User size={size * 0.55} className="text-ghost-accent/60" />
      </div>
    );
  }
  return (
    <Image src={user.avatar} alt={user.username || 'Discord user'}
           width={size} height={size} className="rounded-full shrink-0" unoptimized />
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


function LogRow({ log, users }: { log: LogEntry; users: Record<string, DiscordUser> }) {
  const [expanded, setExpanded] = useState(false);
  const levelCfg = LEVEL_CONFIG[log.level] ?? LEVEL_CONFIG.INFO;
  const LevelIcon = levelCfg.icon;
  const color = agentColor(log.agent);
  const { summary, details, userId } = parseNote(log.note || '', log.action, users);
  const resolvedUser = userId ? users[userId] : undefined;

  const outcomeColor =
    log.outcome === 'failed' || log.outcome === 'denied' ? '#EF4444' :
    log.outcome === 'success' || log.outcome === 'fixed' || log.outcome === 'sent' || log.outcome === 'completed' ? '#10B981' :
    log.outcome === 'running' || log.outcome === 'working' ? '#F59E0B' :
    '#64748B';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-xl overflow-hidden"
      style={{ border: `1px solid ${levelCfg.color}12`, borderLeft: `3px solid ${color}60` }}
    >
      <div className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 cursor-pointer hover:bg-white/[0.05] transition-colors"
           onClick={() => setExpanded(!expanded)}>
        <LevelIcon size={14} style={{ color: levelCfg.color }}  />

        {/* User avatar */}
        {resolvedUser && <UserAvatar user={resolvedUser} size={22} />}

        {/* Agent badge */}
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 hidden sm:flex items-center gap-1"
              style={{ color, background: `${color}12`, border: `1px solid ${color}20` }}>
          {agentEmoji(log.agent)} {log.agent}
        </span>

        {/* Action + summary */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] sm:text-xs font-medium text-white truncate">
            <span className="sm:hidden text-ghost-muted/60">{log.agent} &middot; </span>
            {formatAction(log.action)}
            {resolvedUser?.username && (
              <span className="text-ghost-accent/70 ml-1.5 font-normal">{resolvedUser.username}</span>
            )}
          </p>
          {summary && (
            <p className="text-[10px] text-ghost-muted/50 truncate mt-0.5">{summary}</p>
          )}
        </div>

        {/* Level badge */}
        <span className="text-[9px] font-mono px-1.5 sm:px-2 py-0.5 rounded-full capitalize shrink-0"
              style={{ color: levelCfg.color, background: `${levelCfg.color}12`, border: `1px solid ${levelCfg.color}20` }}>
          {levelCfg.label}
        </span>

        <span className="text-[9px] font-mono text-ghost-muted/40 hidden sm:inline shrink-0 min-w-16 text-right">
          {formatRelative(log.ts)}
        </span>
        {expanded
          ? <ChevronUp size={12} className="text-ghost-muted/50 shrink-0" />
          : <ChevronDown size={12} className="text-ghost-muted/50 shrink-0" />
        }
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
            className="overflow-hidden"
          >
            <div className="p-3 sm:p-4 space-y-3">
              {/* User card */}
              {resolvedUser?.username && (
                <div className="flex items-center gap-3 p-2.5 rounded-lg"
                     style={{ background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.1)' }}>
                  <UserAvatar user={resolvedUser} size={32} />
                  <div>
                    <p className="text-xs font-medium text-white">{resolvedUser.username}</p>
                    <p className="text-[9px] font-mono text-ghost-muted/40">ID: {resolvedUser.id}</p>
                  </div>
                </div>
              )}

              {/* Detail grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <DetailCell icon={Hash} label="Log ID" value={`#${log.id}`} />
                <DetailCell icon={Bot} label="Agent" value={log.agent} valueColor={color} />
                <DetailCell icon={Cpu} label="Model" value={log.model || 'Local / None'} />
                <DetailCell icon={Clock} label="Time" value={new Date(log.ts).toLocaleString()} />
              </div>

              {/* Outcome + Level + Role */}
              <div className="flex items-center gap-3 flex-wrap">
                {log.outcome && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-ghost-muted/50 uppercase tracking-wider">Outcome:</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded"
                          style={{ color: outcomeColor, background: `${outcomeColor}10` }}>
                      {formatOutcome(log.outcome)}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-ghost-muted/50 uppercase tracking-wider">Level:</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded"
                        style={{ color: levelCfg.color, background: `${levelCfg.color}10` }}>
                    {log.level}
                  </span>
                </div>
                {log.user_role && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-ghost-muted/50 uppercase tracking-wider">Role:</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded text-ghost-muted/60 bg-white/[0.03]">
                      {log.user_role}
                    </span>
                  </div>
                )}
              </div>

              {/* Parsed note details */}
              {details.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {details.map(d => (
                    <div key={d.label} className="flex items-center gap-1.5">
                      {d.avatar && (
                        <Image src={d.avatar} alt="" width={14} height={14} className="rounded-full" unoptimized />
                      )}
                      <span className="text-[9px] text-ghost-muted/50 uppercase tracking-wider">{d.label}:</span>
                      <span className="text-[10px] font-mono text-ghost-muted/70">{d.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Full note */}
              {summary && (
                <div>
                  <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <FileText size={9} /> Details
                  </p>
                  <p className="text-[10px] sm:text-[11px] font-mono text-ghost-muted/60 bg-white/[0.025] p-2.5 rounded-lg leading-relaxed break-all">
                    {summary}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}


// ── Page ─────────────────────────────────────────────────────────────────────

const AGENTS = ['All', 'Sentinel', 'Switchboard', 'Warden', 'Scout', 'Scribe', 'Forge', 'Lens', 'Courier', 'Archivist', 'Keeper', 'Ghost'];
const LEVELS = ['All', 'INFO', 'WARN', 'ERROR'];

export default function LogsPage() {
  const [logs,     setLogs]     = useState<LogEntry[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [agent,    setAgent]    = useState('All');
  const [level,    setLevel]    = useState('All');
  const [page,     setPage]     = useState(0);
  const [users,    setUsers]    = useState<Record<string, DiscordUser>>({});
  const resolvedIdsRef = useRef<Set<string>>(new Set());

  const resolveUsers = useCallback(async (logList: LogEntry[]) => {
    const ids = extractUserIds(logList).filter(id => !resolvedIdsRef.current.has(id));
    if (!ids.length) return;
    try {
      const res = await fetch(`/api/discord/users?ids=${ids.join(',')}`);
      const data = await res.json();
      if (data.users) {
        setUsers(prev => ({ ...prev, ...data.users }));
        ids.forEach(id => resolvedIdsRef.current.add(id));
      }
    } catch { /* non-fatal */ }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit:  String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (level !== 'All') params.set('level', level);
      if (agent !== 'All') params.set('agent', agent);
      const res  = await fetch(`/api/logs?${params}`);
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
        resolveUsers(data.logs);
      }
      if (data.total != null) setTotal(data.total);
    } catch { /* Ghost offline */ }
    finally { setLoading(false); }
  }, [level, agent, page, resolveUsers]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Reset page when filters change
  const handleAgent = (a: string) => { setAgent(a); setPage(0); };
  const handleLevel = (l: string) => { setLevel(l); setPage(0); };

  // Client-side search within current page
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = page * PAGE_SIZE + 1;
  const to   = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="p-3 sm:p-6 pb-24 md:pb-6 max-w-screen-xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ScrollText size={16} className="text-ghost-accent" />
            <h2 className="text-lg sm:text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Command Logs</h2>
          </div>
          <p className="text-[10px] sm:text-xs text-ghost-muted">
            {total.toLocaleString()} total entries &middot; Page {page + 1} of {totalPages}
          </p>
        </div>
        <button onClick={fetchLogs}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filters */}
      <div className="glass rounded-xl p-3 sm:p-4 mb-4 sm:mb-5 space-y-3" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost-muted/40" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg text-xs text-white placeholder-ghost-muted/30 outline-none transition-colors focus:ring-1 focus:ring-ghost-accent/30"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
          />
        </div>

        {/* Filter pills */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Agent filter */}
          <div className="flex-1">
            <span className="text-[9px] text-ghost-muted/40 uppercase tracking-wider block mb-1.5">Agent</span>
            <div className="flex flex-wrap gap-1">
              {AGENTS.map(a => {
                const ac = a === 'All' ? '#64748B' : agentColor(a);
                const isActive = agent === a;
                return (
                  <button key={a} onClick={() => handleAgent(a)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] sm:text-[10px] font-mono transition-all"
                    style={isActive
                      ? { color: ac, background: `${ac}15`, border: `1px solid ${ac}30` }
                      : { color: 'rgba(255,255,255,0.35)', background: 'transparent', border: '1px solid rgba(255,255,255,0.10)' }
                    }>
                    {a !== 'All' && <span className="text-[9px]">{agentEmoji(a)}</span>}
                    {a}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Level filter */}
          <div>
            <span className="text-[9px] text-ghost-muted/40 uppercase tracking-wider block mb-1.5">Level</span>
            <div className="flex gap-1">
              {LEVELS.map(l => {
                const lc = l === 'All' ? '#64748B' : (LEVEL_CONFIG[l]?.color ?? '#64748B');
                const isActive = level === l;
                return (
                  <button key={l} onClick={() => handleLevel(l)}
                    className="px-2.5 py-1 rounded-lg text-[9px] sm:text-[10px] font-mono transition-all"
                    style={isActive
                      ? { color: lc, background: `${lc}15`, border: `1px solid ${lc}30` }
                      : { color: 'rgba(255,255,255,0.35)', background: 'transparent', border: '1px solid rgba(255,255,255,0.10)' }
                    }>
                    {l}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Log list */}
      <div className="space-y-2 mb-4">
        {loading ? (
          <div className="glass rounded-2xl p-12 text-center" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
            <Loader2 size={20} className="text-ghost-accent animate-spin mx-auto mb-2" />
            <p className="text-xs text-ghost-muted">Loading logs...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
            <ScrollText size={24} className="text-ghost-muted/20 mx-auto mb-2" />
            <p className="text-xs text-ghost-muted/40">No log entries found</p>
          </div>
        ) : (
          filtered.map(log => <LogRow key={log.id} log={log} users={users} />)
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[10px] sm:text-xs text-ghost-muted/40 font-mono">
            Showing {from}–{to} of {total.toLocaleString()}
          </p>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="px-2 py-1.5 rounded-lg text-[10px] font-mono text-ghost-muted/50 hover:text-white hover:bg-white/5 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
              First
            </button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted/50 hover:text-white hover:bg-white/5 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
              <ChevronLeft size={14} />
            </button>

            {(() => {
              const pages: number[] = [];
              const start = Math.max(0, page - 2);
              const end = Math.min(totalPages - 1, page + 2);
              for (let i = start; i <= end; i++) pages.push(i);
              return pages.map(p => (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-[10px] sm:text-xs font-mono transition-all ${
                    p === page
                      ? 'text-ghost-accent bg-ghost-accent/15'
                      : 'text-ghost-muted/40 hover:text-white hover:bg-white/5'
                  }`}
                  style={{ border: p === page ? '1px solid rgba(0,212,255,0.2)' : '1px solid rgba(255,255,255,0.10)' }}>
                  {p + 1}
                </button>
              ));
            })()}

            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted/50 hover:text-white hover:bg-white/5 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
              <ChevronRight size={14} />
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              className="px-2 py-1.5 rounded-lg text-[10px] font-mono text-ghost-muted/50 hover:text-white hover:bg-white/5 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
