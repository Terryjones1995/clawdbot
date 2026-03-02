'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGhostStore, type TerminalLine } from '@/store';
import { formatRelative } from '@/lib/utils';
import { X, Minus, Maximize2, ChevronRight, Loader2, Terminal as TerminalIcon, Copy, Check, ThumbsUp, ThumbsDown } from 'lucide-react';

const COMMANDS = [
  '/help', '/agents', '/status', '/ping', '/jobs', '/logs tail',
  '/run job:', '/ask ', '/reload', '/clear', '/who',
];

const HELP_TEXT = `
GHOST OS — Terminal v2.0  |  Created by Terry
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMANDS:
  /help              Show this help
  /agents            List all agent statuses
  /status            System health overview
  /ping <agent>      Ping a specific agent
  /jobs              Show job queue summary
  /logs tail [n]     Tail last N log entries
  /ask <question>    Send message to Ghost reception
  /clear             Clear terminal
  /who               Current user info

EXAMPLES:
  /ping sentinel
  /ask what is my team record?
  /logs tail 20

Any message without / prefix is sent to Ghost reception.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

export function Terminal() {
  const {
    terminalLines, terminalOpen, pushTerminalLine, clearTerminal,
    setTerminalOpen, agents, wsConnected,
  } = useGhostStore();

  const [input,       setInput]       = useState('');
  const [history,     setHistory]     = useState<string[]>([]);
  const [historyIdx,  setHistoryIdx]  = useState(-1);
  const [loading,     setLoading]     = useState(false);
  const [height,      setHeight]      = useState(320);
  const [maximized,   setMaximized]   = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const [copiedId,  setCopiedId]  = useState<string | null>(null);
  const [feedback,  setFeedback]  = useState<Record<string, number>>({});

  function copyLine(id: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  function copyAll() {
    const text = terminalLines.map(l => `${linePrefix(l.type)}${l.content}`).join('\n');
    navigator.clipboard.writeText(text);
  }

  async function sendFeedback(lineId: string, content: string, rating: number) {
    setFeedback(f => ({ ...f, [lineId]: rating }));
    try {
      await fetch('/api/feedback', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ threadId: 'portal-unknown', content, rating }),
      });
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLines]);

  useEffect(() => {
    if (terminalOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [terminalOpen]);

  // Autocomplete
  useEffect(() => {
    if (input.startsWith('/') && input.length > 1) {
      const matches = COMMANDS.filter(c => c.startsWith(input));
      setSuggestions(matches.slice(0, 5));
    } else {
      setSuggestions([]);
    }
  }, [input]);

  const send = useCallback(async (cmd: string) => {
    if (!cmd.trim()) return;

    pushTerminalLine({ type: 'input', content: cmd });
    setHistory(h => [cmd, ...h.slice(0, 49)]);
    setHistoryIdx(-1);
    setInput('');
    setSuggestions([]);

    // Built-in commands
    if (cmd === '/clear') { clearTerminal(); return; }

    if (cmd === '/help') {
      pushTerminalLine({ type: 'output', content: HELP_TEXT });
      return;
    }

    if (cmd === '/agents') {
      const lines = Object.values(agents).map(a =>
        `  ${a.name.padEnd(14)} ${a.status.padEnd(10)} ${a.role}`
      ).join('\n');
      pushTerminalLine({ type: 'output', content: `AGENTS:\n${lines}` });
      return;
    }

    if (cmd === '/status') {
      const online  = Object.values(agents).filter(a => a.status !== 'offline').length;
      const working = Object.values(agents).filter(a => a.status === 'working').length;
      pushTerminalLine({
        type:    'output',
        content: `SYSTEM STATUS:\n  WS: ${wsConnected ? '✓ connected' : '✗ disconnected'}\n  Agents online: ${online}/12\n  Agents working: ${working}\n  Gateway: ${process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:18789'}`,
      });
      return;
    }

    if (cmd === '/who') {
      pushTerminalLine({ type: 'output', content: 'User: admin | Role: admin | Org: Ghost' });
      return;
    }

    if (cmd.startsWith('/ping ')) {
      const target = cmd.slice(6).trim();
      const agent  = agents[target.toLowerCase()];
      if (!agent) {
        pushTerminalLine({ type: 'error', content: `Agent "${target}" not found. Try /agents` });
        return;
      }
      pushTerminalLine({ type: 'output', content: `PING ${agent.name}: status=${agent.status}` });
      return;
    }

    if (cmd.startsWith('/ask ')) {
      const question = cmd.slice(5).trim();
      await sendToReception(question);
      return;
    }

    // Default: send to Ghost reception
    await sendToReception(cmd);
  }, [agents, wsConnected, pushTerminalLine, clearTerminal]);

  async function sendToReception(text: string) {
    setLoading(true);
    pushTerminalLine({ type: 'thinking', content: '⟳ Routing to Ghost reception...' });

    try {
      const res  = await fetch('/api/terminal', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text }),
      });
      const data = await res.json();

      if (data.error) {
        pushTerminalLine({ type: 'error', content: `Error: ${data.error}` });
      } else {
        pushTerminalLine({
          type:    'output',
          content: `[Ghost] ${data.reply ?? data.answer ?? 'No response'}`,
        });
      }
    } catch {
      pushTerminalLine({ type: 'error', content: 'Connection failed. Is Ghost running?' });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !loading) {
      send(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(idx);
      if (history[idx]) setInput(history[idx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(idx);
      setInput(idx === -1 ? '' : history[idx]);
    } else if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      setInput(suggestions[0]);
      setSuggestions([]);
    } else if (e.key === 'Escape') {
      setTerminalOpen(false);
    }
  }

  function lineColor(type: TerminalLine['type']) {
    switch (type) {
      case 'input':   return '#00D4FF';
      case 'error':   return '#EF4444';
      case 'system':  return '#7C3AED';
      case 'thinking': return '#F59E0B';
      default:        return '#CBD5E1';
    }
  }

  function linePrefix(type: TerminalLine['type']) {
    switch (type) {
      case 'input':    return '> ';
      case 'error':    return '✗ ';
      case 'system':   return '⬡ ';
      case 'thinking': return '⟳ ';
      default:         return '  ';
    }
  }

  // Mobile: always maximize to full screen; Desktop: resizable or maximized
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const terminalHeight = (maximized || isMobile) ? 'calc(100dvh - 56px)' : `${height}px`;

  return (
    <AnimatePresence>
      {terminalOpen && (
        <motion.div
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col"
          style={{
            height:         terminalHeight,
            paddingBottom:  'env(safe-area-inset-bottom, 0px)',
            background:     'rgba(4, 8, 18, 0.98)',
            backdropFilter: 'blur(20px)',
            borderTop:      '1px solid rgba(0,212,255,0.2)',
            boxShadow:      '0 -20px 60px rgba(0,0,0,0.6), 0 -4px 20px rgba(0,212,255,0.05)',
          }}
        >
          {/* Title bar */}
          <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 h-11 sm:h-9 shrink-0"
               style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <TerminalIcon size={14} className="text-ghost-accent sm:w-3 sm:h-3" />
            <span className="text-xs font-mono font-medium text-ghost-accent/80 tracking-wider">
              GHOST TERMINAL
            </span>
            <span className={`ml-1 text-[10px] font-mono hidden sm:inline ${wsConnected ? 'text-green-400' : 'text-red-400'}`}>
              ● {wsConnected ? 'live' : 'offline'}
            </span>
            <div className="flex-1" />

            <div className="flex items-center gap-0.5 sm:gap-1">
              <button onClick={copyAll}
                      className="px-2 py-1 text-[10px] text-ghost-muted hover:text-white transition-colors font-mono hidden sm:block">
                COPY ALL
              </button>
              <button onClick={clearTerminal}
                      className="px-2 py-1 text-[10px] text-ghost-muted hover:text-white transition-colors font-mono">
                CLEAR
              </button>
              <button onClick={() => setMaximized(!maximized)}
                      className="w-8 h-8 sm:w-6 sm:h-6 flex items-center justify-center text-ghost-muted hover:text-white transition-colors hidden sm:flex">
                <Maximize2 size={13} />
              </button>
              <button onClick={() => setTerminalOpen(false)}
                      className="w-8 h-8 sm:w-6 sm:h-6 flex items-center justify-center text-ghost-muted hover:text-red-400 transition-colors">
                <X size={14} className="sm:w-3 sm:h-3" />
              </button>
            </div>
          </div>

          {/* Output — click/tap empty space to refocus input */}
          <div
            className="flex-1 overflow-y-auto p-3 sm:p-4 terminal-text space-y-1 sm:space-y-0.5"
            onMouseUp={(e) => {
              if (window.getSelection()?.toString()) return;
              if (e.target === e.currentTarget) inputRef.current?.focus();
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) inputRef.current?.focus();
            }}
          >
            {terminalLines.map((line) => (
              <div key={line.id} className="flex gap-1.5 sm:gap-2 group items-start">
                <span className="text-ghost-muted/30 text-[9px] sm:text-[10px] shrink-0 pt-px font-mono select-none hidden sm:inline">
                  {new Date(line.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <pre
                  className="whitespace-pre-wrap break-words flex-1 text-xs leading-relaxed"
                  style={{ color: lineColor(line.type), fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {linePrefix(line.type)}{line.content}
                </pre>
                <button
                  onClick={() => copyLine(line.id, line.content)}
                  className="opacity-0 group-hover:opacity-100 shrink-0 mt-0.5 text-ghost-muted/40 hover:text-ghost-accent transition-all"
                  title="Copy"
                >
                  {copiedId === line.id
                    ? <Check size={10} className="text-green-400" />
                    : <Copy size={10} />
                  }
                </button>
                {line.type === 'output' && (
                  <>
                    <button
                      onClick={() => sendFeedback(line.id, line.content, 1)}
                      className={`opacity-0 group-hover:opacity-100 shrink-0 mt-0.5 transition-all ${feedback[line.id] === 1 ? 'text-green-400' : 'text-ghost-muted/40 hover:text-green-400'}`}
                      title="Good response"
                    >
                      <ThumbsUp size={10} />
                    </button>
                    <button
                      onClick={() => sendFeedback(line.id, line.content, -1)}
                      className={`opacity-0 group-hover:opacity-100 shrink-0 mt-0.5 transition-all ${feedback[line.id] === -1 ? 'text-red-400' : 'text-ghost-muted/40 hover:text-red-400'}`}
                      title="Bad response"
                    >
                      <ThumbsDown size={10} />
                    </button>
                  </>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-2 items-center">
                <Loader2 size={12} className="text-amber-400 animate-spin" />
                <span className="text-amber-400 text-xs font-mono">Processing...</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Autocomplete */}
          <AnimatePresence>
            {suggestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="px-4 pb-1 flex flex-wrap gap-1"
              >
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); setSuggestions([]); inputRef.current?.focus(); }}
                    className="text-[10px] px-2 py-0.5 rounded text-ghost-accent/70 hover:text-ghost-accent hover:bg-ghost-accent/10 transition-all font-mono"
                    style={{ border: '1px solid rgba(0,212,255,0.15)' }}
                  >
                    {s}
                  </button>
                ))}
                <span className="text-[10px] text-ghost-muted/30 font-mono self-center ml-1">TAB to complete</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input bar */}
          <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3"
               style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <ChevronRight size={14} className="text-ghost-accent shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Ghost... (/help)"
              disabled={loading}
              className="flex-1 bg-transparent text-sm sm:text-xs text-white placeholder-ghost-muted/30 outline-none terminal-text disabled:opacity-50"
              style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '16px' }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
            {loading && <Loader2 size={13} className="text-ghost-accent animate-spin shrink-0" />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
