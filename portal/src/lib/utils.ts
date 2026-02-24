import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(date));
}

export function formatRelative(date: Date | string) {
  const d   = new Date(date);
  const now = new Date();
  const diffMs  = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60)  return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)  return `${diffMin}m ago`;
  const diffHr  = Math.floor(diffMin / 60);
  if (diffHr < 24)   return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function formatDuration(ms: number) {
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60000)}m ${Math.floor((ms%60000)/1000)}s`;
}

export function formatCost(usd: number) {
  if (usd < 0.01)  return `$${(usd * 1000).toFixed(2)}m`;
  if (usd < 1)     return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function statusColor(status: string) {
  switch (status) {
    case 'online':    case 'idle':  case 'completed': case 'done':  return '#10B981';
    case 'working':   case 'running':                               return '#F59E0B';
    case 'error':     case 'failed':                                return '#EF4444';
    case 'queued':    case 'pending':                               return '#64748B';
    case 'offline':                                                  return '#475569';
    default:                                                         return '#64748B';
  }
}

export function agentColor(agentKey: string) {
  const colors: Record<string, string> = {
    sentinel:    '#4A90E2',
    scout:       '#27AE60',
    forge:       '#E67E22',
    scribe:      '#1ABC9C',
    courier:     '#E91E63',
    switchboard: '#9B59B6',
    warden:      '#E74C3C',
    archivist:   '#A0522D',
    lens:        '#00BCD4',
    helm:        '#7F8C8D',
    codex:       '#3B82F6',
    operator:    '#8B5CF6',
    keeper:      '#06B6D4',
  };
  return colors[agentKey.toLowerCase()] ?? '#64748B';
}

export function agentEmoji(agentKey: string) {
  const emojis: Record<string, string> = {
    sentinel:    '🤖',
    scout:       '🔍',
    forge:       '⚒️',
    scribe:      '📝',
    courier:     '✉️',
    switchboard: '🔀',
    warden:      '🛡️',
    archivist:   '📚',
    lens:        '📊',
    helm:        '⚙️',
    codex:       '🧠',
    operator:    '🎯',
    keeper:      '💬',
  };
  return emojis[agentKey.toLowerCase()] ?? '🤖';
}

export function truncate(str: string, n: number) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
