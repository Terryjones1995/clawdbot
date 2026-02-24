'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardList, Plus, X, ChevronDown, Circle, Loader2, CheckCircle2, Zap } from 'lucide-react';
import { agentColor, agentEmoji, formatRelative } from '@/lib/utils';

type TaskStatus = 'todo' | 'in_progress' | 'done';
type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

interface Task {
  id:        string;
  title:     string;
  desc?:     string;
  status:    TaskStatus;
  priority:  TaskPriority;
  agentId?:  string;
  createdAt: string;
  updatedAt: string;
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
  done:        { color: '#10B981', label: 'Done',         icon: CheckCircle2 },
};

const INITIAL_TASKS: Task[] = [
  { id: 't1', title: 'Set up Pinecone namespace for HOF data',       status: 'done',        priority: 'high',     agentId: 'archivist', createdAt: new Date(Date.now()-86400000*3).toISOString(), updatedAt: new Date(Date.now()-86400000*2).toISOString() },
  { id: 't2', title: 'Implement weekly performance recap',           status: 'in_progress', priority: 'medium',   agentId: 'scribe',    createdAt: new Date(Date.now()-86400000*2).toISOString(), updatedAt: new Date(Date.now()-3600000).toISOString(),    desc: 'Scribe should send Sunday 8pm summary to #updates' },
  { id: 't3', title: 'Tune Scout Grok latency — add caching layer',  status: 'in_progress', priority: 'high',     agentId: 'scout',     createdAt: new Date(Date.now()-86400000).toISOString(),   updatedAt: new Date(Date.now()-1800000).toISOString()  },
  { id: 't4', title: 'Add !approve and !reject slash commands',      status: 'todo',        priority: 'medium',   agentId: 'warden',    createdAt: new Date(Date.now()-43200000).toISOString(),   updatedAt: new Date(Date.now()-43200000).toISOString() },
  { id: 't5', title: 'Courier email template for league updates',    status: 'todo',        priority: 'low',      agentId: 'courier',   createdAt: new Date(Date.now()-21600000).toISOString(),   updatedAt: new Date(Date.now()-21600000).toISOString() },
  { id: 't6', title: 'Integrate PostHog event tracking in portal',   status: 'todo',        priority: 'medium',   agentId: 'lens',      createdAt: new Date(Date.now()-7200000).toISOString(),    updatedAt: new Date(Date.now()-7200000).toISOString(),   desc: 'Track page views, agent interactions, terminal commands' },
  { id: 't7', title: 'Test Forge code review on feature branch',     status: 'todo',        priority: 'low',      agentId: 'forge',     createdAt: new Date(Date.now()-3600000).toISOString(),    updatedAt: new Date(Date.now()-3600000).toISOString() },
  { id: 't8', title: 'Deploy portal to production (port 3001)',      status: 'todo',        priority: 'critical', agentId: 'helm',      createdAt: new Date(Date.now()-1800000).toISOString(),    updatedAt: new Date(Date.now()-1800000).toISOString(),   desc: 'Add ghost-portal to PM2 ecosystem, configure nginx reverse proxy' },
];

const AGENTS = ['sentinel','scout','forge','scribe','courier','switchboard','warden','archivist','lens','helm','codex','operator'];

const COLS: { key: TaskStatus; label: string }[] = [
  { key: 'todo',        label: 'To Do'       },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done',        label: 'Done'        },
];

function TaskCard({ task, onMove, onDelete }: {
  task: Task;
  onMove: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pCfg  = PRIORITY_CONFIG[task.priority];
  const sCfg  = STATUS_CONFIG[task.status];
  const Icon  = sCfg.icon;
  const color = task.agentId ? agentColor(task.agentId) : '#64748B';

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

        {task.desc && (
          <p className="text-[10px] text-ghost-muted/60 mb-2 leading-relaxed">{task.desc}</p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Priority badge */}
          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider font-bold"
                style={{ color: pCfg.color, background: `${pCfg.color}15`, border: `1px solid ${pCfg.color}25` }}>
            {pCfg.label}
          </span>

          {/* Agent badge */}
          {task.agentId && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono flex items-center gap-1"
                  style={{ color, background: `${color}12`, border: `1px solid ${color}20` }}>
              {agentEmoji(task.agentId)} {task.agentId}
            </span>
          )}

          <span className="ml-auto text-[9px] text-ghost-muted/40 font-mono">{formatRelative(task.updatedAt)}</span>
        </div>
      </div>

      {/* Move actions */}
      <div className="flex border-t border-white/5">
        {nextStatuses.map(s => (
          <button
            key={s}
            onClick={() => onMove(task.id, s)}
            className="flex-1 py-1.5 text-[9px] text-ghost-muted hover:text-white hover:bg-white/5 transition-all font-mono uppercase tracking-wider"
          >
            → {STATUS_CONFIG[s].label}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [showNew, setShowNew] = useState(false);
  const [newTitle,    setNewTitle]    = useState('');
  const [newAgent,    setNewAgent]    = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');

  function moveTask(id: string, status: TaskStatus) {
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, status, updatedAt: new Date().toISOString() } : t
    ));
  }

  function deleteTask(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  function addTask() {
    if (!newTitle.trim()) return;
    const task: Task = {
      id:        Math.random().toString(36).slice(2),
      title:     newTitle.trim(),
      status:    'todo',
      priority:  newPriority,
      agentId:   newAgent || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setTasks(prev => [task, ...prev]);
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
    <div className="p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList size={16} className="text-ghost-accent" />
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Task Board</h2>
          </div>
          <p className="text-xs text-ghost-muted">Agent work items and mission objectives</p>
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

      {/* New task form */}
      <AnimatePresence>
        {showNew && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-5"
          >
            <div className="glass rounded-2xl p-5" style={{ border: '1px solid rgba(0,212,255,0.15)' }}>
              <p className="text-xs font-semibold text-white mb-4" style={{ fontFamily: 'Space Grotesk' }}>Add New Task</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTask()}
                  placeholder="Task description..."
                  className="sm:col-span-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-ghost-muted/40 outline-none focus:border-ghost-accent/40 transition-colors"
                />
                <select
                  value={newAgent}
                  onChange={e => setNewAgent(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-ghost-accent/40 transition-colors"
                >
                  <option value="">No agent</option>
                  {AGENTS.map(a => (
                    <option key={a} value={a}>{agentEmoji(a)} {a}</option>
                  ))}
                </select>
                <select
                  value={newPriority}
                  onChange={e => setNewPriority(e.target.value as TaskPriority)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-ghost-accent/40 transition-colors"
                >
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={addTask}
                    disabled={!newTitle.trim()}
                    className="flex-1 py-2 rounded-lg text-xs font-medium bg-ghost-accent/20 text-ghost-accent hover:bg-ghost-accent/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Add Task
                  </button>
                  <button
                    onClick={() => setShowNew(false)}
                    className="px-3 py-2 rounded-lg text-xs text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Kanban columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.key);
          const sCfg = STATUS_CONFIG[col.key];
          const CIcon = sCfg.icon;
          return (
            <div key={col.key}>
              {/* Column header */}
              <div className="flex items-center gap-2 mb-3 px-1">
                <CIcon size={13} style={{ color: sCfg.color }} className={col.key === 'in_progress' ? 'animate-spin' : ''} />
                <span className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>{col.label}</span>
                <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                      style={{ color: sCfg.color, background: `${sCfg.color}15` }}>
                  {counts[col.key]}
                </span>
              </div>

              {/* Cards */}
              <div className="space-y-2 min-h-24">
                <AnimatePresence>
                  {colTasks.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="glass rounded-xl p-6 text-center"
                      style={{ border: '1px solid rgba(255,255,255,0.04)', borderStyle: 'dashed' }}
                    >
                      <p className="text-[10px] text-ghost-muted/30">No tasks</p>
                    </motion.div>
                  ) : (
                    colTasks.map(task => (
                      <TaskCard key={task.id} task={task} onMove={moveTask} onDelete={deleteTask} />
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer stats */}
      <div className="mt-8 flex items-center gap-6 text-[10px] text-ghost-muted/40 font-mono">
        <span>{tasks.length} total tasks</span>
        <span>{counts.in_progress} in progress</span>
        <span>{counts.done} completed</span>
        <span className="ml-auto flex items-center gap-1.5">
          <Zap size={10} className="text-ghost-accent/40" />
          Board syncs with agent task queue
        </span>
      </div>
    </div>
  );
}
