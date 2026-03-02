'use client';

import { motion } from 'framer-motion';
import { useGhostStore, AgentState } from '@/store';
import { agentColor, agentEmoji, formatRelative, statusColor } from '@/lib/utils';
import {
  Activity, Zap, AlertTriangle, Server, FileText, Loader2,
  Wifi, Database, Bot, Cpu, MemoryStick, Globe, Radio,
  CheckCircle2, XCircle, Shield,
} from 'lucide-react';
import React, { useEffect, useState, useCallback, useMemo } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
   AGENT ICON
   ═══════════════════════════════════════════════════════════════════════════ */

function AgentIcon({ agentId, size = 24 }: { agentId: string; size?: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <span style={{ fontSize: size * 0.75 }}>{agentEmoji(agentId)}</span>;
  return (
    <img
      src={`/bots/${agentId}.svg`}
      alt={agentId}
      width={size}
      height={size}
      style={{ filter: `drop-shadow(0 0 8px ${agentColor(agentId)}60)` }}
      onError={() => setOk(false)}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATUS BADGE
   ═══════════════════════════════════════════════════════════════════════════ */

const STATUS_CFG: Record<string, {
  label: string; bg: string; text: string; dot: string; pulse?: boolean;
}> = {
  online:  { label: 'Online',  bg: 'rgba(16,185,129,0.12)',  text: '#34D399', dot: '#10B981' },
  working: { label: 'Working', bg: 'rgba(245,158,11,0.14)',  text: '#FBBF24', dot: '#F59E0B', pulse: true },
  idle:    { label: 'Idle',    bg: 'rgba(100,116,139,0.10)', text: '#94A3B8', dot: '#64748B' },
  error:   { label: 'Error',   bg: 'rgba(239,68,68,0.14)',   text: '#F87171', dot: '#EF4444', pulse: true },
  offline: { label: 'Offline', bg: 'rgba(71,85,105,0.08)',   text: '#64748B', dot: '#475569' },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.offline;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-[10px] font-semibold tracking-wide shrink-0"
      style={{ background: c.bg, color: c.text }}
    >
      <span
        className={`w-[5px] h-[5px] rounded-full shrink-0 ${c.pulse ? 'animate-pulse' : ''}`}
        style={{ background: c.dot, boxShadow: c.pulse ? `0 0 8px ${c.dot}` : 'none' }}
      />
      {c.label}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   HERO CARD — Ghost (commander tier, full-width, two-column)
   ═══════════════════════════════════════════════════════════════════════════ */

function HeroCard({ agent }: { agent: AgentState }) {
  const color        = agentColor(agent.id);
  const isWorking    = agent.status === 'working';
  const recentEvents = agent.events.slice(-5).reverse();
  const actLevel     = Math.min(10, Math.ceil(agent.events.length / 5));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative rounded-xl overflow-hidden"
      style={{
        background: 'rgba(12, 16, 24, 0.92)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3), 0 0 80px ${color}06`,
      }}
    >
      {/* Color wash — bolder for hero presence */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(150deg, ${color}18 0%, transparent 50%, ${color}08 100%)` }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(ellipse 50% 80% at 10% 20%, ${color}12, transparent)` }}
      />

      {/* 4px accent bar */}
      <div
        className={isWorking ? 'shimmer' : ''}
        style={{
          height: 4,
          background: isWorking
            ? `linear-gradient(90deg, transparent, ${color}, transparent)`
            : `linear-gradient(90deg, ${color}30, ${color}DD, ${color}30)`,
          backgroundSize: isWorking ? '200% 100%' : '100% 100%',
        }}
      />

      <div className="relative p-3 sm:p-5 grid grid-cols-1 md:grid-cols-[1fr,1px,1fr] gap-4 sm:gap-5">

        {/* ── Left: Identity ── */}
        <div className="flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div
                className="relative w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: `radial-gradient(circle at 30% 30%, ${color}25, ${color}0A)`,
                  border: `1px solid ${color}25`,
                  boxShadow: `0 4px 20px ${color}15, inset 0 0 12px ${color}06`,
                }}
              >
                <AgentIcon agentId={agent.id} size={32} />
                {isWorking && (
                  <div
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{ border: `1px solid ${color}40`, animation: 'status-pulse 2.5s ease-in-out infinite' }}
                  />
                )}
              </div>

              <div>
                <div className="flex items-center gap-3 mb-1">
                  <p className="text-xl font-bold text-white tracking-tight" style={{ fontFamily: 'Space Grotesk' }}>
                    {agent.name}
                  </p>
                  <StatusBadge status={agent.status} />
                </div>
                <p className="text-[13px] text-ghost-muted">{agent.role}</p>
                {agent.model && (
                  <p className="text-[10px] text-ghost-muted/50 font-mono mt-0.5">{agent.model}</p>
                )}
              </div>
            </div>
          </div>

          {/* Activity bars */}
          <div className="flex items-center gap-3 mt-auto">
            <div className="flex gap-[3px] flex-1">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 h-[6px] rounded-full"
                  style={{
                    background: i < actLevel ? color : 'rgba(255,255,255,0.07)',
                    opacity: i < actLevel ? 0.35 + (i / 10) * 0.55 : 1,
                  }}
                />
              ))}
            </div>
            <span className="text-[10px] text-ghost-muted/40 font-mono tabular-nums">
              {agent.events.length} events
            </span>
          </div>
        </div>

        {/* ── Vertical divider ── */}
        <div className="hidden md:block" style={{ background: 'rgba(255,255,255,0.05)' }} />

        {/* ── Right: Recent events ── */}
        <div>
          <p className="text-[10px] text-ghost-muted/40 font-mono tracking-[0.15em] mb-3">
            RECENT ACTIVITY
          </p>
          {recentEvents.length > 0 ? (
            <div className="space-y-1.5">
              {recentEvents.map((e, i) => {
                const typeColors: Record<string, string> = {
                  success: '#10B981', error: '#EF4444', warning: '#F59E0B', info: '#64748B',
                };
                const dotColor = typeColors[e.type] ?? '#64748B';
                return (
                  <div
                    key={`${e.ts}-${i}`}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <div
                      className="w-[6px] h-[6px] rounded-full shrink-0"
                      style={{ background: dotColor, boxShadow: `0 0 4px ${dotColor}50` }}
                    />
                    <p className="text-[10px] text-ghost-muted/60 font-mono truncate flex-1">
                      {e.message}
                    </p>
                    <span className="text-[9px] text-ghost-muted/50 font-mono shrink-0">
                      {formatRelative(e.ts)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className="flex items-center gap-2 px-3 py-4 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.07)' }}
            >
              <Radio size={12} className="text-ghost-muted/40" />
              <p className="text-[10px] text-ghost-muted/40 font-mono">Waiting for first events…</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   AGENT CARD — standard card for directors and workers
   ═══════════════════════════════════════════════════════════════════════════ */

const STATUS_ORDER: Record<string, number> = {
  working: 0, online: 1, error: 2, idle: 3, offline: 4,
};

function AgentCard({ agent, index }: { agent: AgentState; index: number }) {
  const color     = agentColor(agent.id);
  const isWorking = agent.status === 'working';
  const lastEvent = agent.events[agent.events.length - 1];
  const actLevel  = Math.min(10, Math.ceil(agent.events.length / 5));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.035, duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ y: -4, transition: { duration: 0.25, ease: 'easeOut' } }}
      className="group relative rounded-xl overflow-hidden"
      style={{
        background: 'rgba(12, 16, 24, 0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.25)',
      }}
    >
      {/* Hover glow */}
      <div
        className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-400 pointer-events-none z-10"
        style={{
          border: `1px solid ${color}40`,
          boxShadow: `0 12px 48px ${color}12, 0 4px 20px ${color}08`,
        }}
      />

      {/* Subtle color wash */}
      <div
        className="absolute inset-0 pointer-events-none opacity-50 group-hover:opacity-70 transition-opacity duration-500"
        style={{ background: `linear-gradient(150deg, ${color}0C 0%, transparent 45%)` }}
      />

      {/* 4px accent bar */}
      <div
        className={isWorking ? 'shimmer' : ''}
        style={{
          height: 4,
          background: isWorking
            ? `linear-gradient(90deg, transparent, ${color}, transparent)`
            : `linear-gradient(90deg, ${color}25, ${color}CC, ${color}25)`,
          backgroundSize: isWorking ? '200% 100%' : '100% 100%',
        }}
      />

      {/* Content */}
      <div className="relative p-4 pb-3.5">

        {/* Header: Icon + Name + Status */}
        <div className="flex items-start gap-3 mb-3">
          <div
            className="relative w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: `radial-gradient(circle at 35% 35%, ${color}20, ${color}08)`,
              border: `1px solid ${color}22`,
              boxShadow: isWorking
                ? `0 0 24px ${color}25, inset 0 0 12px ${color}08`
                : `0 2px 10px ${color}08`,
            }}
          >
            <AgentIcon agentId={agent.id} size={26} />
            {isWorking && (
              <div
                className="absolute inset-0 rounded-xl pointer-events-none"
                style={{ border: `1px solid ${color}35`, animation: 'status-pulse 2.5s ease-in-out infinite' }}
              />
            )}
          </div>

          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p
                className="text-[13px] font-bold text-white truncate leading-tight"
                style={{ fontFamily: 'Space Grotesk' }}
              >
                {agent.name}
              </p>
              <StatusBadge status={agent.status} />
            </div>
            <p className="text-[11px] text-ghost-muted truncate">{agent.role}</p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px mb-3" style={{ background: 'rgba(255,255,255,0.07)' }} />

        {/* Last event */}
        {lastEvent ? (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)' }}
          >
            <p className="text-[10px] text-ghost-muted font-mono truncate flex-1">
              {lastEvent.message}
            </p>
            <span className="text-[9px] text-ghost-muted/50 font-mono shrink-0">
              {formatRelative(lastEvent.ts)}
            </span>
          </div>
        ) : (
          <div className="px-3 py-2 rounded-lg mb-3" style={{ background: 'rgba(255,255,255,0.07)' }}>
            <p className="text-[10px] text-ghost-muted/50 font-mono">No recent activity</p>
          </div>
        )}

        {/* Activity bars + count */}
        <div className="flex items-center gap-2.5">
          <div className="flex gap-[3px] flex-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 h-1.5 rounded-full"
                style={{
                  background: i < actLevel ? color : 'rgba(255,255,255,0.07)',
                  opacity: i < actLevel ? 0.35 + (i / 10) * 0.55 : 1,
                }}
              />
            ))}
          </div>
          {agent.events.length > 0 && (
            <span className="text-[9px] text-ghost-muted/40 font-mono tabular-nums shrink-0">
              {agent.events.length}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   KPI CARD
   ═══════════════════════════════════════════════════════════════════════════ */

function KpiCard({
  icon: Icon, label, value, sub, color, delay,
}: {
  icon: any; label: string; value: string | number; sub?: string;
  color: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="relative rounded-xl overflow-hidden group"
      style={{
        background: 'rgba(12, 16, 24, 0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      }}
    >
      {/* Left accent stripe */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: `linear-gradient(to bottom, ${color}AA, ${color}30)` }}
      />

      <div className="p-3 sm:p-5 sm:pl-5">
        <div className="flex items-center justify-between mb-2 sm:mb-4">
          <div
            className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center"
            style={{
              background: `radial-gradient(circle at 35% 35%, ${color}18, ${color}08)`,
              border: `1px solid ${color}1A`,
              boxShadow: `0 2px 10px ${color}08`,
            }}
          >
            <Icon size={15} style={{ color }} />
          </div>
        </div>

        <motion.p
          key={String(value)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-2xl sm:text-4xl font-bold text-white tabular-nums leading-none mb-1 sm:mb-1.5"
          style={{ fontFamily: 'Space Grotesk', letterSpacing: '-0.02em' }}
        >
          {value}
        </motion.p>
        <p className="text-[10px] sm:text-[12px] text-ghost-muted font-medium">{label}</p>
        {sub && <p className="text-[9px] sm:text-[10px] text-ghost-muted/40 mt-0.5 font-mono">{sub}</p>}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PANEL — glass wrapper for bottom sections
   ═══════════════════════════════════════════════════════════════════════════ */

function Panel({
  children, title, icon: Icon, right, delay = 0,
}: {
  children: React.ReactNode; title: string; icon: any;
  right?: React.ReactNode; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="glass rounded-xl overflow-hidden"
    >
      <div
        className="flex items-center justify-between px-3 sm:px-5 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="flex items-center gap-2.5">
          <Icon size={14} className="text-ghost-accent" />
          <span
            className="text-xs font-semibold text-white tracking-wide"
            style={{ fontFamily: 'Space Grotesk' }}
          >
            {title}
          </span>
        </div>
        {right}
      </div>
      {children}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVITY FEED
   ═══════════════════════════════════════════════════════════════════════════ */

function ActivityFeed() {
  const { agents } = useGhostStore();
  const events = useMemo(() =>
    Object.values(agents)
      .flatMap(a => a.events.map(e => ({ ...e, agentName: a.name, agentId: a.id })))
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 25),
    [agents]
  );

  if (!events.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-ghost-muted/40">
        <Radio size={24} className="mb-3" />
        <p className="text-xs font-mono">Waiting for activity…</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-white/[0.03]">
      {events.map((e, i) => {
        const color = agentColor(e.agentId);
        const typeColors: Record<string, string> = {
          success: '#10B981', error: '#EF4444', warning: '#F59E0B', info: '#64748B',
        };
        const dotColor = typeColors[e.type] ?? '#64748B';

        return (
          <div
            key={`${e.agentId}-${e.ts}-${i}`}
            className="flex items-start gap-2 sm:gap-3 px-3 sm:px-5 py-2 sm:py-2.5 hover:bg-white/[0.05] transition-colors"
          >
            <div className="flex flex-col items-center pt-1.5 shrink-0">
              <div
                className="w-[7px] h-[7px] rounded-full"
                style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}60` }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className="text-[11px] font-semibold"
                  style={{ color, fontFamily: 'Space Grotesk' }}
                >
                  {e.agentName}
                </span>
                <span className="text-[10px] text-ghost-muted/40 font-mono">
                  {formatRelative(e.ts)}
                </span>
              </div>
              <p className="text-[10px] text-ghost-muted/70 truncate leading-relaxed">{e.message}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SYSTEM HEALTH
   ═══════════════════════════════════════════════════════════════════════════ */

function HealthGrid({ items }: {
  items: { label: string; icon: any; status: 'up' | 'down' | 'checking'; detail: string; ping?: number }[];
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 sm:p-4">
      {items.map(item => {
        const isUp       = item.status === 'up';
        const color      = isUp ? '#10B981' : item.status === 'down' ? '#EF4444' : '#F59E0B';
        const Icon       = item.icon;
        const StatusIcon = isUp ? CheckCircle2 : item.status === 'down' ? XCircle : Loader2;

        return (
          <div
            key={item.label}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-white/[0.025] transition-colors"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.05)' }}
          >
            <Icon size={14} style={{ color }} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-white font-medium truncate">{item.label}</p>
              <p className="text-[9px] text-ghost-muted/40 font-mono truncate">{item.detail}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {item.ping !== undefined && isUp && (
                <span className="text-[9px] font-mono text-ghost-muted/35">{item.ping}ms</span>
              )}
              <StatusIcon
                size={13}
                style={{ color }}
                className={item.status === 'checking' ? 'animate-spin' : ''}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DAILY BRIEF
   ═══════════════════════════════════════════════════════════════════════════ */

function DailyBrief() {
  const [brief, setBrief]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ts, setTs]           = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch('/api/brief');
        const data = await res.json();
        setBrief(data.briefing || null);
        setTs(data.ts || null);
      } catch { /* Ghost offline */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-ghost-muted/40 p-5">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-[11px] font-mono">Loading brief…</span>
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="flex flex-col items-center py-12 text-ghost-muted/35">
        <FileText size={22} className="mb-2" />
        <p className="text-[10px] font-mono">No briefing available</p>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-5">
      {ts && (
        <p className="text-[9px] font-mono text-ghost-muted/50 mb-2">
          {new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
      <p className="text-[10px] sm:text-[11px] text-ghost-muted/70 leading-relaxed whitespace-pre-wrap">{brief}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION LABEL — subtle tier heading
   ═══════════════════════════════════════════════════════════════════════════ */

function SectionLabel({ icon: Icon, label, meta }: { icon: any; label: string; meta?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3 pb-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'rgba(0,212,255,0.08)' }}>
          <Icon size={12} className="text-ghost-accent" />
        </div>
        <span className="text-sm font-semibold text-white tracking-wide" style={{ fontFamily: 'Space Grotesk' }}>
          {label}
        </span>
      </div>
      {meta && <span className="text-[10px] font-mono text-ghost-muted/40">{meta}</span>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

const DIRECTORS = new Set(['switchboard', 'warden', 'keeper']);

export default function OverviewPage() {
  const { agents, wsConnected } = useGhostStore();

  const [uptime, setUptime]               = useState('00:00:00');
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [tasksToday, setTasksToday]       = useState<number | null>(null);
  const [errorsToday, setErrorsToday]     = useState<number | null>(null);
  const [gatewayPing, setGatewayPing]     = useState<number | undefined>(undefined);
  const [gatewayStatus, setGatewayStatus] = useState<'up' | 'down' | 'checking'>('checking');
  const [tailscale, setTailscale]         = useState<any>(null);
  const [serviceHealth, setServiceHealth] = useState<Record<string, { status: string; ping?: number }>>({});

  /* ── Gateway / uptime ── */
  const checkGateway = useCallback(async () => {
    const t0 = Date.now();
    try {
      const r = await fetch('/api/heartbeat', { cache: 'no-store' });
      const ping = Date.now() - t0;
      if (r.ok) {
        const d = await r.json();
        setGatewayPing(ping);
        setGatewayStatus('up');
        setUptimeSeconds(d.uptime_seconds ?? 0);
        if (d.tailscale) setTailscale(d.tailscale);
      } else setGatewayStatus('down');
    } catch { setGatewayStatus('down'); }
  }, []);

  useEffect(() => {
    checkGateway();
    const t = setInterval(checkGateway, 30_000);
    return () => clearInterval(t);
  }, [checkGateway]);

  /* ── Tasks / errors ── */
  useEffect(() => {
    async function load() {
      try {
        const [jR, eR] = await Promise.all([
          fetch('/api/jobs?limit=1'),
          fetch('/api/errors?limit=1'),
        ]);
        if (jR.ok) { const d = await jR.json(); setTasksToday(d.total ?? 0); }
        if (eR.ok) { const d = await eR.json(); setErrorsToday(d.total ?? 0); }
      } catch {}
    }
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  /* ── Service health checks ── */
  useEffect(() => {
    async function checkHealth() {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        if (r.ok) setServiceHealth(await r.json());
      } catch {}
    }
    checkHealth();
    const t = setInterval(checkHealth, 30_000);
    return () => clearInterval(t);
  }, []);

  /* ── Uptime ticker ── */
  useEffect(() => {
    if (!uptimeSeconds) return;
    let s = uptimeSeconds;
    const t = setInterval(() => {
      s += 1;
      const h   = Math.floor(s / 3600);
      const m   = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      setUptime(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      );
    }, 1000);
    return () => clearInterval(t);
  }, [uptimeSeconds]);

  /* ── Derived data ── */
  const allAgents   = useMemo(() => Object.values(agents), [agents]);
  const ghostAgent  = agents.ghost;
  const directors   = useMemo(
    () => allAgents
      .filter(a => DIRECTORS.has(a.id))
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)),
    [allAgents]
  );
  const workers     = useMemo(
    () => allAgents
      .filter(a => a.id !== 'ghost' && !DIRECTORS.has(a.id))
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)),
    [allAgents]
  );

  const onlineCount  = allAgents.filter(a => a.status !== 'offline').length;
  const workingCount = allAgents.filter(a => a.status === 'working').length;
  const errorCount   = allAgents.filter(a => a.status === 'error').length;

  /* ── Health items ── */
  const healthItems = useMemo(() => {
    const sh = serviceHealth;
    const items: Array<{
      label: string; icon: any; status: 'up' | 'down' | 'checking'; detail: string; ping?: number;
    }> = [
      { label: 'Gateway',   icon: Server,      status: gatewayStatus,                                                    detail: 'port 18790',     ping: gatewayPing },
      { label: 'WebSocket', icon: Wifi,         status: wsConnected ? 'up' : 'down',                                     detail: 'live feed' },
      { label: 'Discord',   icon: Bot,          status: (sh.discord?.status as any) || (onlineCount > 0 ? 'up' : 'down'), detail: 'Ghost#6982' },
      { label: 'Database',  icon: Database,     status: (sh.database?.status as any) || 'checking',                       detail: 'Neon · pgvector', ping: sh.database?.ping },
      { label: 'Redis',     icon: MemoryStick,  status: (sh.redis?.status as any) || 'checking',                          detail: 'cache / queues', ping: sh.redis?.ping },
      { label: 'Ollama',    icon: Cpu,          status: (sh.ollama?.status as any) || 'checking',                          detail: 'qwen2.5:14b + R1',    ping: sh.ollama?.ping },
      { label: 'DeepSeek',  icon: Zap,          status: 'up',                                                                  detail: 'V3.2 + R1 API' },
    ];
    if (tailscale) {
      items.push({
        label: 'Tailscale', icon: Globe,
        status: tailscale.running && tailscale.onlinePeers > 0 ? 'up' : 'down',
        detail: tailscale.running
          ? `${tailscale.hostname || 'node'} · ${tailscale.onlinePeers} peers`
          : 'not running',
      });
    }
    return items;
  }, [gatewayStatus, gatewayPing, wsConnected, onlineCount, tailscale, serviceHealth]);

  const healthUp = healthItems.filter(h => h.status === 'up').length;

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════ */

  return (
    <div className="p-3 sm:p-6 pb-24 md:pb-6 max-w-[1600px] mx-auto space-y-4 sm:space-y-6">

      {/* ── HEADER ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-between flex-wrap gap-2"
      >
        <div>
          <h1
            className="text-xl sm:text-2xl font-bold text-white tracking-tight"
            style={{ fontFamily: 'Space Grotesk' }}
          >
            Overview
          </h1>
          <div className="flex items-center gap-2 sm:gap-3 mt-2 flex-wrap">
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full"
              style={{
                background: gatewayStatus === 'up'
                  ? 'rgba(16,185,129,0.08)'
                  : gatewayStatus === 'down'
                    ? 'rgba(239,68,68,0.08)'
                    : 'rgba(245,158,11,0.08)',
                border: `1px solid ${
                  gatewayStatus === 'up'
                    ? 'rgba(16,185,129,0.18)'
                    : gatewayStatus === 'down'
                      ? 'rgba(239,68,68,0.18)'
                      : 'rgba(245,158,11,0.18)'
                }`,
              }}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  gatewayStatus === 'up'
                    ? 'bg-emerald-400'
                    : gatewayStatus === 'down'
                      ? 'bg-red-400'
                      : 'bg-amber-400 animate-pulse'
                }`}
                style={gatewayStatus === 'up' ? { boxShadow: '0 0 8px rgba(16,185,129,0.7)' } : {}}
              />
              <span className="text-[10px] font-medium text-ghost-muted">
                {gatewayStatus === 'up'
                  ? 'All Systems Operational'
                  : gatewayStatus === 'down'
                    ? 'Degraded'
                    : 'Connecting…'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-ghost-muted/40">
              {healthUp}/{healthItems.length} services
            </span>
          </div>
        </div>

        <div className="text-right">
          <p
            className="text-base sm:text-xl font-bold text-white tabular-nums tracking-widest font-mono"
            style={{ textShadow: '0 0 24px rgba(0,212,255,0.25)' }}
          >
            {uptime}
          </p>
          <p className="text-[9px] text-ghost-muted/50 font-mono tracking-[0.2em] mt-0.5">UPTIME</p>
        </div>
      </motion.div>

      {/* ── KPI STRIP ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <KpiCard delay={0}    icon={Zap}           color="#00D4FF"  label="Agents Online" value={onlineCount} sub={`${allAgents.length} registered`} />
        <KpiCard delay={0.05} icon={Activity}      color="#F59E0B"  label="Active Now"    value={workingCount} sub={workingCount > 0 ? 'processing' : 'all idle'} />
        <KpiCard delay={0.1}  icon={Shield}        color="#10B981"  label="Tasks Logged"  value={tasksToday ?? '—'} sub="agent_logs" />
        <KpiCard delay={0.15} icon={AlertTriangle}  color={errorsToday && errorsToday > 0 ? '#EF4444' : '#10B981'} label="Errors" value={errorsToday ?? '—'} sub={errorsToday && errorsToday > 0 ? 'needs attention' : 'all clear'} />
      </div>

      {/* ── COMMANDER — Ghost hero card ── */}
      {ghostAgent && <HeroCard agent={ghostAgent} />}

      {/* ── DIRECTORS ── */}
      <div>
        <SectionLabel
          icon={Shield}
          label="Core Systems"
          meta={`${directors.filter(a => a.status !== 'offline').length}/${directors.length} online`}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
          {directors.map((agent, i) => (
            <AgentCard key={agent.id} agent={agent} index={i} />
          ))}
        </div>
      </div>

      {/* ── WORKERS ── */}
      <div>
        <SectionLabel
          icon={Bot}
          label="Agent Fleet"
          meta={
            <>
              {workers.filter(a => a.status !== 'offline').length}/{workers.length} online
              {errorCount > 0 && (
                <span
                  className="ml-2 text-[10px] font-semibold text-red-400 inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.15)' }}
                >
                  <AlertTriangle size={9} />
                  {errorCount} error{errorCount > 1 ? 's' : ''}
                </span>
              )}
            </>
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          {workers.map((agent, i) => (
            <AgentCard key={agent.id} agent={agent} index={i} />
          ))}
        </div>
      </div>

      {/* ── BOTTOM: Activity + Health + Brief ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 sm:gap-4">

        <div className="xl:col-span-7">
          <Panel
            icon={Activity}
            title="Live Activity"
            delay={0.5}
            right={
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[9px] font-mono text-ghost-muted/50">real-time</span>
              </div>
            }
          >
            <div className="max-h-80 overflow-y-auto">
              <ActivityFeed />
            </div>
          </Panel>
        </div>

        <div className="xl:col-span-5 space-y-4">
          <Panel
            icon={Server}
            title="System Health"
            delay={0.55}
            right={
              <span
                className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full"
                style={{
                  color: healthUp === healthItems.length ? '#34D399' : '#FBBF24',
                  background: healthUp === healthItems.length
                    ? 'rgba(16,185,129,0.08)'
                    : 'rgba(245,158,11,0.08)',
                }}
              >
                {healthUp}/{healthItems.length}
              </span>
            }
          >
            <HealthGrid items={healthItems} />
            {errorsToday !== null && errorsToday > 0 && (
              <div
                className="mx-3 sm:mx-4 mb-3 sm:mb-4 flex items-center justify-between px-3 py-2.5 rounded-lg"
                style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle size={12} className="text-red-400" />
                  <span className="text-[10px] text-red-400/80 font-medium">Errors today</span>
                </div>
                <span className="text-[11px] font-mono text-red-400 font-bold">{errorsToday}</span>
              </div>
            )}
          </Panel>

          <Panel icon={FileText} title="Daily Brief" delay={0.6}>
            <DailyBrief />
          </Panel>
        </div>
      </div>
    </div>
  );
}
