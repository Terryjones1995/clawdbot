'use client';

import { useEffect, useRef } from 'react';
import { useGhostStore, ForgeProgressEvent } from '@/store';

export function useGhostWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const mountedRef = useRef(true);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const { upsertAgent, setAgentStatus, pushAgentEvent, pushMessage, setWsConnected, setForgeProgress, setTerminalOpen, pushTerminalLine } = useGhostStore();

  // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand selectors are stable store references;
  // adding them as deps would cause reconnect loops since destructured selectors create new refs each render.
  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:18790';

    function connect() {
      try {
        const token = process.env.NEXT_PUBLIC_PORTAL_SECRET ?? '';
        ws.current = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);

        ws.current.onopen = () => {
          retryRef.current = 0;
          setWsConnected(true);
          console.log('[WS] Connected to Ghost');
        };

        ws.current.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data as string);
            switch (msg.type) {
              case 'init':
                if (Array.isArray(msg.agents)) {
                  msg.agents.forEach((a: any) => upsertAgent(a));
                }
                break;
              case 'agent:update':
                if (msg.agent) upsertAgent(msg.agent);
                break;
              case 'agent:event':
                if (msg.id && msg.message) {
                  pushAgentEvent(msg.id, msg.message, msg.eventType || 'info');
                  // Also push as a message for beam animation
                  if (msg.toId) {
                    pushMessage({
                      id:          msg.ts ?? Date.now().toString(),
                      fromAgentId: msg.id,
                      toAgentId:   msg.toId,
                      content:     msg.message,
                      ts:          msg.ts ?? new Date().toISOString(),
                    });
                  }
                }
                break;
              case 'agent/status':
                if (msg.agentId) setAgentStatus(msg.agentId, msg.status);
                break;
              case 'fix-all:start':
              case 'fix-all:item-start':
              case 'fix-all:item-done':
              case 'fix-all:complete':
                setForgeProgress(msg as ForgeProgressEvent);
                break;
              case 'fix-one:start':
                setTerminalOpen(true);
                pushTerminalLine({ type: 'system',
                  content: `⚡ Forge → Claude Code CLI\n  Agent : ${msg.agent || 'unknown'}\n  File  : ${msg.file || 'detecting…'}\n  Status: running (up to 3 min)` });
                setForgeProgress(msg as ForgeProgressEvent);
                break;
              case 'fix-one:output':
                if (msg.text) pushTerminalLine({ type: 'output', content: msg.text });
                break;
              case 'fix-one:complete':
                pushTerminalLine({
                  type:    msg.fixed ? 'output' : 'error',
                  content: msg.fixed ? `✓ ${msg.summary}` : `✗ ${msg.summary}`,
                });
                setForgeProgress(msg as ForgeProgressEvent);
                break;
            }
          } catch { /* ignore parse errors */ }
        };

        ws.current.onclose = () => {
          setWsConnected(false);
          if (!mountedRef.current) return;
          // Exponential backoff: 3s, 4.5s, 6.75s, ... capped at 30s
          const delay = Math.min(3000 * Math.pow(1.5, retryRef.current), 30000);
          retryRef.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        };

        ws.current.onerror = () => {
          setWsConnected(false);
          ws.current?.close();
        };
      } catch {
        setWsConnected(false);
        if (mountedRef.current) {
          reconnectTimer.current = setTimeout(connect, 5000);
        }
      }
    }

    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, []);
}
