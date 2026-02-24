'use client';

import { useState, useEffect, useRef } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { Eye, EyeOff, Loader2, AlertCircle, ChevronRight } from 'lucide-react';

const PARTICLES = Array.from({ length: 60 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  y: Math.random() * 100,
  size: Math.random() * 2 + 0.5,
  speed: Math.random() * 20 + 10,
  opacity: Math.random() * 0.5 + 0.1,
  delay: Math.random() * 5,
}));

const GRID_LINES = Array.from({ length: 12 }, (_, i) => i);

export default function LoginPage() {
  const router    = useRouter();
  const { data: session, status } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [mounted,  setMounted]  = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    setTimeout(() => inputRef.current?.focus(), 800);
  }, []);

  useEffect(() => {
    if (session) router.push('/org/ghost/overview');
  }, [session, router]);

  if (status === 'loading') return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError('');

    const res = await signIn('credentials', {
      username, password, redirect: false,
    });

    setLoading(false);
    if (res?.error) {
      setError('Invalid credentials. Access denied.');
    } else {
      router.push('/org/ghost/overview');
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center"
         style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(0,100,180,0.15) 0%, #050A14 60%)' }}>

      {/* Background grid */}
      <div className="absolute inset-0 bg-grid opacity-40" />

      {/* Animated grid pulse */}
      {mounted && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
          {GRID_LINES.map((i) => (
            <motion.line
              key={`h${i}`}
              x1="0" y1={`${(i / 12) * 100}%`}
              x2="100%" y2={`${(i / 12) * 100}%`}
              stroke="rgba(0,212,255,0.05)"
              strokeWidth="1"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 2, delay: i * 0.1, ease: 'easeOut' }}
            />
          ))}
        </svg>
      )}

      {/* Floating particles */}
      {mounted && PARTICLES.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${p.x}%`,
            top:  `${p.y}%`,
            width:  p.size,
            height: p.size,
            background: '#00D4FF',
            opacity: p.opacity,
          }}
          animate={{
            y: [0, -30, 0],
            opacity: [p.opacity, p.opacity * 2, p.opacity],
          }}
          transition={{
            duration: p.speed,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}

      {/* Central glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
           style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.06) 0%, transparent 70%)' }} />

      {/* Main card */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md px-4"
      >
        {/* Logo + branding */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="text-center mb-8"
        >
          {/* Ghost logo */}
          <div className="relative inline-block mb-6">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-[-20px] rounded-full"
              style={{
                background: 'conic-gradient(from 0deg, transparent 60%, rgba(0,212,255,0.6) 100%)',
                filter: 'blur(2px)',
              }}
            />
            <div className="relative w-24 h-24 flex items-center justify-center"
                 style={{ filter: 'drop-shadow(0 0 20px rgba(0,212,255,0.5))' }}>
              <Image src="/logo.png" alt="Ghost" width={96} height={96} style={{ objectFit: 'contain' }} priority />
            </div>
            {/* Orbital dot */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-0"
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-ghost-accent"
                   style={{ boxShadow: '0 0 8px #00D4FF' }} />
            </motion.div>
            <motion.div
              animate={{ rotate: -360 }}
              transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-[-8px]"
            >
              <div className="absolute bottom-2 right-0 w-1.5 h-1.5 rounded-full"
                   style={{ background: '#7C3AED', boxShadow: '0 0 6px #7C3AED' }} />
            </motion.div>
          </div>

          <h1 className="text-2xl font-bold tracking-wide text-white mb-1"
              style={{ fontFamily: 'Space Grotesk', letterSpacing: '0.1em' }}>
            OPERATION GHOST
          </h1>
          <p className="text-xs tracking-[0.3em] text-ghost-accent/70 uppercase mb-1">
            Mission Control Center
          </p>
          <p className="text-xs text-ghost-muted tracking-[0.2em] uppercase">
            Command · Automate · Dominate
          </p>
        </motion.div>

        {/* Login form */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="glass rounded-2xl p-8 relative overflow-hidden"
          style={{ boxShadow: '0 0 60px rgba(0,212,255,0.08), 0 0 120px rgba(0,212,255,0.04)' }}
        >
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-16 h-16 pointer-events-none"
               style={{ background: 'linear-gradient(135deg, rgba(0,212,255,0.15) 0%, transparent 60%)' }} />
          <div className="absolute bottom-0 right-0 w-16 h-16 pointer-events-none"
               style={{ background: 'linear-gradient(315deg, rgba(124,58,237,0.15) 0%, transparent 60%)' }} />

          <div className="mb-6">
            <p className="text-sm text-ghost-muted mb-1">SECURE ACCESS</p>
            <h2 className="text-lg font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>
              Authenticate to continue
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-xs text-ghost-muted mb-2 tracking-wider uppercase">
                Username
              </label>
              <input
                ref={inputRef}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-ghost-muted/50 transition-all"
                style={{
                  background:   'rgba(255,255,255,0.04)',
                  border:       '1px solid rgba(255,255,255,0.08)',
                  fontFamily:   'JetBrains Mono, monospace',
                  outline:      'none',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(0,212,255,0.5)';
                  e.target.style.boxShadow = '0 0 0 3px rgba(0,212,255,0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255,255,255,0.08)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs text-ghost-muted mb-2 tracking-wider uppercase">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  className="w-full px-4 py-3 pr-12 rounded-xl text-sm text-white placeholder-ghost-muted/50 transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border:     '1px solid rgba(255,255,255,0.08)',
                    fontFamily: 'JetBrains Mono, monospace',
                    outline:    'none',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'rgba(0,212,255,0.5)';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0,212,255,0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(255,255,255,0.08)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ghost-muted hover:text-ghost-accent transition-colors"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
                >
                  <AlertCircle size={14} />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <motion.button
              type="submit"
              disabled={loading || !username || !password}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed mt-2"
              style={{
                background: 'linear-gradient(135deg, rgba(0,212,255,0.8) 0%, rgba(0,153,204,0.9) 100%)',
                boxShadow:  '0 0 20px rgba(0,212,255,0.25)',
                fontFamily: 'Space Grotesk',
                letterSpacing: '0.05em',
              }}
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> AUTHENTICATING...</>
              ) : (
                <>ENTER COMMAND CENTER <ChevronRight size={16} /></>
              )}
            </motion.button>
          </form>

          {/* Auth hint */}
          <div className="mt-6 pt-4 border-t border-white/5">
            <p className="text-center text-xs text-ghost-muted/60">
              Secured with 256-bit encryption · Ghost OS v2.0
            </p>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-center text-xs text-ghost-muted/40 mt-6 tracking-wider"
        >
          Created by Terry · Operation Ghost © 2026
        </motion.p>
      </motion.div>
    </div>
  );
}
