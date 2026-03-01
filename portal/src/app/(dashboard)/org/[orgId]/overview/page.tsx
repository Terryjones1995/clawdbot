'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useGhostStore } from '@/store';
import { agentColor, agentEmoji, formatRelative, statusColor } from '@/lib/utils';
import { AgentState } from '@/store';
import {
  Activity, Zap, AlertTriangle, Clock, Server, FileText,
  Loader2, Wifi, WifiOff, Database, Bot, Cpu, Radio,
  ChevronRight, TrendingUp, Shield, MemoryStick, Globe,
} from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';

// ── Animations ────────────────────────────────────────────────────────────────

const fade = {
  hidden:  { opacity: 0, y: 12 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay: i * 0.06 } }),
} as const;

// ── Live Clock ────────────────────────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    function tick() {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false }));
      setDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
    }
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="text-right hidden sm:block">
      <p className="text-sm font-mono text-white tabular-nums tracking-wider">{time}</p>
      <p className="text-[10px] text-ghost-muted font-mono mt-0.5">{date}</p>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color, i }: {
  label: string; value: string | number; sub?: string;
  icon: any; color: string; i: number;
}) {
  return (
    <motion.div
      custom={i} variants={fade} initial="hidden" animate="visible"
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className="relative rounded-2xl p-5 overflow-hidden cursor-default group"
      style={{
        background: `linear-gradient(135deg, ${color}08 0%, rgba(255,255,255,0.02) 60%, ${color}04 100%)`,
        border: `1px solid ${color}18`,
        boxShadow: `inset 0 1px 0 ${color}10, 0 4px 20px rgba(0,0,0,0.15)`,
      }}
    >
      {/* Top glow bar */}
      <div className="absolute top-0 left-0 right-0 h-px"
           style={{ background: `linear-gradient(90deg, transparent 10%, ${color}60, transparent 90%)` }} />
      {/* Bottom subtle line */}
      <div className="absolute bottom-0 left-0 right-0 h-px"
           style={{ background: `linear-gradient(90deg, transparent, ${color}10, transparent)` }} />
      {/* Corner glow */}
      <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
           style={{ background: `radial-gradient(circle, ${color}18, transparent 70%)` }} />

      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
             style={{ background: `${color}15`, border: `1px solid ${color}25`, boxShadow: `0 0 16px ${color}10` }}>
          <Icon size={17} style={{ color }} />
        </div>
        <TrendingUp size={10} style={{ color: `${color}40` }} className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <p className="text-2xl font-bold text-white tabular-nums leading-none mb-1.5"
         style={{ fontFamily: 'Space Grotesk' }}>{value}</p>
      <p className="text-xs text-ghost-muted">{label}</p>
      {sub && <p className="text-[10px] text-ghost-muted/40 mt-0.5 font-mono">{sub}</p>}
    </motion.div>
  );
}

// ── Agent Icon (SVG) ─────────────────────────────────────────────────────────

function AgentIcon({ agentId, size = 18 }: { agentId: string; size?: number }) {
  const [ok, setOk] = useState(true);
  const color = agentColor(agentId);
  if (!ok) return <span style={{ fontSize: size * 0.8 }}>{agentEmoji(agentId)}</span>;
  return (
    <img
      src={`/bots/${agentId}.svg`}
      alt={agentId}
      width={size} height={size}
      style={{ filter: `drop-shadow(0 0 3px ${color}40)` }}
      onError={() => setOk(false)}
    />
  );
}

// ── Agent Row ─────────────────────────────────────────────────────────────────

function AgentRow({ agent, i }: { agent: AgentState; i: number }) {
  const color     = agentColor(agent.id);
  const sColor    = statusColor(agent.status);
  const lastEvent = agent.events[agent.events.length - 1];

  const statusLabel: Record<string, string> = {
    online: 'Online', idle: 'Idle', working: 'Working', error: 'Error', offline: 'Offline',
  };

  return (
    <motion.div
      custom={i} variants={fade} initial="hidden" animate="visible"
      whileHover={{ backgroundColor: 'rgba(255,255,255,0.03)', x: 2, transition: { duration: 0.15 } }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-default transition-all group"
    >
      {/* Avatar with SVG icon */}
      <div className="relative shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
           style={{ background: `${color}12`, border: `1px solid ${color}20` }}>
        <AgentIcon agentId={agent.id} size={18} />
        <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-ghost-bg"
              style={{ background: sColor }} />
        {/* Hover glow */}
        <div className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
             style={{ boxShadow: `inset 0 0 8px ${color}15, 0 0 8px ${color}10` }} />
      </div>

      {/* Name + Role */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white leading-none mb-0.5"
           style={{ fontFamily: 'Space Grotesk' }}>{agent.name}</p>
        <p className="text-[10px] text-ghost-muted/60 truncate">{agent.role}</p>
      </div>

      {/* Status badge */}
      <span className="shrink-0 text-[9px] font-mono px-2 py-0.5 rounded-full"
            style={{ background: `${sColor}12`, color: sColor, border: `1px solid ${sColor}25` }}>
        {statusLabel[agent.status] ?? agent.status}
      </span>

      {/* Last seen */}
      {lastEvent && (
        <span className="hidden xl:block text-[9px] text-ghost-muted/30 font-mono shrink-0 w-16 text-right">
          {formatRelative(lastEvent.ts)}
        </span>
      )}
    </motion.div>
  );
}

// ── Activity Feed ─────────────────────────────────────────────────────────────

function ActivityFeed() {
  const { agents } = useGhostStore();
  const events = Object.values(agents)
    .flatMap(a => a.events.map(e => ({ ...e, agentName: a.name, agentId: a.id })))
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 30);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-ghost-muted/25">
        <Radio size={18} className="mb-2" />
        <p className="text-[10px] font-mono">Awaiting agent activity...</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <AnimatePresence initial={false}>
        {events.map((e, i) => {
          const color = agentColor(e.agentId);
          const typeColor: Record<string, string> = {
            success: '#10B981', error: '#EF4444', warning: '#F59E0B', info: '#64748B',
          };
          return (
            <motion.div
              key={`${e.agentId}-${e.ts}-${i}`}
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02 }}
              className="flex items-start gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.02] transition-colors group"
            >
              {/* Dot */}
              <div className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full"
                   style={{ background: typeColor[e.type] ?? '#64748B' }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-semibold" style={{ color, fontFamily: 'Space Grotesk' }}>
                    {e.agentName}
                  </span>
                  <span className="text-[9px] text-ghost-muted/30 font-mono">{formatRelative(e.ts)}</span>
                </div>
                <p className="text-[10px] text-ghost-muted/70 truncate leading-relaxed">{e.message}</p>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ── Health Item ───────────────────────────────────────────────────────────────

function HealthItem({ label, status, detail, icon: Icon, ping }: {
  label: string; status: 'up' | 'down' | 'checking';
  detail: string; icon: any; ping?: number;
}) {
  const color = status === 'up' ? '#10B981' : status === 'down' ? '#EF4444' : '#F59E0B';
  const dot   = status === 'up' ? 'bg-emerald-400' : status === 'down' ? 'bg-red-400' : 'bg-amber-400';

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-white/[0.02] transition-colors group">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-shadow duration-300"
           style={{ background: `${color}10`, border: `1px solid ${color}20` }}>
        <Icon size={12} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-white font-medium leading-none mb-0.5"
           style={{ fontFamily: 'Space Grotesk' }}>{label}</p>
        <p className="text-[9px] text-ghost-muted/50 font-mono truncate">{detail}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {ping !== undefined && status === 'up' && (
          <span className="text-[9px] font-mono text-ghost-muted/40">{ping}ms</span>
        )}
        <span className={`w-1.5 h-1.5 rounded-full ${dot} ${status === 'checking' ? 'animate-pulse' : ''}`} />
      </div>
    </div>
  );
}

// ── Daily Brief ───────────────────────────────────────────────────────────────

function DailyBrief() {
  const [brief,   setBrief]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ts,      setTs]      = useState<string | null>(null);

  useEffect(() => {
    async function fetchBrief() {
      try {
        const res  = await fetch('/api/brief');
        const data = await res.json();
        setBrief(data.briefing || null);
        setTs(data.ts || null);
      } catch { /* Ghost offline */ }
      finally { setLoading(false); }
    }
    fetchBrief();
  }, []);

  return (
    <div className="rounded-2xl overflow-hidden"
         style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(0,212,255,0.08)' }}>
      <div className="flex items-center justify-between px-4 py-3"
           style={{
             borderBottom: '1px solid rgba(255,255,255,0.04)',
             background: 'linear-gradient(135deg, rgba(0,212,255,0.04) 0%, transparent 60%)',
           }}>
        <div className="flex items-center gap-2">
          <FileText size={12} className="text-ghost-accent" />
          <span className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>
            Daily Brief
          </span>
        </div>
        {ts && (
          <span className="text-[9px] font-mono text-ghost-muted/30">
            {new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <div className="p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-ghost-muted/30 py-3">
            <Loader2 size={11} className="animate-spin" />
            <span className="text-[10px] font-mono">Fetching briefing...</span>
          </div>
        ) : brief ? (
          <p className="text-[11px] text-ghost-muted/80 leading-relaxed whitespace-pre-wrap">{brief}</p>
        ) : (
          <div className="flex flex-col items-center py-6 text-ghost-muted/20">
            <FileText size={20} className="mb-2" />
            <p className="text-[10px] font-mono">No briefing available</p>
            <p className="text-[9px] text-ghost-muted/15 mt-1">Scribe generates briefs daily</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const { agents, wsConnected } = useGhostStore();

  const [uptime,        setUptime]        = useState('--:--:--');
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [tasksToday,    setTasksToday]    = useState<number | null>(null);
  const [errorsToday,   setErrorsToday]   = useState<number | null>(null);
  const [gatewayPing,   setGatewayPing]   = useState<number | undefined>(undefined);
  const [gatewayOnline, setGatewayOnline] = useState<'up' | 'down' | 'checking'>('checking');
  const [tailscale,     setTailscale]     = useState<any>(null);

  // Gateway + uptime + tailscale
  const checkGateway = useCallback(async () => {
    const start = Date.now();
    try {
      const r = await fetch('/api/heartbeat', { cache: 'no-store' });
      const ping = Date.now() - start;
      if (r.ok) {
        const d = await r.json();
        setGatewayPing(ping);
        setGatewayOnline('up');
        setUptimeSeconds(d.uptime_seconds ?? 0);
        if (d.tailscale) setTailscale(d.tailscale);
      } else {
        setGatewayOnline('down');
      }
    } catch {
      setGatewayOnline('down');
    }
  }, []);

  useEffect(() => {
    checkGateway();
    const t = setInterval(checkGateway, 30_000);
    return () => clearInterval(t);
  }, [checkGateway]);

  // Tasks + errors
  useEffect(() => {
    async function fetchCounts() {
      try {
        const [jobsRes, errRes] = await Promise.all([
          fetch('/api/jobs?limit=1'),
          fetch('/api/errors?limit=1'),
        ]);
        if (jobsRes.ok) { const d = await jobsRes.json(); setTasksToday(d.total ?? 0); }
        if (errRes.ok)  { const d = await errRes.json();  setErrorsToday(d.total  ?? 0); }
      } catch { /* Ghost offline */ }
    }
    fetchCounts();
    const t = setInterval(fetchCounts, 60_000);
    return () => clearInterval(t);
  }, []);

  // Uptime ticker
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
  const errorCount   = agentList.filter(a => a.status === 'error').length;

  // Build health items dynamically
  const healthItems: Array<{
    label: string; icon: any; status: 'up' | 'down' | 'checking'; detail: string; ping?: number;
  }> = [
    { label: 'Ghost Gateway',      icon: Server,      status: gatewayOnline,                            detail: 'port 18789',          ping: gatewayPing },
    { label: 'WebSocket',           icon: Wifi,        status: wsConnected ? 'up' : 'down' as any,      detail: 'live agent feed' },
    { label: 'Discord — Sentinel',  icon: Bot,         status: (onlineCount > 0 ? 'up' : 'down') as any, detail: 'Ghost#6982' },
    { label: 'Neon Database',       icon: Database,    status: 'up' as any,                              detail: 'PostgreSQL · us-east-1' },
    { label: 'Pinecone Memory',     icon: MemoryStick, status: 'up' as any,                              detail: 'Vector · ghost ns' },
    { label: 'Ollama',              icon: Cpu,         status: 'up' as any,                              detail: 'nomic-embed-text' },
  ];

  // Add Tailscale health if data is available
  if (tailscale) {
    const tsDetail = tailscale.running
      ? `${tailscale.hostname || 'node'} · ${tailscale.onlinePeers}/${tailscale.peerCount} peers`
      : 'not running';
    healthItems.push({
      label:  'Tailscale VPN',
      icon:   Globe,
      status: tailscale.running && tailscale.onlinePeers > 0 ? 'up' : tailscale.running ? 'down' : 'down',
      detail: tsDetail,
    });
  }

  return (
    <div className="p-5 pb-10 max-w-screen-2xl mx-auto space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="flex items-center justify-between"
      >
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className={`w-2 h-2 rounded-full ${gatewayOnline === 'up' ? 'bg-emerald-400' : gatewayOnline === 'down' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'}`} />
            <span className="text-[10px] font-mono text-ghost-muted tracking-widest uppercase">
              {gatewayOnline === 'up' ? 'All Systems Operational' : gatewayOnline === 'down' ? 'Gateway Unreachable' : 'Connecting...'}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight" style={{ fontFamily: 'Space Grotesk' }}>
            Mission Control
          </h1>
          <p className="text-xs text-ghost-muted/60 mt-0.5 font-mono">Operation Ghost · Agent Intelligence Platform</p>
        </div>
        <LiveClock />
      </motion.div>

      {/* ── KPI Row ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard i={0} label="Agents Online"  value={onlineCount}           sub={`${agentList.length} total`}   icon={Zap}      color="#00D4FF" />
        <KpiCard i={1} label="Active Now"     value={workingCount}          sub="processing tasks"              icon={Activity} color="#F59E0B" />
        <KpiCard i={2} label="Tasks Logged"   value={tasksToday ?? '…'}     sub="agent_logs table"              icon={Shield}   color="#10B981" />
        <KpiCard i={3} label="Uptime"         value={uptime}                sub="Ghost gateway"                 icon={Clock}    color="#7C3AED" />
      </div>

      {/* ── Main Grid ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* Left: Agents + Activity */}
        <div className="xl:col-span-2 space-y-5">

          {/* Agent Network */}
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
              <div className="flex items-center gap-2">
                <Bot size={12} className="text-ghost-accent" />
                <span className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>
                  Agent Network
                </span>
              </div>
              <div className="flex items-center gap-3">
                {errorCount > 0 && (
                  <span className="text-[9px] font-mono text-red-400 flex items-center gap-1">
                    <AlertTriangle size={8} />{errorCount} error{errorCount > 1 ? 's' : ''}
                  </span>
                )}
                <span className="text-[9px] font-mono text-ghost-muted/40">{agentList.length} agents</span>
              </div>
            </div>

            <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-0.5">
              {agentList.map((agent, i) => (
                <AgentRow key={agent.id} agent={agent} i={i} />
              ))}
            </div>
          </motion.div>

          {/* Live Activity */}
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
              <div className="flex items-center gap-2">
                <Activity size={12} className="text-ghost-accent" />
                <span className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>
                  Live Activity
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[9px] font-mono text-ghost-muted/40">real-time</span>
              </div>
            </div>
            <div className="p-2 max-h-56 overflow-y-auto">
              <ActivityFeed />
            </div>
          </motion.div>
        </div>

        {/* Right: Health + Brief */}
        <div className="space-y-5">

          {/* System Health */}
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
            className="rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
              <div className="flex items-center gap-2">
                <Server size={12} className="text-ghost-accent" />
                <span className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>
                  System Health
                </span>
              </div>
              <span className="text-[9px] font-mono text-ghost-muted/40">
                {healthItems.filter(h => h.status === 'up').length}/{healthItems.length} online
              </span>
            </div>

            <div className="p-2">
              {healthItems.map((item) => (
                <HealthItem key={item.label} {...item} />
              ))}

              {errorsToday !== null && errorsToday > 0 && (
                <div className="mt-2 mx-1 flex items-center justify-between px-3 py-2 rounded-xl"
                     style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={10} className="text-red-400" />
                    <span className="text-[10px] text-red-400/80">Errors today</span>
                  </div>
                  <span className="text-[10px] font-mono text-red-400 font-bold">{errorsToday}</span>
                </div>
              )}
            </div>
          </motion.div>

          {/* Daily Brief */}
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          >
            <DailyBrief />
          </motion.div>

        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <div className="pt-4 border-t border-white/[0.04] flex items-center justify-between">
        <span className="text-[9px] font-mono text-ghost-muted/20 tracking-widest">OPERATION GHOST · MISSION CONTROL</span>
        <span className="text-[9px] font-mono text-ghost-muted/20">v2.0 · {new Date().getFullYear()}</span>
      </div>

    </div>
  );
}
