'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, signOut } from 'next-auth/react';
import { useGhostStore } from '@/store';
import { formatRelative } from '@/lib/utils';
import {
  Search, Terminal, RotateCcw, Bell, LogOut, User,
  Zap, Wifi, WifiOff, ChevronDown, Activity,
} from 'lucide-react';

interface TopBarProps {
  title: string;
  orgId: string;
}

export function TopBar({ title, orgId }: TopBarProps) {
  const { data: session } = useSession();
  const { wsConnected, agents, terminalOpen, setTerminalOpen } = useGhostStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen,   setSearchOpen]   = useState(false);

  const workingAgents = Object.values(agents).filter(a => a.status === 'working');
  const onlineAgents  = Object.values(agents).filter(a => a.status !== 'offline');
  const errorAgents   = Object.values(agents).filter(a => a.status === 'error');

  return (
    <header className="flex items-center gap-4 px-6 h-14 shrink-0 z-10 relative"
            style={{
              background:    'rgba(5, 10, 20, 0.9)',
              backdropFilter: 'blur(12px)',
              borderBottom:  '1px solid rgba(255,255,255,0.05)',
            }}>

      {/* Page title */}
      <div className="flex items-center gap-3 min-w-0 mr-4">
        <Activity size={14} className="text-ghost-accent shrink-0" />
        <h1 className="text-sm font-semibold text-white truncate tracking-wider uppercase"
            style={{ fontFamily: 'Space Grotesk' }}>
          {title}
        </h1>
      </div>

      {/* Search bar */}
      <motion.div
        animate={{ width: searchOpen ? 280 : 160 }}
        className="relative"
      >
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost-muted pointer-events-none" />
        <input
          type="text"
          placeholder={searchOpen ? 'Search agents, jobs, logs...' : '⌘K Search'}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setSearchOpen(false)}
          className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs text-ghost-text placeholder-ghost-muted/40 transition-all"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border:     '1px solid rgba(255,255,255,0.06)',
            outline:    'none',
          }}
        />
      </motion.div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Live agent activity badges */}
      <div className="flex items-center gap-2">
        {workingAgents.length > 0 && (
          <motion.div
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}
          >
            <span className="status-dot working w-1.5 h-1.5" />
            <span className="text-amber-400 font-medium">{workingAgents.length} active</span>
          </motion.div>
        )}

        {errorAgents.length > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
               style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="text-red-400 font-medium">⚠ {errorAgents.length} error</span>
          </div>
        )}

        {/* WS status */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all ${
          wsConnected
            ? 'text-green-400'
            : 'text-ghost-muted'
        }`}
             style={{
               background: wsConnected ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.03)',
               border:     `1px solid ${wsConnected ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)'}`,
             }}>
          {wsConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
          <span className="font-medium">{wsConnected ? 'Live' : 'Offline'}</span>
        </div>

        {/* Terminal toggle */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setTerminalOpen(!terminalOpen)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            terminalOpen
              ? 'text-ghost-accent bg-ghost-accent/15'
              : 'text-ghost-muted hover:text-white hover:bg-white/5'
          }`}
          style={{ border: `1px solid ${terminalOpen ? 'rgba(0,212,255,0.25)' : 'rgba(255,255,255,0.06)'}` }}
        >
          <Terminal size={13} />
          <span className="hidden sm:inline">Terminal</span>
        </motion.button>

        {/* Refresh */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ rotate: 180 }}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
          style={{ border: '1px solid rgba(255,255,255,0.06)' }}
          onClick={() => window.location.reload()}
        >
          <RotateCcw size={13} />
        </motion.button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-all"
          >
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                 style={{ background: 'linear-gradient(135deg, #4A90E2, #7C3AED)' }}>
              {session?.user?.name?.[0]?.toUpperCase() ?? 'T'}
            </div>
            <span className="text-xs text-ghost-muted hidden sm:inline">
              {session?.user?.name ?? 'User'}
            </span>
            <ChevronDown size={11} className="text-ghost-muted hidden sm:inline" />
          </button>

          <AnimatePresence>
            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-48 rounded-xl z-50 py-1"
                  style={{
                    background: '#0A1628',
                    border:     '1px solid rgba(0,212,255,0.15)',
                    boxShadow:  '0 16px 40px rgba(0,0,0,0.5)',
                  }}
                >
                  <div className="px-4 py-2 border-b border-white/5">
                    <p className="text-xs font-semibold text-white">{session?.user?.name}</p>
                    <p className="text-[10px] text-ghost-muted capitalize">{(session?.user as any)?.role ?? 'user'}</p>
                  </div>
                  <button
                    onClick={() => { setUserMenuOpen(false); signOut({ callbackUrl: '/login' }); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-xs text-ghost-muted hover:text-red-400 hover:bg-red-500/5 transition-all"
                  >
                    <LogOut size={13} />
                    Sign out
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
