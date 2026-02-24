'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Server, Users, Hash, Shield, RefreshCw, ExternalLink, Crown } from 'lucide-react';
import { formatRelative } from '@/lib/utils';

interface DiscordServer {
  id:          string;
  name:        string;
  iconEmoji:   string;
  color:       string;
  memberCount: number;
  botJoinedAt: string;
  isPrimary:   boolean;
  channels:    { name: string; type: 'text' | 'voice' | 'forum' }[];
  roles:       string[];
  features:    string[];
}

const SERVERS: DiscordServer[] = [
  {
    id:          '1',
    name:        'Ghost Operations',
    iconEmoji:   '⬡',
    color:       '#00D4FF',
    memberCount: 12,
    botJoinedAt: new Date(Date.now()-86400000*90).toISOString(),
    isPrimary:   true,
    channels:    [
      { name: '🎙️・reception',  type: 'text'  },
      { name: '🤖・commands',   type: 'text'  },
      { name: '📡・alerts',     type: 'text'  },
      { name: '🔍・research',   type: 'text'  },
      { name: '📝・updates',    type: 'text'  },
      { name: '🏆・league',     type: 'text'  },
      { name: '🔊・voice',      type: 'voice' },
    ],
    roles:    ['admin', 'agent', 'member', 'everyone'],
    features: ['GUILD_ISOLATION', 'SLASH_COMMANDS', 'REACTION_ROLES'],
  },
];

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.08 } } },
  item:      { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } },
};

function ChannelRow({ ch }: { ch: DiscordServer['channels'][number] }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-white/5 transition-all cursor-default group">
      <Hash size={11} className="text-ghost-muted/50 group-hover:text-ghost-muted transition-colors" />
      <span className="text-[11px] text-ghost-muted group-hover:text-white transition-colors font-mono">
        {ch.name}
      </span>
      <span className="ml-auto text-[9px] text-ghost-muted/30 uppercase tracking-wider">{ch.type}</span>
    </div>
  );
}

export default function ServersPage() {
  const [expanded, setExpanded] = useState<string | null>('1');

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
        <button className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Guilds', value: SERVERS.length, color: '#00D4FF' },
          { label: 'Members', value: SERVERS.reduce((s, g) => s + g.memberCount, 0), color: '#10B981' },
          { label: 'Channels', value: SERVERS.reduce((s, g) => s + g.channels.length, 0), color: '#F59E0B' },
          { label: 'Uptime', value: '99.8%', color: '#7C3AED' },
        ].map(kpi => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-xl p-4"
            style={{ border: `1px solid ${kpi.color}20` }}
          >
            <p className="text-xl font-bold" style={{ fontFamily: 'Space Grotesk', color: kpi.color }}>{kpi.value}</p>
            <p className="text-[10px] text-ghost-muted mt-0.5">{kpi.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Server list */}
      <motion.div variants={stagger.container} initial="initial" animate="animate" className="space-y-4">
        {SERVERS.map(server => (
          <motion.div
            key={server.id}
            variants={stagger.item}
            className="glass rounded-2xl overflow-hidden"
            style={{ border: `1px solid ${server.color}20` }}
          >
            {/* Server header */}
            <div
              className="flex items-center gap-4 p-5 cursor-pointer"
              onClick={() => setExpanded(expanded === server.id ? null : server.id)}
            >
              {/* Icon */}
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 relative"
                   style={{ background: `${server.color}15`, border: `1px solid ${server.color}30` }}>
                {server.iconEmoji}
                {server.isPrimary && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-400/90 flex items-center justify-center">
                    <Crown size={9} className="text-yellow-900" />
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>{server.name}</p>
                  {server.isPrimary && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono text-yellow-400"
                          style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }}>
                      PRIMARY
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-[10px] text-ghost-muted font-mono">
                  <span className="flex items-center gap-1"><Users size={10} />{server.memberCount} members</span>
                  <span className="flex items-center gap-1"><Hash size={10} />{server.channels.length} channels</span>
                  <span>Joined {formatRelative(server.botJoinedAt)}</span>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[10px] text-green-400 font-mono">Connected</span>
                </div>
              </div>
            </div>

            {/* Expanded details */}
            {expanded === server.id && (
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
                    <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-3">Channels</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5">
                      {server.channels.map(ch => <ChannelRow key={ch.name} ch={ch} />)}
                    </div>
                  </div>

                  {/* Roles + Features */}
                  <div className="space-y-4">
                    <div>
                      <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-2">Roles</p>
                      <div className="flex flex-wrap gap-1.5">
                        {server.roles.map(r => (
                          <span key={r} className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-mono"
                                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <Shield size={8} className="text-ghost-muted/50" />
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[9px] text-ghost-muted/50 uppercase tracking-wider mb-2">Features</p>
                      <div className="space-y-1">
                        {server.features.map(f => (
                          <div key={f} className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-400/60" />
                            <span className="text-[10px] text-ghost-muted font-mono">{f}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </motion.div>
        ))}
      </motion.div>

      {/* Guild isolation notice */}
      <div className="mt-6 glass rounded-xl p-4 flex items-center gap-3"
           style={{ border: '1px solid rgba(0,212,255,0.08)' }}>
        <Shield size={14} className="text-ghost-accent shrink-0" />
        <p className="text-[10px] text-ghost-muted">
          <span className="text-white font-medium">Guild isolation is active.</span> Ghost only responds in the configured
          guild (DISCORD_GUILD_ID) and ignores all other servers for security.
        </p>
      </div>
    </div>
  );
}
