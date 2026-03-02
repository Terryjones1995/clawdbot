'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Plus, X, Upload, Search, RefreshCw, ChevronDown, ChevronUp, Pencil, Trash2, Save, BookOpen } from 'lucide-react';
import { formatRelative } from '@/lib/utils';

interface KnowledgeEntry {
  id:         number;
  key:        string;
  content:    string;
  category:   string;
  source:     string;
  created_at: string;
  updated_at: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  org:          '#7C3AED',
  general:      '#64748B',
  league:       '#3B82F6',
  training:     '#10B981',
  conversation: '#F59E0B',
  misc:         '#6B7280',
  research:     '#60A5FA',
  correction:   '#EF4444',
};

const SOURCE_ICONS: Record<string, string> = {
  training:              'Manual',
  'seed-hof-knowledge':  'Seed',
  conversation:          'Chat',
  research:              'Scout',
  reflection:            'Nightly',
};

export default function TrainingPage() {
  const [entries, setEntries]             = useState<KnowledgeEntry[]>([]);
  const [categories, setCategories]       = useState<string[]>([]);
  const [sources, setSources]             = useState<string[]>([]);
  const [loading, setLoading]             = useState(true);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSource, setFilterSource]     = useState('');
  const [searchText, setSearchText]         = useState('');
  const [showAll, setShowAll]               = useState(false);
  const [showAdd, setShowAdd]               = useState(false);
  const [showBulk, setShowBulk]             = useState(false);
  const [expandedId, setExpandedId]         = useState<number | null>(null);
  const [editingId, setEditingId]           = useState<number | null>(null);
  const [editContent, setEditContent]       = useState('');
  const [editCategory, setEditCategory]     = useState('');

  // New entry form
  const [newContent, setNewContent]   = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [newKey, setNewKey]           = useState('');

  // Bulk upload
  const [bulkText, setBulkText]       = useState('');
  const [bulkCategory, setBulkCategory] = useState('general');
  const [bulkStatus, setBulkStatus]     = useState('');

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCategory) params.set('category', filterCategory);
      if (filterSource)   params.set('source', filterSource);
      if (!showAll && !filterSource) params.set('curated', 'true');
      const res = await fetch(`/api/training?${params.toString()}`);
      const data = await res.json();
      setEntries(data.entries || []);
      setCategories(data.categories || []);
      setSources(data.sources || []);
    } catch { /* offline */ }
    setLoading(false);
  }, [filterCategory, filterSource, showAll]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Filter locally by search text
  const filtered = searchText
    ? entries.filter(e =>
        e.content.toLowerCase().includes(searchText.toLowerCase()) ||
        e.key.toLowerCase().includes(searchText.toLowerCase()) ||
        e.category.toLowerCase().includes(searchText.toLowerCase()))
    : entries;

  async function addEntry() {
    if (!newContent.trim()) return;
    try {
      const res = await fetch('/api/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key:      newKey.trim() || undefined,
          content:  newContent.trim(),
          category: newCategory,
        }),
      });
      const data = await res.json();
      if (data.entry) setEntries(prev => [data.entry, ...prev]);
      setNewContent('');
      setNewKey('');
      setShowAdd(false);
    } catch { /* error */ }
  }

  async function bulkUpload() {
    if (!bulkText.trim()) return;

    // Split by double newlines or --- separators
    const chunks = bulkText.split(/\n{2,}|---+/).map(c => c.trim()).filter(Boolean);
    if (!chunks.length) return;

    setBulkStatus(`Uploading ${chunks.length} entries...`);
    try {
      const res = await fetch('/api/training/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: chunks.map(content => ({ content, category: bulkCategory })),
        }),
      });
      const data = await res.json();
      setBulkStatus(`Stored ${data.stored}/${data.total} entries`);
      setBulkText('');
      setTimeout(() => { setBulkStatus(''); setShowBulk(false); fetchEntries(); }, 2000);
    } catch (e: any) {
      setBulkStatus(`Error: ${e.message}`);
    }
  }

  async function updateEntry(id: number) {
    try {
      const body: Record<string, string> = {};
      if (editContent) body.content  = editContent;
      if (editCategory) body.category = editCategory;

      const res = await fetch(`/api/training/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.entry) {
        setEntries(prev => prev.map(e => e.id === id ? data.entry : e));
      }
      setEditingId(null);
    } catch { /* error */ }
  }

  async function deleteEntry(id: number) {
    setEntries(prev => prev.filter(e => e.id !== id));
    await fetch(`/api/training/${id}`, { method: 'DELETE' });
  }

  function startEdit(entry: KnowledgeEntry) {
    setEditingId(entry.id);
    setEditContent(entry.content);
    setEditCategory(entry.category);
    setExpandedId(entry.id);
  }

  const categoryCount = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1;
    return acc;
  }, {});

  const sourceCount = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.source] = (acc[e.source] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-3 sm:p-6 pb-24 md:pb-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Brain size={16} className="text-ghost-accent" />
            <h2 className="text-lg sm:text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Agent Training</h2>
          </div>
          <p className="text-[10px] sm:text-xs text-ghost-muted">Teach your agents with custom knowledge — stored with semantic search</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchEntries}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
            style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => { setShowBulk(!showBulk); setShowAdd(false); }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-purple-400 bg-purple-500/10 hover:bg-purple-500/20"
            style={{ border: '1px solid rgba(124,58,237,0.2)' }}>
            <Upload size={13} />
            Bulk
          </button>
          <button onClick={() => { setShowAdd(!showAdd); setShowBulk(false); }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-ghost-accent bg-ghost-accent/10 hover:bg-ghost-accent/20"
            style={{ border: '1px solid rgba(0,212,255,0.2)' }}>
            <Plus size={13} />
            Add Knowledge
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-6">
        {[
          { label: 'Total Knowledge', value: entries.length, color: '#00D4FF' },
          { label: 'Categories',      value: Object.keys(categoryCount).length, color: '#7C3AED' },
          { label: 'From Training',   value: entries.filter(e => e.source === 'training').length, color: '#10B981' },
          { label: 'From Agents',     value: entries.filter(e => e.source !== 'training' && e.source !== 'seed-hof-knowledge').length, color: '#F59E0B' },
        ].map(kpi => (
          <div key={kpi.label} className="glass rounded-xl p-4" style={{ border: `1px solid ${kpi.color}20` }}>
            <p className="text-xl font-bold text-white mb-1" style={{ fontFamily: 'Space Grotesk' }}>{kpi.value}</p>
            <p className="text-[10px] text-ghost-muted">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Add single entry form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-4">
            <div className="glass rounded-2xl p-3 sm:p-5" style={{ border: '1px solid rgba(0,212,255,0.15)' }}>
              <div className="flex items-center gap-2 mb-3">
                <BookOpen size={14} className="text-ghost-accent" />
                <p className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>Add Knowledge</p>
              </div>
              <div className="space-y-3">
                <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="What should the agents know? Be specific and factual."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-ghost-muted/40 outline-none focus:border-ghost-accent/40 transition-colors resize-none h-24" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Key (auto-generated if empty)"
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-ghost-muted/40 outline-none focus:border-ghost-accent/40 transition-colors" />
                  <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none">
                    <option value="general">general</option>
                    <option value="org">org</option>
                    <option value="league">league</option>
                    <option value="training">training</option>
                    <option value="misc">misc</option>
                  </select>
                  <div className="flex gap-2">
                    <button onClick={addEntry} disabled={!newContent.trim()}
                      className="flex-1 py-2 rounded-lg text-xs font-medium bg-ghost-accent/20 text-ghost-accent hover:bg-ghost-accent/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                      Save
                    </button>
                    <button onClick={() => setShowAdd(false)}
                      className="px-3 py-2 rounded-lg text-xs text-ghost-muted hover:text-white hover:bg-white/5 transition-all">
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk upload form */}
      <AnimatePresence>
        {showBulk && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-4">
            <div className="glass rounded-2xl p-3 sm:p-5" style={{ border: '1px solid rgba(124,58,237,0.15)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Upload size={14} className="text-purple-400" />
                <p className="text-xs font-semibold text-white" style={{ fontFamily: 'Space Grotesk' }}>Bulk Upload</p>
              </div>
              <p className="text-[10px] text-ghost-muted mb-3">Paste multiple facts separated by blank lines or --- dividers. Each becomes a separate knowledge entry with its own embedding.</p>
              <textarea value={bulkText} onChange={e => setBulkText(e.target.value)}
                placeholder={"HOF League has 88 teams and 636 registered players.\n\n---\n\nRegistration for Season 32 costs $75 per team.\n\n---\n\nThe ranking system has 19 tiers from Rookie to Legend."}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-ghost-muted/30 outline-none focus:border-purple-500/40 transition-colors resize-none h-40 font-mono" />
              <div className="flex items-center gap-2 mt-3">
                <select value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none">
                  <option value="general">general</option>
                  <option value="org">org</option>
                  <option value="league">league</option>
                  <option value="training">training</option>
                </select>
                <button onClick={bulkUpload} disabled={!bulkText.trim()}
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-all disabled:opacity-40">
                  Upload All
                </button>
                <button onClick={() => setShowBulk(false)}
                  className="px-3 py-2 rounded-lg text-xs text-ghost-muted hover:text-white hover:bg-white/5 transition-all">
                  Cancel
                </button>
                {bulkStatus && <span className="text-[10px] text-ghost-accent ml-2">{bulkStatus}</span>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters + Search */}
      <div className="flex gap-1.5 sm:gap-2 mb-3 sm:mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[120px] max-w-xs">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost-muted/40" />
          <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Search knowledge..."
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-[10px] text-white placeholder-ghost-muted/40 outline-none focus:border-ghost-accent/40 transition-colors" />
        </div>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] text-white outline-none">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c} ({categoryCount[c] || 0})</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] text-white outline-none">
          <option value="">All Sources</option>
          {sources.map(s => <option key={s} value={s}>{SOURCE_ICONS[s] || s} ({sourceCount[s] || 0})</option>)}
        </select>
        <button onClick={() => setShowAll(!showAll)}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all ${showAll ? 'text-amber-400 bg-amber-500/10' : 'text-ghost-muted bg-white/5 hover:text-white'}`}
          style={{ border: showAll ? '1px solid rgba(245,158,11,0.2)' : '1px solid rgba(255,255,255,0.1)' }}>
          {showAll ? 'Showing All (incl. auto-extracted)' : 'Curated Only'}
        </button>
      </div>

      {/* Knowledge entries */}
      <div className="glass rounded-2xl overflow-hidden relative" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.4), transparent)' }} />

        <div className="divide-y divide-white/[0.03]">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[10px] text-ghost-muted/40">
              {loading ? 'Loading knowledge base...' : 'No knowledge entries yet. Add some to train your agents.'}
            </div>
          ) : filtered.map(entry => (
            <div key={entry.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-start gap-3">
                {/* Category badge */}
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 mt-0.5"
                      style={{ color: CATEGORY_COLORS[entry.category] || '#64748B', background: `${CATEGORY_COLORS[entry.category] || '#64748B'}15` }}>
                  {entry.category}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {editingId === entry.id ? (
                    <div className="space-y-2">
                      <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-ghost-accent/40 resize-none h-20" />
                      <div className="flex gap-2">
                        <select value={editCategory} onChange={e => setEditCategory(e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white outline-none">
                          {['general', 'org', 'league', 'training', 'misc'].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button onClick={() => updateEntry(entry.id)}
                          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-ghost-accent bg-ghost-accent/10 hover:bg-ghost-accent/20 transition-all">
                          <Save size={10} /> Save
                        </button>
                        <button onClick={() => setEditingId(null)}
                          className="px-2 py-1 rounded text-[10px] text-ghost-muted hover:text-white transition-all">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)} className="text-left w-full">
                      <p className="text-[10px] text-white leading-relaxed">
                        {expandedId === entry.id ? entry.content : entry.content.length > 150 ? entry.content.slice(0, 150) + '...' : entry.content}
                      </p>
                    </button>
                  )}

                  {/* Meta row */}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[9px] text-ghost-muted/40 font-mono">{entry.key.length > 40 ? entry.key.slice(0, 40) + '...' : entry.key}</span>
                    <span className="text-[9px] text-ghost-muted/30">|</span>
                    <span className="text-[9px] text-ghost-muted/40">{SOURCE_ICONS[entry.source] || entry.source}</span>
                    <span className="text-[9px] text-ghost-muted/30">|</span>
                    <span className="text-[9px] text-ghost-muted/40">{formatRelative(entry.updated_at)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {expandedId === entry.id && (
                    <>
                      <button onClick={() => startEdit(entry)}
                        className="w-6 h-6 flex items-center justify-center rounded text-ghost-muted/40 hover:text-ghost-accent transition-colors">
                        <Pencil size={11} />
                      </button>
                      <button onClick={() => deleteEntry(entry.id)}
                        className="w-6 h-6 flex items-center justify-center rounded text-ghost-muted/40 hover:text-red-400 transition-colors">
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                  <button onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    className="w-6 h-6 flex items-center justify-center rounded text-ghost-muted/40 hover:text-white transition-colors">
                    {expandedId === entry.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
