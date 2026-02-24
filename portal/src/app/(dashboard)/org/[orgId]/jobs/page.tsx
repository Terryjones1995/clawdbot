'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Briefcase, Clock, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { formatRelative, formatDuration } from '@/lib/utils';

interface Job {
  id:         string;
  type:       string;
  status:     'queued' | 'running' | 'completed' | 'failed';
  priority:   number;
  agentId?:   string;
  createdAt:  string;
  startedAt?: string;
  finishedAt?: string;
  error?:     string;
}

const MOCK_JOBS: Job[] = [
  { id: 'j1', type: 'scout.research',     status: 'running',   priority: 8, agentId: 'scout',  createdAt: new Date(Date.now()-120000).toISOString(), startedAt: new Date(Date.now()-100000).toISOString() },
  { id: 'j2', type: 'codex.answer',       status: 'running',   priority: 7, agentId: 'codex',  createdAt: new Date(Date.now()-60000).toISOString(),  startedAt: new Date(Date.now()-55000).toISOString() },
  { id: 'j3', type: 'scribe.summary',     status: 'queued',    priority: 5, createdAt: new Date(Date.now()-30000).toISOString() },
  { id: 'j4', type: 'forge.codereview',   status: 'queued',    priority: 6, createdAt: new Date(Date.now()-15000).toISOString() },
  { id: 'j5', type: 'courier.send_email', status: 'completed', priority: 9, agentId: 'courier', createdAt: new Date(Date.now()-600000).toISOString(), startedAt: new Date(Date.now()-598000).toISOString(), finishedAt: new Date(Date.now()-595000).toISOString() },
  { id: 'j6', type: 'archivist.store',    status: 'completed', priority: 5, agentId: 'archivist', createdAt: new Date(Date.now()-900000).toISOString(), startedAt: new Date(Date.now()-899000).toISOString(), finishedAt: new Date(Date.now()-896000).toISOString() },
  { id: 'j7', type: 'scout.research',     status: 'failed',    priority: 7, agentId: 'scout',  createdAt: new Date(Date.now()-1800000).toISOString(), startedAt: new Date(Date.now()-1798000).toISOString(), finishedAt: new Date(Date.now()-1790000).toISOString(), error: 'Grok API timeout after 30s' },
];

const STATUS_CONFIG: Record<Job['status'], { color: string; icon: any; label: string }> = {
  queued:    { color: '#64748B', icon: Clock,        label: 'Queued'    },
  running:   { color: '#F59E0B', icon: Loader2,      label: 'Running'   },
  completed: { color: '#10B981', icon: CheckCircle2, label: 'Completed' },
  failed:    { color: '#EF4444', icon: XCircle,      label: 'Failed'    },
};

function JobRow({ job }: { job: Job }) {
  const [expanded, setExpanded] = useState(false);
  const cfg  = STATUS_CONFIG[job.status];
  const Icon = cfg.icon;
  const runtime = job.startedAt && job.finishedAt
    ? formatDuration(new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime())
    : job.startedAt
    ? formatDuration(Date.now() - new Date(job.startedAt).getTime())
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-xl overflow-hidden"
      style={{ border: `1px solid ${cfg.color}15` }}
    >
      <div className="flex items-center gap-4 p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <Icon size={15} style={{ color: cfg.color }} className={job.status === 'running' ? 'animate-spin' : ''} />

        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-white">{job.type}</p>
          <p className="text-[10px] text-ghost-muted">{job.agentId ?? 'unassigned'} · priority {job.priority}</p>
        </div>

        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full capitalize"
              style={{ color: cfg.color, background: `${cfg.color}15`, border: `1px solid ${cfg.color}25` }}>
          {cfg.label}
        </span>

        {runtime && <span className="text-[10px] font-mono text-ghost-muted">{runtime}</span>}
        <span className="text-[10px] font-mono text-ghost-muted">{formatRelative(job.createdAt)}</span>
        {expanded ? <ChevronUp size={12} className="text-ghost-muted" /> : <ChevronDown size={12} className="text-ghost-muted" />}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
            className="overflow-hidden"
          >
            <div className="p-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[9px] text-ghost-muted uppercase mb-1">Job ID</p>
                <p className="text-xs font-mono text-white">{job.id}</p>
              </div>
              <div>
                <p className="text-[9px] text-ghost-muted uppercase mb-1">Created</p>
                <p className="text-xs font-mono text-white">{new Date(job.createdAt).toLocaleString()}</p>
              </div>
              {job.error && (
                <div className="col-span-2">
                  <p className="text-[9px] text-red-400 uppercase mb-1">Error</p>
                  <p className="text-xs font-mono text-red-400/80 bg-red-500/5 p-2 rounded-lg">{job.error}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function JobsPage() {
  const [jobs] = useState<Job[]>(MOCK_JOBS);
  const [tab,  setTab] = useState<Job['status'] | 'all'>('all');

  const tabs: { key: Job['status'] | 'all'; label: string }[] = [
    { key: 'all',       label: `All (${jobs.length})` },
    { key: 'running',   label: `Running (${jobs.filter(j => j.status === 'running').length})` },
    { key: 'queued',    label: `Queued (${jobs.filter(j => j.status === 'queued').length})` },
    { key: 'completed', label: `Completed (${jobs.filter(j => j.status === 'completed').length})` },
    { key: 'failed',    label: `Failed (${jobs.filter(j => j.status === 'failed').length})` },
  ];

  const filtered = tab === 'all' ? jobs : jobs.filter(j => j.status === tab);

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Job Queue</h2>
          <p className="text-xs text-ghost-muted mt-0.5">All agent tasks and their execution status</p>
        </div>
        <button className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === t.key ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted hover:text-white hover:bg-white/5'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Jobs */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center">
            <Briefcase size={24} className="text-ghost-muted/40 mx-auto mb-2" />
            <p className="text-xs text-ghost-muted/40">No jobs in this queue</p>
          </div>
        ) : (
          filtered.map(job => <JobRow key={job.id} job={job} />)
        )}
      </div>
    </div>
  );
}
