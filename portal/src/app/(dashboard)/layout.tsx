'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar }  from '@/components/layout/TopBar';
import { Terminal } from '@/components/layout/Terminal';
import { useGhostWebSocket } from '@/hooks/useWebSocket';
import { useGhostStore } from '@/store';
import { motion, AnimatePresence } from 'framer-motion';

export default function DashboardLayout({ children }: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { mobileMenuOpen, setMobileMenuOpen } = useGhostStore();

  useGhostWebSocket();

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ghost-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-ghost-accent/30 border-t-ghost-accent animate-spin" />
          <p className="text-xs text-ghost-muted tracking-wider font-mono">INITIALIZING GHOST OS...</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const orgId = 'ghost';

  function getTitle() {
    if (typeof window === 'undefined') return 'Mission Control';
    const path = window.location.pathname;
    if (path.includes('/overview'))  return 'System Overview';
    if (path.includes('/agents'))    return 'Agent Network';
    if (path.includes('/jobs'))      return 'Job Queue';
    if (path.includes('/tasks'))     return 'Task Board';
    if (path.includes('/logs'))      return 'Command Logs';
    if (path.includes('/errors'))    return 'Error Console';
    if (path.includes('/credits'))   return 'API Credits';
    if (path.includes('/servers'))   return 'Connected Servers';
    if (path.includes('/social'))    return 'X Accounts';
    if (path.includes('/lessons'))   return 'Agent Lessons';
    if (path.includes('/settings'))  return 'Settings';
    return 'Mission Control';
  }

  return (
    <div className="flex bg-ghost-bg scanline-overlay" style={{ fontFamily: 'Inter, sans-serif', minHeight: '100dvh', height: '100dvh' }}>
      {/* Background effects */}
      <div className="mesh-gradient" />
      <div className="fixed inset-0 bg-grid-sm opacity-30 pointer-events-none" />

      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:block">
        <Sidebar orgId={orgId} />
      </div>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 z-40 md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-y-0 left-0 z-50 md:hidden"
            >
              <Sidebar orgId={orgId} onNavigate={() => setMobileMenuOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar title={getTitle()} orgId={orgId} />

        <main className="flex-1 overflow-y-auto overflow-x-hidden relative"
              style={{ paddingBottom: 'max(5rem, env(safe-area-inset-bottom, 1.25rem))' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={typeof window !== 'undefined' ? window.location.pathname : 'page'}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Global terminal */}
      <Terminal />
    </div>
  );
}
