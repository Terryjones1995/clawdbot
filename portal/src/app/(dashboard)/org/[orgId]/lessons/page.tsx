'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, Plus, X, Power, PowerOff, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { agentColor, agentEmoji, formatRelative } from '@/lib/utils';

interface Lesson {
  id:            number;
  agent:         string;
  lesson:        string;
  category:      string;
  severity:      string;
  source:        string;
  context:       string | null;
  active:        boolean;
  applied_count: number;
  created_at:    string;
  updated_at:    string;
}

const SEVERITY_COLOR: Record<string, string> = {
  low:      '#64748B',
  medium:   '#F59E0B',
  high:     '#EF4444',
  critical: '#FF0055',
};

const CATEGORY_COLOR: Record<string, string> = {
  correction:     '#7C3AED',
  'error-pattern': '#EF4444',
  feedback:       '#F59E0B',
  general:        '#64748B',
};

const AGENTS = ['ghost','sentinel','scout','forge','scribe','courier','switchboard','warden','archivist','lens','helm','keeper'];

export default function LessonsPage() {
  const [lessons, setLessons]         = useState<Lesson[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filterAgent, setFilterAgent] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterActive, setFilterActive] = useState<string>('');
  const [showNew, setShowNew]         = useState(false);
  const [expandedId, setExpandedId]   = useState<number | null>(null);

  // New lesson form
  const [newAgent, setNewAgent]       = useState('ghost');
  const [newLesson, setNewLesson]     = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [newSeverity, setNewSeverity] = useState('medium');

  const fetchLessons = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterAgent)    params.set('agent', filterAgent);
      if (filterCategory) params.set('category', filterCategory);
      if (filterActive)   params.set('active', filterActive);
      const res = await fetch(`/api/lessons?${params.toString()}`);
      const data = await res.json();
      setLessons(data.lessons || []);
    } catch { /* offline */ }
    setLoading(false);
  }, [filterAgent, filterCategory, filterActive]);

  useEffect(() => { fetchLessons(); }, [fetchLessons]);

  async function toggleActive(id: number, active: boolean) {
    setLessons(prev => prev.map(l => l.id === id ? { ...l, active: !active } : l));
    await fetch(`/api/lessons/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    });
  }

  async function deleteLesson(id: number) {
    setLessons(prev => prev.filter(l => l.id !== id));
    await fetch(`/api/lessons/${id}`, { method: 'DELETE' });
  }

  async function addLesson() {
    if (!newLesson.trim()) return;
    const res = await fetch('/api/lessons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent:    newAgent,
        lesson:   newLesson.trim(),
        category: newCategory,
        severity: newSeverity,
        source:   'manual',
      }),
    });
    const data = await res.json();
    if (data.lesson) setLessons(prev => [data.lesson, ...prev]);
    setNewLesson('');
    setShowNew(false);
  }

  const activeCount   = lessons.filter(l => l.active).length;
  const totalApplied  = lessons.reduce((s, l) => s + l.applied_count, 0);

  return (
    <div className="p-3 sm:p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <GraduationCap size={16} className="text-ghost-accent" />
            <h2 className="text-lg sm:text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Agent Lessons</h2>
          </div>
          <p className="text-[10px] sm:text-xs text-ghost-muted">Knowledge from corrections and feedback</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchLessons}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
            style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowNew(!showNew)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-ghost-accent bg-ghost-accent/10 hover:bg-ghost-accent/20"
            style={{ border: '1px solid rgba(0,212,255,0.2)' }}>
            <Plus size={13} />
            Add Lesson
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-6">
        {[
          { label: 'Total Lessons', value: lessons.length, color: '#00D4FF' },
          { label: 'Active',        value: activeCount,    color: '#10B981' },
          { label: 'Times Applied', value: totalApplied,   color: '#F59E0B' },
        ].map(kpi => (
          <div key={kpi.label} className="glass rounded-xl p-4" style={{ border: `1px solid ${kpi.color}20` }}>
            <p className="text-xl font-bold text-white mb-1" style={{ fontFamily: 'Space Grotesk' }}>{kpi.value}</p>
            <p className="text-[10px] text-ghost-muted">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* New lesson form */}
      <AnimatePresence>
        {showNew && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-4 sm:mb-5">
            <div className="glass rounded-2xl p-3 sm:p-5" style={{ border: '1px solid rgba(0,212,255,0.15)' }}>
              <p className="text-xs font-semibold text-white mb-3 sm:mb-4" style={{ fontFamily: 'Space Grotesk' }}>Add Manual Lesson</p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-3 mb-3 sm:mb-4">
                <textarea value={newLesson} onChange={e => setNewLesson(e.target.value)} placeholder="What should the agent learn?"
                  className="sm:col-span-4 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-ghost-muted/40 outline-none focus:border-ghost-accent/40 transition-colors resize-none h-16" />
                <select value={newAgent} onChange={e => setNewAgent(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none">
                  {AGENTS.map(a => <option key={a} value={a}>{agentEmoji(a)} {a}</option>)}
                </select>
                <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none">
                  {['general','correction','error-pattern','feedback'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={newSeverity} onChange={e => setNewSeverity(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none">
                  {['low','medium','high','critical'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="flex gap-2">
                  <button onClick={addLesson} disabled={!newLesson.trim()}
                    className="flex-1 py-2 rounded-lg text-xs font-medium bg-ghost-accent/20 text-ghost-accent hover:bg-ghost-accent/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    Save
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

      {/* Filters */}
      <div className="flex gap-1.5 sm:gap-2 mb-3 sm:mb-4 flex-wrap">
        <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] text-white outline-none">
          <option value="">All Agents</option>
          {AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] text-white outline-none">
          <option value="">All Categories</option>
          {['general','correction','error-pattern','feedback'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] text-white outline-none">
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {/* Lessons table */}
      <div className="glass rounded-2xl overflow-hidden relative" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, transparent, rgba(124,58,237,0.4), transparent)' }} />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5">
                {['Agent', 'Lesson', 'Category', 'Severity', 'Source', 'Applied', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[9px] uppercase tracking-wider text-ghost-muted/50 font-mono">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lessons.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[10px] text-ghost-muted/40">
                    {loading ? 'Loading...' : 'No lessons yet. Send a message or add one manually.'}
                  </td>
                </tr>
              ) : lessons.map(l => (
                <tr key={l.id} className={`border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors ${!l.active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5">
                    <span className="text-[10px] font-mono flex items-center gap-1" style={{ color: agentColor(l.agent) }}>
                      {agentEmoji(l.agent)} {l.agent}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 max-w-sm">
                    <button onClick={() => setExpandedId(expandedId === l.id ? null : l.id)} className="text-left">
                      <p className="text-[10px] text-white leading-relaxed">
                        {expandedId === l.id ? l.lesson : l.lesson.length > 100 ? l.lesson.slice(0, 100) + '...' : l.lesson}
                      </p>
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                          style={{ color: CATEGORY_COLOR[l.category] ?? '#64748B', background: `${CATEGORY_COLOR[l.category] ?? '#64748B'}15` }}>
                      {l.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase"
                          style={{ color: SEVERITY_COLOR[l.severity] ?? '#64748B', background: `${SEVERITY_COLOR[l.severity] ?? '#64748B'}15` }}>
                      {l.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[10px] text-ghost-muted/60 font-mono">{l.source}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full" style={{ color: '#F59E0B', background: 'rgba(245,158,11,0.1)' }}>
                      {l.applied_count}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => toggleActive(l.id, l.active)} title={l.active ? 'Deactivate' : 'Activate'}>
                      {l.active
                        ? <Power size={13} className="text-green-400 hover:text-green-300 transition-colors" />
                        : <PowerOff size={13} className="text-ghost-muted/40 hover:text-white transition-colors" />
                      }
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => deleteLesson(l.id)} className="text-ghost-muted/30 hover:text-red-400 transition-colors">
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
