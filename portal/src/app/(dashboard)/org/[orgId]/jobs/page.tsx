'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Briefcase, Clock, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { formatRelative } from '@/lib/utils';

interface Job {
  id:     string;
  agent:  string;
  action: string;
  status: 'running' | 'completed' | 'failed';
  model:  string;
  ts:     string;
  note:   string;
}

const STATUS_CONFIG: Record<Job['status'], { color: string; icon: any; label: string }> = {
  running:   { color: '#F59E0B', icon: Loader2,      label: 'Running'   },
  completed: { color: '#10B981', icon: CheckCircle2, label: 'Completed' },
  failed:    { color: '#EF4444', icon: XCircle,      label: 'Failed'    },
};

function JobRow({ job }: { job: Job }) {
  const [expanded, setExpanded] = useState(false);
  const cfg  = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.completed;
  const Icon = cfg.icon;

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
          <p className="text-xs font-mono text-white">{job.agent}.{job.action}</p>
          <p className="text-[10px] text-ghost-muted">{job.model}</p>
        </div>

        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full capitalize"
              style={{ color: cfg.color, background: `${cfg.color}15`, border: `1px solid ${cfg.color}25` }}>
          {cfg.label}
        </span>

        <span className="text-[10px] font-mono text-ghost-muted">{formatRelative(job.ts)}</span>
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
                <p className="text-xs font-mono text-white">#{job.id}</p>
              </div>
              <div>
                <p className="text-[9px] text-ghost-muted uppercase mb-1">Timestamp</p>
                <p className="text-xs font-mono text-white">{new Date(job.ts).toLocaleString()}</p>
              </div>
              {job.note && (
                <div className="col-span-2">
                  <p className="text-[9px] text-ghost-muted uppercase mb-1">Note</p>
                  <p className="text-xs font-mono text-ghost-muted/80 bg-white/[0.03] p-2 rounded-lg">{job.note}</p>
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
  const [jobs,    setJobs]    = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState<Job['status'] | 'all'>('all');

  const fetchJobs = useCallback(async () => {
    try {
      const res  = await fetch('/api/jobs?limit=50');
      const data = await res.json();
      if (data.jobs) setJobs(data.jobs);
    } catch { /* Ghost offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchJobs();
    const t = setInterval(fetchJobs, 30_000);
    return () => clearInterval(t);
  }, [fetchJobs]);

  const filtered = tab === 'all' ? jobs : jobs.filter(j => j.status === tab);
  const counts   = {
    all:       jobs.length,
    running:   jobs.filter(j => j.status === 'running').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed:    jobs.filter(j => j.status === 'failed').length,
  };

  const tabs: { key: Job['status'] | 'all'; label: string }[] = [
    { key: 'all',       label: `All (${counts.all})` },
    { key: 'running',   label: `Running (${counts.running})` },
    { key: 'completed', label: `Completed (${counts.completed})` },
    { key: 'failed',    label: `Failed (${counts.failed})` },
  ];

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Job Queue</h2>
          <p className="text-xs text-ghost-muted mt-0.5">Live agent activity from the last 50 operations</p>
        </div>
        <button onClick={fetchJobs}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === t.key ? 'text-ghost-accent bg-ghost-accent/15' : 'text-ghost-muted hover:text-white hover:bg-white/5'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Jobs */}
      <div className="space-y-2">
        {loading ? (
          <div className="glass rounded-2xl p-12 text-center">
            <Loader2 size={20} className="text-ghost-accent animate-spin mx-auto mb-2" />
            <p className="text-xs text-ghost-muted">Loading job history…</p>
          </div>
        ) : filtered.length === 0 ? (
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
