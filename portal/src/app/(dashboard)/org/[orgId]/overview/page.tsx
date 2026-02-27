'use client';

import { motion } from 'framer-motion';
import { useGhostStore } from '@/store';
import { agentColor, agentEmoji, formatRelative, statusColor } from '@/lib/utils';
import { AgentState } from '@/store';
import {
  Activity, Zap, AlertTriangle, Clock,
  Server, ArrowUpRight, FileText, Loader2,
} from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.07 } } },
  item:      { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4 } } },
};

function KpiCard({ label, value, sub, icon: Icon, color, trend }: {
  label: string; value: string | number; sub?: string;
  icon: any; color: string; trend?: string;
}) {
  return (
    <motion.div variants={stagger.item}
      whileHover={{ y: -2, boxShadow: `0 8px 30px ${color}20` }}
      className="glass rounded-2xl p-5 relative overflow-hidden cursor-default"
      style={{ border: `1px solid ${color}20` }}
    >
      <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
           style={{ background: `linear-gradient(90deg, transparent, ${color}80, transparent)` }} />
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
             style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
          <Icon size={16} style={{ color }} />
        </div>
        {trend && (
          <span className="text-[10px] font-mono text-green-400 flex items-center gap-0.5">
            <ArrowUpRight size={10} />{trend}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>{value}</p>
      <p className="text-xs text-ghost-muted mt-1">{label}</p>
      {sub && <p className="text-[10px] text-ghost-muted/50 mt-0.5">{sub}</p>}
    </motion.div>
  );
}

function AgentCard({ agent }: { agent: AgentState }) {
  const color     = agentColor(agent.id);
  const lastEvent = agent.events[agent.events.length - 1];

  return (
    <motion.div variants={stagger.item} whileHover={{ scale: 1.01 }}
      className="glass glass-hover rounded-xl p-4 flex items-center gap-3 cursor-pointer"
      style={{ border: 'rgba(255,255,255,0.06) solid 1px' }}>
      <div className="relative shrink-0">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
             style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
          {agentEmoji(agent.id)}
        </div>
        <span className={`status-dot absolute -bottom-0.5 -right-0.5 w-2 h-2 ${agent.status}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>{agent.name}</p>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full capitalize font-mono"
                style={{ background: `${statusColor(agent.status)}18`, color: statusColor(agent.status), border: `1px solid ${statusColor(agent.status)}30` }}>
            {agent.status}
          </span>
        </div>
        <p className="text-[10px] text-ghost-muted truncate">{agent.role}</p>
      </div>
      {lastEvent && (
        <p className="text-[9px] text-ghost-muted/40 truncate max-w-[100px] hidden lg:block">
          {formatRelative(lastEvent.ts)}
        </p>
      )}
    </motion.div>
  );
}

function ActivityFeed() {
  const { agents } = useGhostStore();
  const events = Object.values(agents)
    .flatMap(a => a.events.map(e => ({ ...e, agentName: a.name, agentId: a.id })))
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 20);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-ghost-muted/40">
        <Activity size={20} className="mb-2" />
        <p className="text-xs">Waiting for activity...</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {events.map((e, i) => (
        <motion.div key={`${e.agentId}-${e.ts}-${i}`}
          initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.03 }}
          className="flex items-start gap-3 py-1.5 px-2 rounded-lg hover:bg-white/[0.03] transition-all">
          <span className="text-base shrink-0">{agentEmoji(e.agentId)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium" style={{ color: agentColor(e.agentId) }}>{e.agentName}</span>
              <span className="text-[9px] text-ghost-muted/40 font-mono">{formatRelative(e.ts)}</span>
            </div>
            <p className="text-[11px] text-ghost-muted truncate">{e.message}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function DailyBrief() {
  const [brief,   setBrief]   = useState<string | null>(null);
  const [stats,   setStats]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [ts,      setTs]      = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res  = await fetch('/api/brief');
      const data = await res.json();
      setBrief(data.briefing || null);
      setStats(data.stats || null);
      setTs(data.ts || null);
    } catch { /* Ghost offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  return (
    <div className="glass rounded-2xl p-5" style={{ border: '1px solid rgba(0,212,255,0.08)' }}>
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk' }}>
        <FileText size={14} className="text-ghost-accent" />
        Daily Brief
        {ts && <span className="text-[9px] font-mono text-ghost-muted/40 ml-auto">{new Date(ts).toLocaleTimeString()}</span>}
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-ghost-muted/40 py-4">
          <Loader2 size={13} className="animate-spin" />
          <span className="text-xs">Loading brief...</span>
        </div>
      ) : brief ? (
        <div>
          <p className="text-xs text-ghost-muted leading-relaxed whitespace-pre-wrap">{brief}</p>
          {stats && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {Object.entries(stats as Record<string, number>).slice(0, 6).map(([k, v]) => (
                <div key={k} className="bg-white/[0.03] rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-ghost-accent" style={{ fontFamily: 'Space Grotesk' }}>{v}</p>
                  <p className="text-[9px] text-ghost-muted capitalize">{k.replace(/_/g, ' ')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-ghost-muted/40 italic">No briefing available. Ghost may be offline.</p>
      )}
    </div>
  );
}

export default function OverviewPage() {
  const { agents, wsConnected } = useGhostStore();
  const [uptime,        setUptime]        = useState('--:--:--');
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [tasksToday,    setTasksToday]    = useState<number | null>(null);
  const [errorsToday,   setErrorsToday]   = useState<number | null>(null);

  // Fetch real server uptime
  useEffect(() => {
    async function fetchUptime() {
      try {
        const r = await fetch('/api/heartbeat');
        if (r.ok) {
          const d = await r.json();
          setUptimeSeconds(d.uptime_seconds ?? 0);
        }
      } catch { /* Ghost may be offline */ }
    }
    fetchUptime();
    const poll = setInterval(fetchUptime, 30_000);
    return () => clearInterval(poll);
  }, []);

  // Fetch today's job/error counts
  useEffect(() => {
    async function fetchCounts() {
      try {
        const [jobsRes, errRes] = await Promise.all([
          fetch('/api/jobs?limit=200'),
          fetch('/api/errors?limit=50'),
        ]);
        if (jobsRes.ok) {
          const d = await jobsRes.json();
          setTasksToday(d.total ?? 0);
        }
        if (errRes.ok) {
          const d = await errRes.json();
          setErrorsToday(d.total ?? 0);
        }
      } catch { /* Ghost offline */ }
    }
    fetchCounts();
    const t = setInterval(fetchCounts, 60_000);
    return () => clearInterval(t);
  }, []);

  // Tick uptime every second
  useEffect(() => {
    if (uptimeSeconds === 0) return;
    let s = uptimeSeconds;
    const t = setInterval(() => {
      s += 1;
      const h   = Math.floor(s / 3600);
      const m   = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      setUptime(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`);
    }, 1000);
    return () => clearInterval(t);
  }, [uptimeSeconds]);

  const agentList    = Object.values(agents);
  const onlineCount  = agentList.filter(a => a.status !== 'offline').length;
  const workingCount = agentList.filter(a => a.status === 'working').length;

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <span className={`status-dot ${wsConnected ? 'online' : 'offline'}`} />
          <p className="text-xs text-ghost-muted tracking-wider uppercase font-mono">
            {wsConnected ? 'Live · All systems nominal' : 'Offline · Reconnecting...'}
          </p>
        </div>
        <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>System Overview</h2>
        <p className="text-xs text-ghost-muted mt-0.5">Operation Ghost · Mission Control Center</p>
      </motion.div>

      {/* KPI row */}
      <motion.div variants={stagger.container} initial="initial" animate="animate"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Agents Online"  value={onlineCount}               sub={`of ${agentList.length} total`} icon={Zap}           color="#00D4FF" />
        <KpiCard label="Active Now"     value={workingCount}              sub="processing tasks"               icon={Activity}      color="#F59E0B" />
        <KpiCard label="Tasks Today"    value={tasksToday ?? '…'}         sub="from agent_logs"                icon={Server}        color="#10B981" />
        <KpiCard label="Server Uptime"  value={uptime}                    sub="Ghost gateway"                  icon={Clock}         color="#7C3AED" />
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Agent grid */}
        <div className="xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>Agent Network</h3>
            <span className="text-xs text-ghost-muted font-mono">{agentList.length} agents</span>
          </div>
          <motion.div variants={stagger.container} initial="initial" animate="animate"
            className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {agentList.map(agent => <AgentCard key={agent.id} agent={agent} />)}
          </motion.div>

          {/* Live activity feed */}
          <div className="glass rounded-2xl p-5 mt-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk' }}>
              <Activity size={14} className="text-ghost-accent" />
              Live Activity
            </h3>
            <div className="max-h-48 overflow-y-auto">
              <ActivityFeed />
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">

          {/* System health */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk' }}>
              <Server size={14} className="text-ghost-accent" />
              System Health
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Ghost Gateway',   status: wsConnected,       detail: 'port 18789' },
                { label: 'OpenAI (mini)',   status: true,              detail: 'gpt-4o-mini' },
                { label: 'Grok',           status: true,              detail: 'web research' },
                { label: 'Pinecone Memory',status: true,              detail: 'AWS us-east-1' },
                { label: 'Neon Database',  status: true,              detail: 'PostgreSQL' },
                { label: 'Discord Bot',    status: onlineCount > 0,   detail: 'Ghost#6982' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`status-dot w-1.5 h-1.5 ${item.status ? 'online' : 'error'}`} />
                    <span className="text-xs text-ghost-muted">{item.label}</span>
                  </div>
                  <span className="text-[10px] font-mono text-ghost-muted/50">{item.detail}</span>
                </div>
              ))}
              {errorsToday !== null && errorsToday > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={11} className="text-red-400" />
                    <span className="text-xs text-red-400/80">Errors today</span>
                  </div>
                  <span className="text-[10px] font-mono text-red-400">{errorsToday}</span>
                </div>
              )}
            </div>
          </div>

          {/* Daily brief */}
          <DailyBrief />

        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between text-[10px] text-ghost-muted/30 font-mono">
        <span>Operation Ghost · Mission Control</span>
        <span>v2.0 · {new Date().getFullYear()}</span>
      </div>
    </div>
  );
}
