'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardList, Plus, X, Circle, Loader2, CheckCircle2, Zap } from 'lucide-react';
import { agentColor, agentEmoji, formatRelative } from '@/lib/utils';

type TaskStatus = 'todo' | 'in_progress' | 'done';
type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

interface Task {
  id:          number;
  title:       string;
  description?: string;
  status:      TaskStatus;
  priority:    TaskPriority;
  agent_id?:   string;
  created_at:  string;
  updated_at:  string;
}

const PRIORITY_CONFIG: Record<TaskPriority, { color: string; label: string }> = {
  low:      { color: '#64748B', label: 'Low'      },
  medium:   { color: '#F59E0B', label: 'Medium'   },
  high:     { color: '#EF4444', label: 'High'     },
  critical: { color: '#FF0055', label: 'Critical' },
};

const STATUS_CONFIG: Record<TaskStatus, { color: string; label: string; icon: any }> = {
  todo:        { color: '#64748B', label: 'To Do',       icon: Circle      },
  in_progress: { color: '#F59E0B', label: 'In Progress', icon: Loader2     },
  done:        { color: '#10B981', label: 'Done',        icon: CheckCircle2 },
};

const AGENTS = ['sentinel','scout','forge','scribe','courier','switchboard','warden','archivist','lens','helm','keeper'];

const COLS: { key: TaskStatus; label: string }[] = [
  { key: 'todo',        label: 'To Do'       },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done',        label: 'Done'        },
];

function TaskCard({ task, onMove, onDelete }: {
  task: Task;
  onMove: (id: number, status: TaskStatus) => void;
  onDelete: (id: number) => void;
}) {
  const pCfg  = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
  const sCfg  = STATUS_CONFIG[task.status];
  const color = task.agent_id ? agentColor(task.agent_id) : '#64748B';
  const nextStatuses = COLS.map(c => c.key).filter(s => s !== task.status) as TaskStatus[];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="glass rounded-xl overflow-hidden cursor-default"
      style={{ border: `1px solid ${color}20` }}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-xs font-medium text-white leading-snug flex-1">{task.title}</p>
          <button onClick={() => onDelete(task.id)} className="text-ghost-muted/30 hover:text-red-400 transition-colors shrink-0 mt-0.5">
            <X size={11} />
          </button>
        </div>

        {task.description && (
          <p className="text-[10px] text-ghost-muted/60 mb-2 leading-relaxed">{task.description}</p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider font-bold"
                style={{ color: pCfg.color, background: `${pCfg.color}15`, border: `1px solid ${pCfg.color}25` }}>
            {pCfg.label}
          </span>
          {task.agent_id && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono flex items-center gap-1"
                  style={{ color, background: `${color}12`, border: `1px solid ${color}20` }}>
              {agentEmoji(task.agent_id)} {task.agent_id}
            </span>
          )}
          <span className="ml-auto text-[9px] text-ghost-muted/40 font-mono">{formatRelative(task.updated_at)}</span>
        </div>
      </div>

      <div className="flex border-t border-white/5">
        {nextStatuses.map(s => (
          <button
            key={s}
            onClick={() => onMove(task.id, s)}
            className="flex-1 py-1.5 text-[9px] text-ghost-muted hover:text-white hover:bg-white/5 transition-all font-mono uppercase tracking-wider"
          >
            {'\u2192'} {STATUS_CONFIG[s].label}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showNew, setShowNew]       = useState(false);
  const [newTitle, setNewTitle]     = useState('');
  const [newAgent, setNewAgent]     = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  async function moveTask(id: number, status: TaskStatus) {
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status, updated_at: new Date().toISOString() } : t));
    await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  }

  async function deleteTask(id: number) {
    setTasks(prev => prev.filter(t => t.id !== id));
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  }

  async function addTask() {
    if (!newTitle.trim()) return;
    const body = { title: newTitle.trim(), priority: newPriority, agent_id: newAgent || null };
    const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.task) setTasks(prev => [data.task, ...prev]);
    setNewTitle('');
    setNewAgent('');
    setNewPriority('medium');
    setShowNew(false);
  }

  const counts = COLS.reduce((acc, c) => {
    acc[c.key] = tasks.filter(t => t.status === c.key).length;
    return acc;
  }, {} as Record<TaskStatus, number>);

  return (
    <div className="p-3 sm:p-6 pb-24 md:pb-6 max-w-screen-xl mx-auto">
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList size={16} className="text-ghost-accent" />
            <h2 className="text-lg sm:text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Task Board</h2>
          </div>
          <p className="text-[10px] sm:text-xs text-ghost-muted">Agent work items and objectives</p>
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-ghost-accent bg-ghost-accent/10 hover:bg-ghost-accent/20"
          style={{ border: '1px solid rgba(0,212,255,0.2)' }}
        >
          <Plus size={13} />
          New Task
        </button>
      </div>

      <AnimatePresence>
        {showNew && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-5"
          >
            <div className="glass rounded-2xl p-3 sm:p-5" style={{ border: '1px solid rgba(0,212,255,0.15)' }}>
              <p className="text-xs font-semibold text-white mb-3 sm:mb-4" style={{ fontFamily: 'Space Grotesk' }}>Add New Task</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-3 sm:mb-4">
                <input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTask()}
                  placeholder="Task description..."
                  className="sm:col-span-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-ghost-muted/40 outline-none focus:border-ghost-accent/40 transition-colors"
                />
                <select value={newAgent} onChange={e => setNewAgent(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-ghost-accent/40 transition-colors">
                  <option value="">No agent</option>
                  {AGENTS.map(a => <option key={a} value={a}>{agentEmoji(a)} {a}</option>)}
                </select>
                <select value={newPriority} onChange={e => setNewPriority(e.target.value as TaskPriority)}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-ghost-accent/40 transition-colors">
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <div className="flex gap-2">
                  <button onClick={addTask} disabled={!newTitle.trim()}
                          className="flex-1 py-2 rounded-lg text-xs font-medium bg-ghost-accent/20 text-ghost-accent hover:bg-ghost-accent/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    Add Task
                  </button>
                  <button onClick={() => setShowNew(false)}
                          className="px-3 py-2 rounded-lg text-xs text-ghost-muted hover:text-white hover:bg-white/5 transition-all">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        {COLS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.key);
          const sCfg = STATUS_CONFIG[col.key];
          const CIcon = sCfg.icon;
          return (
            <div key={col.key}>
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl"
                   style={{ background: `${sCfg.color}08`, border: `1px solid ${sCfg.color}15` }}>
                <CIcon size={13} style={{ color: sCfg.color }} className={col.key === 'in_progress' ? 'animate-spin' : ''} />
                <span className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>{col.label}</span>
                <span className="ml-auto text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full"
                      style={{ color: sCfg.color, background: `${sCfg.color}18`, border: `1px solid ${sCfg.color}25` }}>
                  {counts[col.key] || 0}
                </span>
              </div>

              <div className="space-y-2 min-h-24">
                <AnimatePresence>
                  {colTasks.length === 0 ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="glass rounded-xl p-6 text-center"
                      style={{ border: '1px solid rgba(255,255,255,0.04)', borderStyle: 'dashed' }}>
                      <p className="text-[10px] text-ghost-muted/30">{loading ? 'Loading...' : 'No tasks'}</p>
                    </motion.div>
                  ) : colTasks.map(task => (
                    <TaskCard key={task.id} task={task} onMove={moveTask} onDelete={deleteTask} />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 sm:mt-8 flex items-center gap-3 sm:gap-6 text-[9px] sm:text-[10px] text-ghost-muted/40 font-mono flex-wrap">
        <span>{tasks.length} total</span>
        <span>{counts.in_progress || 0} in progress</span>
        <span>{counts.done || 0} done</span>
        <span className="ml-auto flex items-center gap-1.5">
          <Zap size={10} className="text-ghost-accent/40" />
          <span className="hidden sm:inline">Persisted to database</span>
          <span className="sm:hidden">Saved</span>
        </span>
      </div>
    </div>
  );
}
