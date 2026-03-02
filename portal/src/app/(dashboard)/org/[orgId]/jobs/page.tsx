'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Briefcase, Clock, CheckCircle2, XCircle, Loader2,
  ChevronDown, ChevronUp, RefreshCw, ChevronLeft, ChevronRight,
  Bot, Hash, FileText, Cpu, User,
} from 'lucide-react';
import { agentColor, agentEmoji, formatRelative } from '@/lib/utils';
import Image from 'next/image';

interface Job {
  id:      string;
  agent:   string;
  action:  string;
  outcome: string;
  level:   string;
  status:  'running' | 'completed' | 'failed';
  model:   string | null;
  ts:      string;
  note:    string;
}

interface DiscordUser {
  id:       string;
  username: string | null;
  avatar:   string | null;
}

const PAGE_SIZE = 10;

const STATUS_CONFIG: Record<Job['status'], { color: string; icon: any; label: string }> = {
  running:   { color: '#F59E0B', icon: Loader2,      label: 'Running'   },
  completed: { color: '#10B981', icon: CheckCircle2, label: 'Completed' },
  failed:    { color: '#EF4444', icon: XCircle,      label: 'Failed'    },
};

// ── Human-readable labels ────────────────────────────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  'mention':         'Discord mention received',
  'mention-chat':    'Discord chat response',
  'mention-admin':   'Discord admin command',
  'chat':            'Chat conversation',
  'memory-hit':      'Memory recall',
  'answer':          'Knowledge answer',
  'research':        'Web research',
  'autofix-claude':  'Auto-fix (Claude CLI)',
  'autofix':         'Auto-fix (Codex)',
  'send-email':      'Email sent',
  'draft-email':     'Email drafted',
  'store':           'Memory stored',
  'retrieve':        'Memory retrieved',
  'classify':        'Intent classified',
  'daily_summary':   'Daily summary',
  'health-check':    'Health check',
  'restart':         'Service restart',
  'discord-admin':   'Discord admin action',
  'reception':       'Reception routing',
};

const OUTCOME_LABELS: Record<string, string> = {
  'success':    'Completed successfully',
  'received':   'Received',
  'fixed':      'Fix applied',
  'no-fix':     'No fix found',
  'failed':     'Failed',
  'denied':     'Denied',
  'running':    'In progress',
  'working':    'Working',
  'sent':       'Sent',
  'drafted':    'Drafted',
  'stored':     'Stored',
  'completed':  'Completed',
  'queued':     'Queued',
};

function formatAction(action: string): string {
  return ACTION_LABELS[action] || action.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatOutcome(outcome: string): string {
  return OUTCOME_LABELS[outcome] || outcome.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Extract all Discord user IDs from a list of job notes */
function extractUserIds(jobs: Job[]): string[] {
  const ids = new Set<string>();
  for (const job of jobs) {
    if (!job.note) continue;
    const match = job.note.match(/user=(\d{17,20})/);
    if (match) ids.add(match[1]);
  }
  return Array.from(ids);
}

/** Parse the raw note string into structured human-readable pieces */
function parseNote(
  note: string,
  action: string,
  users: Record<string, DiscordUser>,
): { summary: string; details: { label: string; value: string; avatar?: string }[]; userId?: string } {
  if (!note) return { summary: '', details: [] };

  const details: { label: string; value: string; avatar?: string }[] = [];

  // Extract known key=value pairs
  const userMatch = note.match(/user=(\d{17,20})/);
  const nameMatch = note.match(/name=(\S+)/);
  const channelMatch = note.match(/channel=(\d+)/);
  const textMatch = note.match(/text="([^"]*)"/);
  const fileMatch = note.match(/file=(\S+)/);
  const qMatch = note.match(/q="([^"]*)"/);
  const cmdMatch = note.match(/cmd="([^"]*)"/);
  const msgMatch = note.match(/msg="([^"]*)"/);

  let summary = '';
  let userId: string | undefined;

  if (action === 'mention' || action === 'mention-chat' || action === 'mention-admin') {
    userId = userMatch?.[1];
    const resolved = userId ? users[userId] : undefined;
    const displayName = resolved?.username || nameMatch?.[1] || (userId ? `User ${userId.slice(-4)}` : undefined);

    if (textMatch) {
      summary = textMatch[1].length > 120 ? textMatch[1].slice(0, 120) + '...' : textMatch[1];
    } else if (cmdMatch) {
      summary = cmdMatch[1].length > 120 ? cmdMatch[1].slice(0, 120) + '...' : cmdMatch[1];
    } else if (displayName) {
      summary = `Processed request from ${displayName}`;
    }
    if (displayName) {
      details.push({ label: 'User', value: displayName, avatar: resolved?.avatar || undefined });
    }
    if (channelMatch) details.push({ label: 'Channel', value: `#${channelMatch[1]}` });
  } else if (action === 'autofix-claude' || action === 'autofix') {
    if (fileMatch) {
      summary = `Target: ${fileMatch[1]}`;
      details.push({ label: 'File', value: fileMatch[1] });
    }
    const pipeIdx = note.indexOf('|');
    if (pipeIdx > -1) {
      const afterPipe = note.slice(pipeIdx + 1).trim();
      if (afterPipe) {
        summary += afterPipe.length > 100 ? ` — ${afterPipe.slice(0, 100)}...` : ` — ${afterPipe}`;
      }
    }
  } else if (action === 'chat' || action === 'memory-hit') {
    if (msgMatch) {
      summary = msgMatch[1].length > 120 ? msgMatch[1].slice(0, 120) + '...' : msgMatch[1];
    } else if (qMatch) {
      summary = qMatch[1];
    } else {
      summary = note.length > 160 ? note.slice(0, 160) + '...' : note;
    }
  } else if (qMatch) {
    summary = qMatch[1];
  } else {
    summary = note.length > 160 ? note.slice(0, 160) + '...' : note;
  }

  return { summary, details, userId };
}


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
    <Image
      src={user.avatar}
      alt={user.username || 'Discord user'}
      width={size}
      height={size}
      className="rounded-full shrink-0"
      unoptimized
    />
  );
}


function JobRow({ job, users }: { job: Job; users: Record<string, DiscordUser> }) {
  const [expanded, setExpanded] = useState(false);
  const cfg  = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.completed;
  const Icon = cfg.icon;
  const color = agentColor(job.agent);
  const { summary, details, userId } = parseNote(job.note, job.action, users);
  const resolvedUser = userId ? users[userId] : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-xl overflow-hidden"
      style={{ border: `1px solid ${cfg.color}12`, borderLeft: `3px solid ${color}60` }}
    >
      <div className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 cursor-pointer hover:bg-white/[0.05] transition-colors"
           onClick={() => setExpanded(!expanded)}>
        <Icon size={14} style={{ color: cfg.color }} className={job.status === 'running' ? 'animate-spin' : ''} />

        {/* User avatar (for mention actions) */}
        {resolvedUser && (
          <UserAvatar user={resolvedUser} size={22} />
        )}

        {/* Agent badge */}
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 hidden sm:flex items-center gap-1"
              style={{ color, background: `${color}12`, border: `1px solid ${color}20` }}>
          {agentEmoji(job.agent)} {job.agent}
        </span>

        {/* Action + summary */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] sm:text-xs font-medium text-white truncate">
            <span className="sm:hidden text-ghost-muted/60">{job.agent} &middot; </span>
            {formatAction(job.action)}
            {resolvedUser?.username && (
              <span className="text-ghost-accent/70 ml-1.5 font-normal">
                {resolvedUser.username}
              </span>
            )}
          </p>
          {summary && (
            <p className="text-[10px] text-ghost-muted/50 truncate mt-0.5">{summary}</p>
          )}
        </div>

        {/* Status badge */}
        <span className="text-[9px] font-mono px-1.5 sm:px-2 py-0.5 rounded-full capitalize shrink-0"
              style={{ color: cfg.color, background: `${cfg.color}12`, border: `1px solid ${cfg.color}20` }}>
          {cfg.label}
        </span>

        <span className="text-[9px] font-mono text-ghost-muted/40 hidden sm:inline shrink-0 min-w-16 text-right">
          {formatRelative(job.ts)}
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
              {/* User card (if resolved) */}
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
                <DetailCell icon={Hash} label="Job ID" value={`#${job.id}`} />
                <DetailCell icon={Bot} label="Agent" value={job.agent} valueColor={color} />
                <DetailCell icon={Cpu} label="Model" value={job.model || 'Local / None'} />
                <DetailCell icon={Clock} label="Time" value={new Date(job.ts).toLocaleString()} />
              </div>

              {/* Outcome row */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-ghost-muted/50 uppercase tracking-wider">Outcome:</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded"
                        style={{ color: cfg.color, background: `${cfg.color}08` }}>
                    {formatOutcome(job.outcome)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-ghost-muted/50 uppercase tracking-wider">Level:</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                    job.level === 'ERROR' ? 'text-red-400 bg-red-400/10' :
                    job.level === 'WARN'  ? 'text-yellow-400 bg-yellow-400/10' :
                                            'text-ghost-muted/60 bg-white/[0.03]'
                  }`}>
                    {job.level}
                  </span>
                </div>
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


export default function JobsPage() {
  const [jobs,    setJobs]    = useState<Job[]>([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(0);
  const [tab,     setTab]     = useState<Job['status'] | 'all'>('all');
  const [users,   setUsers]   = useState<Record<string, DiscordUser>>({});
  const resolvedIdsRef = useRef<Set<string>>(new Set());

  // Resolve Discord user IDs → usernames + avatars
  const resolveUsers = useCallback(async (jobList: Job[]) => {
    const ids = extractUserIds(jobList).filter(id => !resolvedIdsRef.current.has(id));
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

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit:  String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (tab !== 'all') params.set('status', tab);

      const res  = await fetch(`/api/jobs?${params.toString()}`);
      const data = await res.json();
      if (data.jobs) {
        setJobs(data.jobs);
        resolveUsers(data.jobs);
      }
      if (data.total != null) setTotal(data.total);
    } catch { /* Ghost offline */ }
    finally { setLoading(false); }
  }, [page, tab, resolveUsers]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // Reset page when tab changes
  const handleTab = (t: Job['status'] | 'all') => {
    setTab(t);
    setPage(0);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = page * PAGE_SIZE + 1;
  const to   = Math.min((page + 1) * PAGE_SIZE, total);

  const tabs: { key: Job['status'] | 'all'; label: string; icon: any }[] = [
    { key: 'all',       label: 'All',       icon: Briefcase    },
    { key: 'running',   label: 'Running',   icon: Loader2      },
    { key: 'completed', label: 'Done',      icon: CheckCircle2 },
    { key: 'failed',    label: 'Failed',    icon: XCircle      },
  ];

  return (
    <div className="p-3 sm:p-6 pb-24 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Briefcase size={16} className="text-ghost-accent" />
            <h2 className="text-lg sm:text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Job Queue</h2>
          </div>
          <p className="text-[10px] sm:text-xs text-ghost-muted">
            {total.toLocaleString()} total jobs &middot; Page {page + 1} of {totalPages}
          </p>
        </div>
        <button onClick={fetchJobs}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 sm:mb-5 p-1 rounded-xl w-fit" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}>
        {tabs.map(t => {
          const TIcon = t.icon;
          return (
            <button key={t.key} onClick={() => handleTab(t.key)}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-medium transition-all whitespace-nowrap ${
                tab === t.key ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted/50 hover:text-white hover:bg-white/5'
              }`}>
              <TIcon size={11} className={t.key === 'running' && tab === t.key ? 'animate-spin' : ''} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Jobs list */}
      <div className="space-y-2 mb-4">
        {loading ? (
          <div className="glass rounded-2xl p-12 text-center" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
            <Loader2 size={20} className="text-ghost-accent animate-spin mx-auto mb-2" />
            <p className="text-xs text-ghost-muted">Loading jobs...</p>
          </div>
        ) : jobs.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
            <Briefcase size={24} className="text-ghost-muted/20 mx-auto mb-2" />
            <p className="text-xs text-ghost-muted/40">No jobs found</p>
          </div>
        ) : (
          jobs.map(job => <JobRow key={job.id} job={job} users={users} />)
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

            {/* Page numbers */}
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
