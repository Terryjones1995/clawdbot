'use client';

import { useEffect, useRef } from 'react';
import { useGhostStore, ForgeProgressEvent } from '@/store';

export function useGhostWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const { upsertAgent, setAgentStatus, pushAgentEvent, pushMessage, setWsConnected, setForgeProgress, setTerminalOpen, pushTerminalLine } = useGhostStore();

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:18790';

    function connect() {
      try {
        ws.current = new WebSocket(`${wsUrl}/ws`);

        ws.current.onopen = () => {
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
          // Reconnect after 3s
          setTimeout(connect, 3000);
        };

        ws.current.onerror = () => {
          setWsConnected(false);
          ws.current?.close();
        };
      } catch {
        setWsConnected(false);
        setTimeout(connect, 5000);
      }
    }

    connect();
    return () => {
      ws.current?.close();
    };
  }, []);
}
