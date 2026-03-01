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
    ghost:       '#00D4FF',
    switchboard: '#7C3AED',
    warden:      '#EF4444',
    scribe:      '#10B981',
    archivist:   '#F59E0B',
    scout:       '#60A5FA',
    forge:       '#FB923C',
    courier:     '#A78BFA',
    lens:        '#34D399',
    keeper:      '#38BDF8',
    sentinel:    '#E879F9',
    crow:        '#94A3B8',
    operator:    '#FCD34D',
    helm:        '#6EE7B7',
    codex:       '#FCA5A5',
  };
  return colors[agentKey.toLowerCase()] ?? '#64748B';
}

export function agentEmoji(agentKey: string) {
  const emojis: Record<string, string> = {
    ghost:       '👑',
    switchboard: '🔀',
    warden:      '🛡️',
    scribe:      '📜',
    archivist:   '📦',
    scout:       '🔍',
    forge:       '🔨',
    courier:     '✉️',
    lens:        '👁️',
    keeper:      '🧠',
    sentinel:    '📡',
    crow:        '🐦',
    operator:    '⚙️',
    helm:        '🧭',
    codex:       '📖',
  };
  return emojis[agentKey.toLowerCase()] ?? '🤖';
}

export function truncate(str: string, n: number) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
