'use client';

import { useEffect, useRef } from 'react';
import { useGhostStore } from '@/store';

export function useGhostWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const { upsertAgent, setAgentStatus, pushAgentEvent, pushMessage, setWsConnected } = useGhostStore();

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:18789';

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
                  pushAgentEvent(msg.id, msg.message);
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
