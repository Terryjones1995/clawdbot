'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Twitter, Plus, Unlink, RefreshCw, TrendingUp, Heart, Repeat2, Eye, MessageCircle, CheckCircle2 } from 'lucide-react';
import { formatRelative } from '@/lib/utils';

interface XAccount {
  id:           string;
  handle:       string;
  displayName:  string;
  avatar:       string;
  color:        string;
  followers:    number;
  following:    number;
  verified:     boolean;
  connected:    boolean;
  connectedAt:  string;
  permissions:  string[];
  agent:        string;
  lastPost?:    string;
}

interface Tweet {
  id:        string;
  accountId: string;
  content:   string;
  postedAt:  string;
  likes:     number;
  reposts:   number;
  replies:   number;
  views:     number;
}

const ACCOUNTS: XAccount[] = [
  {
    id:          'crow',
    handle:      '@GhostSystemX',
    displayName: 'Ghost System',
    avatar:      '⬡',
    color:       '#1DA1F2',
    followers:   247,
    following:   89,
    verified:    false,
    connected:   true,
    connectedAt: new Date(Date.now()-86400000*14).toISOString(),
    permissions: ['READ', 'WRITE', 'DM'],
    agent:       'crow',
    lastPost:    new Date(Date.now()-3600000*4).toISOString(),
  },
];

const RECENT_TWEETS: Tweet[] = [
  {
    id:       '1',
    accountId:'crow',
    content:  '🔍 Ghost Scout just finished a deep research run on HOF League draft trends. 14 sources, 3.2k tokens, delivered in under 2s via Grok. The AI agent era is here.',
    postedAt: new Date(Date.now()-3600000*4).toISOString(),
    likes:    14, reposts: 3, replies: 2, views: 892,
  },
  {
    id:       '2',
    accountId:'crow',
    content:  'Running Operation Ghost — a 12-agent AI system built on Discord. Every message gets classified, routed, and answered by specialized agents. Zero manual work. 🤖',
    postedAt: new Date(Date.now()-86400000).toISOString(),
    likes:    31, reposts: 7, replies: 5, views: 2140,
  },
  {
    id:       '3',
    accountId:'crow',
    content:  'Free-first AI routing: 1847 calls today to local Ollama (qwen3:8b) → $0.00. Only escalate to paid APIs when actually needed. Cost optimization built into the architecture.',
    postedAt: new Date(Date.now()-86400000*3).toISOString(),
    likes:    48, reposts: 12, replies: 9, views: 4320,
  },
];

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.07 } } },
  item:      { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } },
};

function AccountCard({ account }: { account: XAccount }) {
  const tweets = RECENT_TWEETS.filter(t => t.accountId === account.id);

  return (
    <motion.div
      variants={stagger.item}
      className="glass rounded-2xl overflow-hidden"
      style={{ border: `1px solid ${account.color}20` }}
    >
      {/* Account header */}
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl relative shrink-0"
                 style={{ background: `${account.color}15`, border: `2px solid ${account.color}30` }}>
              {account.avatar}
              {account.connected && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-400 border-2 border-ghost-bg" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>{account.displayName}</p>
                {account.verified && <CheckCircle2 size={13} style={{ color: account.color }} />}
              </div>
              <p className="text-[10px] font-mono" style={{ color: account.color }}>{account.handle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-2 py-0.5 rounded-full font-mono text-green-400"
                  style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
              CONNECTED
            </span>
            <button className="w-7 h-7 flex items-center justify-center rounded-lg text-ghost-muted/50 hover:text-red-400 hover:bg-red-400/5 transition-all"
                    title="Disconnect account">
              <Unlink size={12} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Followers', value: account.followers.toLocaleString() },
            { label: 'Following', value: account.following.toLocaleString() },
            { label: 'Agent',     value: account.agent },
          ].map(stat => (
            <div key={stat.label} className="text-center p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <p className="text-sm font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>{stat.value}</p>
              <p className="text-[9px] text-ghost-muted/60 uppercase tracking-wider mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Permissions */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {account.permissions.map(p => (
            <span key={p} className="text-[9px] px-2 py-0.5 rounded font-mono"
                  style={{ color: account.color, background: `${account.color}12`, border: `1px solid ${account.color}20` }}>
              {p}
            </span>
          ))}
        </div>

        <p className="text-[9px] text-ghost-muted/40 font-mono">
          Connected {formatRelative(account.connectedAt)}
          {account.lastPost && ` · Last post ${formatRelative(account.lastPost)}`}
        </p>
      </div>

      {/* Recent tweets */}
      {tweets.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="text-[9px] text-ghost-muted/40 uppercase tracking-wider px-5 pt-4 pb-2">Recent Posts</p>
          <div className="space-y-0">
            {tweets.map((tweet, i) => (
              <div key={tweet.id} className={`px-5 py-3 hover:bg-white/[0.02] transition-all ${i < tweets.length-1 ? 'border-b border-white/[0.04]' : ''}`}>
                <p className="text-[11px] text-ghost-muted leading-relaxed mb-2">{tweet.content}</p>
                <div className="flex items-center gap-4 text-[9px] text-ghost-muted/40 font-mono">
                  <span className="flex items-center gap-1"><Heart size={9} />{tweet.likes}</span>
                  <span className="flex items-center gap-1"><Repeat2 size={9} />{tweet.reposts}</span>
                  <span className="flex items-center gap-1"><MessageCircle size={9} />{tweet.replies}</span>
                  <span className="flex items-center gap-1"><Eye size={9} />{tweet.views.toLocaleString()}</span>
                  <span className="ml-auto">{formatRelative(tweet.postedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function SocialPage() {
  const [showConnect, setShowConnect] = useState(false);

  const totalFollowers = ACCOUNTS.reduce((s, a) => s + a.followers, 0);
  const totalPosts     = RECENT_TWEETS.length;
  const totalLikes     = RECENT_TWEETS.reduce((s, t) => s + t.likes, 0);
  const totalViews     = RECENT_TWEETS.reduce((s, t) => s + t.views, 0);

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Twitter size={16} className="text-[#1DA1F2]" />
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>X Accounts</h2>
          </div>
          <p className="text-xs text-ghost-muted">Connected X/Twitter accounts managed by Crow agent</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                  style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => setShowConnect(!showConnect)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-ghost-accent bg-ghost-accent/10 hover:bg-ghost-accent/20 transition-all"
            style={{ border: '1px solid rgba(0,212,255,0.2)' }}
          >
            <Plus size={13} />
            Connect Account
          </button>
        </div>
      </div>

      {/* Connect flow (placeholder) */}
      {showConnect && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden mb-6"
        >
          <div className="glass rounded-2xl p-5" style={{ border: '1px solid rgba(29,161,242,0.2)' }}>
            <p className="text-xs font-semibold text-white mb-2" style={{ fontFamily: 'Space Grotesk' }}>Connect X Account</p>
            <p className="text-[10px] text-ghost-muted mb-4">
              Authorize Ghost to read and post on behalf of your X account. Crow agent will manage
              scheduled posts, engagement analytics, and automated responses.
            </p>
            <div className="flex gap-2">
              <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-[#1DA1F2]/20 text-[#1DA1F2] hover:bg-[#1DA1F2]/30 transition-all"
                      style={{ border: '1px solid rgba(29,161,242,0.3)' }}>
                <Twitter size={13} />
                Authorize with X
              </button>
              <button onClick={() => setShowConnect(false)} className="px-4 py-2 rounded-lg text-xs text-ghost-muted hover:text-white hover:bg-white/5 transition-all">
                Cancel
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* KPI stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Followers', value: totalFollowers.toLocaleString(), icon: TrendingUp, color: '#1DA1F2' },
          { label: 'Posts Tracked',   value: totalPosts,                       icon: Twitter,    color: '#10B981' },
          { label: 'Total Likes',     value: totalLikes,                        icon: Heart,      color: '#E91E63' },
          { label: 'Impressions',     value: totalViews.toLocaleString(),       icon: Eye,        color: '#F59E0B' },
        ].map(kpi => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-xl p-4"
            style={{ border: `1px solid ${kpi.color}20` }}
          >
            <kpi.icon size={14} style={{ color: kpi.color }} className="mb-2" />
            <p className="text-xl font-bold text-white mb-0.5" style={{ fontFamily: 'Space Grotesk' }}>{kpi.value}</p>
            <p className="text-[10px] text-ghost-muted">{kpi.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Account cards */}
      <motion.div variants={stagger.container} initial="initial" animate="animate" className="space-y-4">
        {ACCOUNTS.length === 0 ? (
          <div className="glass rounded-2xl p-16 text-center">
            <Twitter size={32} className="text-ghost-muted/20 mx-auto mb-4" />
            <p className="text-sm font-semibold text-white mb-2" style={{ fontFamily: 'Space Grotesk' }}>No accounts connected</p>
            <p className="text-xs text-ghost-muted/50 mb-6">Connect an X account to enable Crow agent social automation</p>
            <button
              onClick={() => setShowConnect(true)}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-[#1DA1F2]/20 text-[#1DA1F2] hover:bg-[#1DA1F2]/30 transition-all"
              style={{ border: '1px solid rgba(29,161,242,0.3)' }}
            >
              Connect First Account
            </button>
          </div>
        ) : (
          ACCOUNTS.map(account => <AccountCard key={account.id} account={account} />)
        )}
      </motion.div>

      {/* Crow agent info */}
      <div className="mt-6 glass rounded-xl p-4 flex items-center gap-3"
           style={{ border: '1px solid rgba(29,161,242,0.08)' }}>
        <Twitter size={14} className="text-[#1DA1F2] shrink-0" />
        <p className="text-[10px] text-ghost-muted">
          <span className="text-white font-medium">Crow Agent</span> manages all X/Twitter automation — scheduling posts,
          monitoring mentions, tracking engagement, and drafting content with Scribe.
        </p>
      </div>
    </div>
  );
}
