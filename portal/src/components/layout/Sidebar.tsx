'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useGhostStore } from '@/store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, Briefcase, CheckSquare, ScrollText,
  Settings, CreditCard, Server, Twitter,
  AlertTriangle, ChevronLeft, ChevronRight, Activity,
} from 'lucide-react';

const NAV = [
  { href: 'overview',  label: 'Overview',     icon: LayoutDashboard, section: 'main' },
  { href: 'agents',    label: 'Agents',        icon: Users,           section: 'main' },
  { href: 'jobs',      label: 'Jobs',          icon: Briefcase,       section: 'main' },
  { href: 'tasks',     label: 'Tasks',         icon: CheckSquare,     section: 'main' },
  { href: 'logs',      label: 'Logs',          icon: ScrollText,      section: 'main' },
  { href: 'errors',    label: 'Error Logs',    icon: AlertTriangle,   section: 'monitor', badge: 'live' },
  { href: 'credits',   label: 'API Credits',   icon: CreditCard,      section: 'monitor' },
  { href: 'servers',   label: 'Servers',       icon: Server,          section: 'monitor' },
  { href: 'social',    label: 'X Accounts',    icon: Twitter,         section: 'monitor' },
  { href: 'settings',  label: 'Settings',      icon: Settings,        section: 'system' },
];

interface SidebarProps {
  orgId: string;
}

export function Sidebar({ orgId }: SidebarProps) {
  const pathname   = usePathname();
  const { sidebarCollapsed, setSidebarCollapsed, wsConnected, agents } = useGhostStore();

  const onlineCount  = Object.values(agents).filter(a => a.status === 'online' || a.status === 'working').length;
  const workingCount = Object.values(agents).filter(a => a.status === 'working').length;

  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarCollapsed ? 64 : 220 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex flex-col h-full shrink-0 overflow-hidden z-20"
      style={{
        background:  'rgba(5, 10, 20, 0.95)',
        borderRight: '1px solid rgba(0,212,255,0.08)',
      }}
    >
      {/* Top brand */}
      <div className="flex items-center gap-3 px-4 h-16 shrink-0"
           style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="relative shrink-0 w-9 h-9" style={{ filter: 'drop-shadow(0 0 8px rgba(0,212,255,0.5))' }}>
          <Image src="/logo.png" alt="Ghost" width={36} height={36} style={{ objectFit: 'contain' }} priority />
        </div>

        <AnimatePresence>
          {!sidebarCollapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden whitespace-nowrap"
            >
              <p className="text-xs font-bold tracking-[0.15em] text-white leading-none"
                 style={{ fontFamily: 'Space Grotesk' }}>GHOST OS</p>
              <p className="text-[10px] text-ghost-accent/60 tracking-[0.1em] mt-0.5">MISSION CONTROL</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status bar */}
      <AnimatePresence>
        {!sidebarCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mx-3 my-2 rounded-lg px-3 py-2 flex items-center gap-2"
            style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.08)' }}
          >
            <span className={cn('status-dot shrink-0', wsConnected ? 'online' : 'offline')} />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-ghost-muted">SYSTEM STATUS</p>
              <p className="text-xs text-white font-medium">
                {onlineCount} online {workingCount > 0 && `· ${workingCount} active`}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 space-y-0.5">
        {(['main', 'monitor', 'system'] as const).map((section) => {
          const items = NAV.filter(n => n.section === section);
          const sectionLabel = section === 'main' ? 'OPERATIONS' : section === 'monitor' ? 'SYSTEMS' : 'CONFIG';

          return (
            <div key={section} className="mb-3">
              <AnimatePresence>
                {!sidebarCollapsed && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-[9px] tracking-[0.2em] text-ghost-muted/40 px-3 py-1 uppercase"
                  >
                    {sectionLabel}
                  </motion.p>
                )}
              </AnimatePresence>

              {items.map((item) => {
                const href    = `/org/${orgId}/${item.href}`;
                const active  = pathname === href || pathname.startsWith(href + '/');
                const Icon    = item.icon;

                return (
                  <Link key={item.href} href={href}>
                    <motion.div
                      whileHover={{ x: 2 }}
                      transition={{ duration: 0.1 }}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all relative group',
                        active
                          ? 'text-ghost-accent bg-ghost-accent/10'
                          : 'text-ghost-muted hover:text-white hover:bg-white/5',
                        sidebarCollapsed && 'justify-center px-0'
                      )}
                    >
                      {active && (
                        <motion.div
                          layoutId="activeNav"
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-ghost-accent"
                        />
                      )}

                      <Icon size={16} className={cn('shrink-0', active && 'drop-shadow-[0_0_6px_rgba(0,212,255,0.8)]')} />

                      <AnimatePresence>
                        {!sidebarCollapsed && (
                          <motion.span
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 whitespace-nowrap text-xs font-medium tracking-wide"
                            style={{ fontFamily: 'Space Grotesk' }}
                          >
                            {item.label}
                          </motion.span>
                        )}
                      </AnimatePresence>

                      {item.badge && !sidebarCollapsed && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono tracking-wider"
                              style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>
                          {item.badge}
                        </span>
                      )}

                      {/* Tooltip when collapsed */}
                      {sidebarCollapsed && (
                        <div className="absolute left-14 whitespace-nowrap px-2 py-1 rounded-md text-xs text-white pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50"
                             style={{ background: '#0A1628', border: '1px solid rgba(0,212,255,0.2)' }}>
                          {item.label}
                        </div>
                      )}
                    </motion.div>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Bottom: user + collapse */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }} className="px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
               style={{ background: 'linear-gradient(135deg, #4A90E2, #7C3AED)' }}>
            T
          </div>
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-w-0"
              >
                <p className="text-xs font-medium text-white truncate">Taylor</p>
                <p className="text-[10px] text-ghost-muted/60">Admin</p>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="ml-auto shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-ghost-muted hover:text-ghost-accent hover:bg-ghost-accent/10 transition-all"
          >
            {sidebarCollapsed
              ? <ChevronRight size={14} />
              : <ChevronLeft size={14} />}
          </button>
        </div>
      </div>
    </motion.aside>
  );
}
