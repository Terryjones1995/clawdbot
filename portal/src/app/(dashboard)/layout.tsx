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

  // We'll resolve orgId from children context — use a fixed org for now
  const orgId = 'ghost';

  // Map pathname to title
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
    if (path.includes('/settings'))  return 'Settings';
    return 'Mission Control';
  }

  return (
    <div className="h-screen flex bg-ghost-bg scanline-overlay" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-sm opacity-30 pointer-events-none" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] pointer-events-none"
           style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(0,100,180,0.08) 0%, transparent 70%)' }} />

      {/* Sidebar */}
      <Sidebar orgId={orgId} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar title={getTitle()} orgId={orgId} />

        <main className="flex-1 overflow-y-auto overflow-x-hidden relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={typeof window !== 'undefined' ? window.location.pathname : 'page'}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="h-full"
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
