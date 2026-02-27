'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Server, Users, Hash, Shield, RefreshCw, Crown, Mic, MessageSquare } from 'lucide-react';
import { formatRelative } from '@/lib/utils';

interface DiscordChannel {
  id:   string;
  name: string;
  type: 'text' | 'voice' | 'forum' | 'other';
}

interface DiscordRole {
  id:    string;
  name:  string;
  color: string;
}

interface DiscordGuild {
  id:          string;
  name:        string;
  icon:        string | null;
  memberCount: number;
  botJoinedAt: string | null;
  isPrimary:   boolean;
  channels:    DiscordChannel[];
  roles:       DiscordRole[];
  features:    string[];
}

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.08 } } },
  item:      { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } },
};

function ChannelIcon({ type }: { type: DiscordChannel['type'] }) {
  if (type === 'voice') return <Mic size={11} className="text-ghost-muted/50 group-hover:text-ghost-muted transition-colors" />;
  if (type === 'forum') return <MessageSquare size={11} className="text-ghost-muted/50 group-hover:text-ghost-muted transition-colors" />;
  return <Hash size={11} className="text-ghost-muted/50 group-hover:text-ghost-muted transition-colors" />;
}

function ChannelRow({ ch }: { ch: DiscordChannel }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-white/5 transition-all cursor-default group">
      <ChannelIcon type={ch.type} />
      <span className="text-[11px] text-ghost-muted group-hover:text-white transition-colors font-mono truncate">
        {ch.name}
      </span>
      <span className="ml-auto text-[9px] text-ghost-muted/30 uppercase tracking-wider shrink-0">{ch.type}</span>
    </div>
  );
}

function GuildIcon({ guild }: { guild: DiscordGuild }) {
  const color = guild.isPrimary ? '#00D4FF' : '#7C3AED';
  return (
    <div
      className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 relative overflow-hidden"
      style={{ background: `${color}15`, border: `1px solid ${color}30` }}
    >
      {guild.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={guild.icon} alt={guild.name} className="w-full h-full object-cover rounded-2xl" />
      ) : (
        <span className="text-lg font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
          {guild.name.charAt(0).toUpperCase()}
        </span>
      )}
      {guild.isPrimary && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-400/90 flex items-center justify-center">
          <Crown size={9} className="text-yellow-900" />
        </span>
      )}
    </div>
  );
}

export default function ServersPage() {
  const [guilds,      setGuilds]      = useState<DiscordGuild[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [expanded,    setExpanded]    = useState<string | null>(null);
  const [refreshKey,  setRefreshKey]  = useState(0);

  const fetchGuilds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/discord/guilds', { cache: 'no-store' });
      const data = await res.json();
      if (data.error && !data.guilds?.length) {
        setError(data.error);
      } else {
        const list: DiscordGuild[] = data.guilds ?? [];
        setGuilds(list);
        // Auto-expand primary guild
        const primary = list.find(g => g.isPrimary);
        if (primary && !expanded) setExpanded(primary.id);
      }
    } catch {
      setError('Could not reach Ghost. Is the bot running?');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => { fetchGuilds(); }, [fetchGuilds]);

  const totalMembers  = guilds.reduce((s, g) => s + g.memberCount, 0);
  const totalChannels = guilds.reduce((s, g) => s + g.channels.length, 0);

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Server size={16} className="text-ghost-accent" />
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Connected Servers</h2>
          </div>
          <p className="text-xs text-ghost-muted">Discord guilds where Ghost#6982 is active</p>
        </div>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          disabled={loading}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all disabled:opacity-40"
          style={{ border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Guilds',   value: loading ? '—' : guilds.length,   color: '#00D4FF' },
          { label: 'Members',  value: loading ? '—' : totalMembers,    color: '#10B981' },
          { label: 'Channels', value: loading ? '—' : totalChannels,   color: '#F59E0B' },
          { label: 'Uptime',   value: '99.8%',                          color: '#7C3AED' },
        ].map(kpi => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-xl p-4"
            style={{ border: `1px solid ${kpi.color}20` }}
          >
            <p className="text-xl font-bold" style={{ fontFamily: 'Space Grotesk', color: kpi.color }}>
              {kpi.value}
            </p>
            <p className="text-[10px] text-ghost-muted mt-0.5">{kpi.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-ghost-muted/40">
          <RefreshCw size={14} className="animate-spin" />
          <span className="text-xs font-mono">Fetching guild data from Discord…</span>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="glass rounded-xl p-6 text-center" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
          <p className="text-red-400 text-sm font-mono mb-1">⚠ {error}</p>
          <p className="text-ghost-muted text-xs">Make sure Ghost is running and connected to Discord.</p>
        </div>
      )}

      {/* Guild list */}
      {!loading && !error && (
        <motion.div variants={stagger.container} initial="initial" animate="animate" className="space-y-4">
          {guilds.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center">
              <p className="text-ghost-muted text-sm font-mono">Ghost is not in any Discord guilds yet.</p>
            </div>
          ) : guilds.map(guild => {
            const accentColor = guild.isPrimary ? '#00D4FF' : '#7C3AED';
            return (
              <motion.div
                key={guild.id}
                variants={stagger.item}
                className="glass rounded-2xl overflow-hidden"
                style={{ border: `1px solid ${accentColor}20` }}
              >
                {/* Guild header */}
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer select-none"
                  onClick={() => setExpanded(expanded === guild.id ? null : guild.id)}
                >
                  <GuildIcon guild={guild} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-bold text-white truncate" style={{ fontFamily: 'Space Grotesk' }}>
                        {guild.name}
                      </p>
                      {guild.isPrimary && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-mono text-yellow-400 shrink-0"
                              style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }}>
                          PRIMARY
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-ghost-muted font-mono">
                      <span className="flex items-center gap-1">
                        <Users size={10} />{guild.memberCount.toLocaleString()} members
                      </span>
                      <span className="flex items-center gap-1">
                        <Hash size={10} />{guild.channels.length} channels
                      </span>
                      {guild.botJoinedAt && (
                        <span>Joined {formatRelative(guild.botJoinedAt)}</span>
                      )}
                      <span className="text-[9px] text-ghost-muted/40 font-mono">ID: {guild.id}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-[10px] text-green-400 font-mono">Connected</span>
                  </div>
                </div>

                {/* Expanded details */}
                {expanded === guild.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Channels */}
                      <div className="lg:col-span-2">
                        <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-3">
                          Channels ({guild.channels.length})
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5 max-h-64 overflow-y-auto pr-1">
                          {guild.channels.map(ch => <ChannelRow key={ch.id} ch={ch} />)}
                        </div>
                      </div>

                      {/* Roles + Features */}
                      <div className="space-y-4">
                        <div>
                          <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-2">
                            Roles ({guild.roles.length})
                          </p>
                          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                            {guild.roles.map(r => (
                              <span
                                key={r.id}
                                className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-mono"
                                style={{
                                  background: r.color !== '#000000' ? `${r.color}18` : 'rgba(255,255,255,0.06)',
                                  border:     r.color !== '#000000' ? `1px solid ${r.color}40` : '1px solid rgba(255,255,255,0.1)',
                                  color:      r.color !== '#000000' ? r.color : undefined,
                                }}
                              >
                                <Shield size={8} className="opacity-60" />
                                {r.name}
                              </span>
                            ))}
                          </div>
                        </div>

                        {guild.features.length > 0 && (
                          <div>
                            <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-2">Features</p>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {guild.features.map(f => (
                                <div key={f} className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-green-400/60 shrink-0" />
                                  <span className="text-[10px] text-ghost-muted font-mono">{f}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Footer notice */}
      <div className="mt-6 glass rounded-xl p-4 flex items-center gap-3"
           style={{ border: '1px solid rgba(0,212,255,0.08)' }}>
        <Shield size={14} className="text-ghost-accent shrink-0" />
        <p className="text-[10px] text-ghost-muted">
          <span className="text-white font-medium">Bot responds in the PRIMARY guild.</span>{' '}
          Ghost can @mention respond anywhere in the primary server. Other guilds are visible but commands only execute in the configured DISCORD_GUILD_ID.
        </p>
      </div>
    </div>
  );
}
