'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings, Bell, Shield, Cpu, Palette, Database, Bot, Save, RotateCcw, ChevronRight, Eye, EyeOff, CheckCircle2 } from 'lucide-react';

type Section = 'general' | 'agents' | 'models' | 'notifications' | 'security' | 'appearance' | 'danger';

interface ToggleProps {
  value:    boolean;
  onChange: (v: boolean) => void;
  color?:   string;
}

function Toggle({ value, onChange, color = '#00D4FF' }: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="relative w-9 h-5 rounded-full transition-all duration-200 shrink-0"
      style={{ background: value ? `${color}40` : 'rgba(255,255,255,0.08)', border: `1px solid ${value ? color : 'rgba(255,255,255,0.1)'}` }}
    >
      <motion.div
        animate={{ x: value ? 16 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="absolute top-0.5 w-4 h-4 rounded-full"
        style={{ background: value ? color : '#64748B' }}
      />
    </button>
  );
}

function SectionNav({ active, setActive }: { active: Section; setActive: (s: Section) => void }) {
  const items: { key: Section; label: string; icon: any }[] = [
    { key: 'general',      label: 'General',       icon: Settings  },
    { key: 'agents',       label: 'Agents',         icon: Bot       },
    { key: 'models',       label: 'Models',         icon: Cpu       },
    { key: 'notifications',label: 'Notifications',  icon: Bell      },
    { key: 'security',     label: 'Security',       icon: Shield    },
    { key: 'appearance',   label: 'Appearance',     icon: Palette   },
    { key: 'danger',       label: 'Danger Zone',    icon: Database  },
  ];

  return (
    <nav className="space-y-0.5">
      {items.map(item => (
        <button
          key={item.key}
          onClick={() => setActive(item.key)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
            active === item.key
              ? 'text-white bg-white/8'
              : 'text-ghost-muted hover:text-white hover:bg-white/4'
          }`}
        >
          <item.icon size={14} style={{ color: active === item.key && item.key !== 'danger' ? '#00D4FF' : item.key === 'danger' ? '#EF4444' : undefined }} />
          <span className="text-xs font-medium">{item.label}</span>
          {active === item.key && <ChevronRight size={12} className="ml-auto text-ghost-muted/40" />}
        </button>
      ))}
    </nav>
  );
}

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-white/[0.05] last:border-0">
      <div className="flex-1 pr-8">
        <p className="text-xs font-medium text-white mb-0.5">{label}</p>
        {desc && <p className="text-[10px] text-ghost-muted/60">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const [section,      setSection]      = useState<Section>('general');
  const [saved,        setSaved]        = useState(false);

  // General
  const [orgName,      setOrgName]      = useState('Operation Ghost');
  const [timezone,     setTimezone]     = useState('UTC');

  // Agents
  const [idleShutdown, setIdleShutdown] = useState(true);
  const [idleMinutes,  setIdleMinutes]  = useState(120);
  const [autoRestart,  setAutoRestart]  = useState(true);
  const [debugMode,    setDebugMode]    = useState(false);

  // Models
  const [freeFirst,    setFreeFirst]    = useState(true);
  const [ollamaModel,  setOllamaModel]  = useState('qwen3:8b');
  const [ollamaTimeout,setOllamaTimeout]= useState(300);
  const [grokModel,    setGrokModel]    = useState('grok-4-1-fast-reasoning');
  const [claudeModel,  setClaudeModel]  = useState('claude-sonnet-4-6');

  // Notifications
  const [notifyErrors,   setNotifyErrors]   = useState(true);
  const [notifyApprovals,setNotifyApprovals] = useState(true);
  const [notifyDeploy,   setNotifyDeploy]   = useState(false);
  const [discordAlerts,  setDiscordAlerts]  = useState(true);

  // Appearance
  const [accentColor,  setAccentColor]  = useState('#00D4FF');
  const [compactMode,  setCompactMode]  = useState(false);
  const [showTimestamps,setShowTimestamps]= useState(true);

  // Security
  const [showApiKeys,  setShowApiKeys]  = useState(false);
  const [twoFactor,    setTwoFactor]    = useState(false);
  const [sessionTimeout,setSessionTimeout]= useState(60);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const ACCENT_COLORS = ['#00D4FF','#7C3AED','#10B981','#F59E0B','#EF4444','#E91E63','#1DA1F2'];

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Settings size={16} className="text-ghost-accent" />
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>Settings</h2>
          </div>
          <p className="text-xs text-ghost-muted">Configure Ghost system behavior and preferences</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => {}} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                  style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <RotateCcw size={12} />
            Reset
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: saved ? 'rgba(16,185,129,0.2)' : 'rgba(0,212,255,0.15)',
              color:      saved ? '#10B981' : '#00D4FF',
              border:     `1px solid ${saved ? 'rgba(16,185,129,0.3)' : 'rgba(0,212,255,0.3)'}`,
            }}
          >
            {saved ? <CheckCircle2 size={12} /> : <Save size={12} />}
            {saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar nav */}
        <div className="lg:col-span-1">
          <div className="glass rounded-2xl p-3 sticky top-4" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <SectionNav active={section} setActive={setSection} />
          </div>
        </div>

        {/* Settings panel */}
        <div className="lg:col-span-3">
          <div className="glass rounded-2xl p-6" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>

            {/* ── GENERAL ── */}
            {section === 'general' && (
              <div>
                <h3 className="text-sm font-bold text-white mb-5" style={{ fontFamily: 'Space Grotesk' }}>General</h3>
                <SettingRow label="Organization Name" desc="Displayed in the portal header and reports">
                  <input value={orgName} onChange={e => setOrgName(e.target.value)}
                         className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white w-44 outline-none focus:border-ghost-accent/40 transition-colors" />
                </SettingRow>
                <SettingRow label="Timezone" desc="Used for scheduled tasks and timestamps">
                  <select value={timezone} onChange={e => setTimezone(e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-ghost-accent/40 w-44">
                    {['UTC','America/New_York','America/Los_Angeles','Europe/London','Asia/Tokyo'].map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </SettingRow>
                <SettingRow label="Portal Version" desc="Current portal build">
                  <span className="text-[10px] font-mono text-ghost-muted/60">v2.0.0</span>
                </SettingRow>
                <SettingRow label="Ghost System" desc="Backend agent system version">
                  <span className="text-[10px] font-mono text-ghost-accent/80">ghost@2.0 · port 18789</span>
                </SettingRow>
              </div>
            )}

            {/* ── AGENTS ── */}
            {section === 'agents' && (
              <div>
                <h3 className="text-sm font-bold text-white mb-5" style={{ fontFamily: 'Space Grotesk' }}>Agent Configuration</h3>
                <SettingRow label="Idle Shutdown" desc="Stop the system after inactivity">
                  <Toggle value={idleShutdown} onChange={setIdleShutdown} />
                </SettingRow>
                <SettingRow label="Idle Timeout (minutes)" desc="Time before auto-shutdown triggers">
                  <input type="number" value={idleMinutes} onChange={e => setIdleMinutes(+e.target.value)} min={30} max={480}
                         disabled={!idleShutdown}
                         className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white w-24 outline-none focus:border-ghost-accent/40 transition-colors disabled:opacity-30" />
                </SettingRow>
                <SettingRow label="Auto-Restart on Crash" desc="PM2 restarts Ghost automatically">
                  <Toggle value={autoRestart} onChange={setAutoRestart} />
                </SettingRow>
                <SettingRow label="Debug Mode" desc="Verbose logging for all agent activity">
                  <Toggle value={debugMode} onChange={setDebugMode} color="#F59E0B" />
                </SettingRow>
                <SettingRow label="Guild Isolation" desc="Bot only responds in configured Discord guild">
                  <span className="text-[10px] font-mono text-green-400">ENFORCED</span>
                </SettingRow>
              </div>
            )}

            {/* ── MODELS ── */}
            {section === 'models' && (
              <div>
                <h3 className="text-sm font-bold text-white mb-5" style={{ fontFamily: 'Space Grotesk' }}>Model Routing</h3>
                <SettingRow label="Free-First Routing" desc="Always try Ollama before paid APIs (non-negotiable)">
                  <Toggle value={freeFirst} onChange={() => {}} color="#10B981" />
                </SettingRow>
                <SettingRow label="Ollama Model" desc="Default local LLM for all agents">
                  <select value={ollamaModel} onChange={e => setOllamaModel(e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none w-44">
                    <option>qwen3:8b</option>
                    <option>qwen2.5-coder:7b</option>
                    <option>llama3.2:3b</option>
                  </select>
                </SettingRow>
                <SettingRow label="Ollama Timeout (seconds)" desc="Max wait for local inference (CPU is slow)">
                  <input type="number" value={ollamaTimeout} onChange={e => setOllamaTimeout(+e.target.value)} min={30} max={600}
                         className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white w-24 outline-none focus:border-ghost-accent/40" />
                </SettingRow>
                <SettingRow label="Grok Model" desc="Used for web research and real-time queries">
                  <select value={grokModel} onChange={e => setGrokModel(e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none w-44">
                    <option>grok-4-1-fast-reasoning</option>
                    <option>grok-3-fast-beta</option>
                    <option>grok-3-beta</option>
                  </select>
                </SettingRow>
                <SettingRow label="Claude Model" desc="Deep synthesis and escalation fallback">
                  <select value={claudeModel} onChange={e => setClaudeModel(e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none w-44">
                    <option>claude-sonnet-4-6</option>
                    <option>claude-opus-4-6</option>
                    <option>claude-haiku-4-5-20251001</option>
                  </select>
                </SettingRow>
              </div>
            )}

            {/* ── NOTIFICATIONS ── */}
            {section === 'notifications' && (
              <div>
                <h3 className="text-sm font-bold text-white mb-5" style={{ fontFamily: 'Space Grotesk' }}>Notifications</h3>
                <SettingRow label="Error Alerts" desc="Get notified when agents encounter errors">
                  <Toggle value={notifyErrors} onChange={setNotifyErrors} color="#EF4444" />
                </SettingRow>
                <SettingRow label="Approval Requests" desc="Alert when Warden has items pending approval">
                  <Toggle value={notifyApprovals} onChange={setNotifyApprovals} color="#F59E0B" />
                </SettingRow>
                <SettingRow label="Deploy Events" desc="Notify on PM2 restart / deploy">
                  <Toggle value={notifyDeploy} onChange={setNotifyDeploy} />
                </SettingRow>
                <SettingRow label="Discord Alerts" desc="Route critical alerts to #alerts channel">
                  <Toggle value={discordAlerts} onChange={setDiscordAlerts} color="#7C3AED" />
                </SettingRow>
              </div>
            )}

            {/* ── SECURITY ── */}
            {section === 'security' && (
              <div>
                <h3 className="text-sm font-bold text-white mb-5" style={{ fontFamily: 'Space Grotesk' }}>Security</h3>
                <SettingRow label="Two-Factor Authentication" desc="Require 2FA for portal login">
                  <Toggle value={twoFactor} onChange={setTwoFactor} color="#10B981" />
                </SettingRow>
                <SettingRow label="Session Timeout (minutes)" desc="Auto-logout after inactivity">
                  <input type="number" value={sessionTimeout} onChange={e => setSessionTimeout(+e.target.value)} min={5} max={480}
                         className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white w-24 outline-none focus:border-ghost-accent/40" />
                </SettingRow>
                <SettingRow label="API Keys" desc="Show/hide environment variables in UI">
                  <button onClick={() => setShowApiKeys(!showApiKeys)}
                          className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-lg text-ghost-muted hover:text-white hover:bg-white/5 transition-all"
                          style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                    {showApiKeys ? <EyeOff size={11} /> : <Eye size={11} />}
                    {showApiKeys ? 'Hide' : 'Reveal'}
                  </button>
                </SettingRow>
                {showApiKeys && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 space-y-2">
                    {['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GROK_API_KEY', 'PINECONE_API_KEY', 'NEON_DATABASE_URL'].map(key => (
                      <div key={key} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-black/30 font-mono">
                        <span className="text-[9px] text-ghost-muted/60 w-44">{key}</span>
                        <span className="text-[9px] text-ghost-muted/40">••••••••••••••••</span>
                      </div>
                    ))}
                  </motion.div>
                )}
                <SettingRow label="Permissions Model" desc="Access control hierarchy">
                  <div className="flex gap-1.5">
                    {['OWNER','ADMIN','AGENT','MEMBER'].map(r => (
                      <span key={r} className="text-[8px] px-1.5 py-0.5 rounded font-mono text-ghost-muted/60"
                            style={{ background: 'rgba(255,255,255,0.05)' }}>{r}</span>
                    ))}
                  </div>
                </SettingRow>
              </div>
            )}

            {/* ── APPEARANCE ── */}
            {section === 'appearance' && (
              <div>
                <h3 className="text-sm font-bold text-white mb-5" style={{ fontFamily: 'Space Grotesk' }}>Appearance</h3>
                <SettingRow label="Accent Color" desc="Primary UI accent color">
                  <div className="flex gap-2">
                    {ACCENT_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setAccentColor(c)}
                        className="w-5 h-5 rounded-full transition-all"
                        style={{
                          background: c,
                          border: `2px solid ${accentColor === c ? 'white' : 'transparent'}`,
                          transform: accentColor === c ? 'scale(1.2)' : 'scale(1)',
                        }}
                      />
                    ))}
                  </div>
                </SettingRow>
                <SettingRow label="Compact Mode" desc="Reduce padding and element sizes">
                  <Toggle value={compactMode} onChange={setCompactMode} />
                </SettingRow>
                <SettingRow label="Show Timestamps" desc="Display relative timestamps in feeds">
                  <Toggle value={showTimestamps} onChange={setShowTimestamps} />
                </SettingRow>
                <SettingRow label="Theme" desc="Visual theme selection">
                  <span className="text-[10px] font-mono text-ghost-muted/60">Deep Space (default)</span>
                </SettingRow>
              </div>
            )}

            {/* ── DANGER ZONE ── */}
            {section === 'danger' && (
              <div>
                <h3 className="text-sm font-bold text-red-400 mb-5" style={{ fontFamily: 'Space Grotesk' }}>Danger Zone</h3>
                <p className="text-[10px] text-ghost-muted/60 mb-6">These actions are irreversible. Proceed with caution.</p>

                {[
                  { label: 'Flush Memory', desc: 'Clear all Pinecone vectors in ghost namespace. Agent memory will be lost.', color: '#F59E0B', action: 'Flush Pinecone' },
                  { label: 'Clear Logs',   desc: 'Delete all portal command logs and audit events from database.',             color: '#F59E0B', action: 'Clear Logs'     },
                  { label: 'Stop Ghost',   desc: 'Send PM2 stop command to ghost process. Bot will go offline.',              color: '#EF4444', action: 'Stop Bot'      },
                  { label: 'Wipe Database',desc: 'Drop all portal tables. This cannot be undone.',                            color: '#EF4444', action: 'Wipe DB'       },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between py-4 border-b border-white/[0.05] last:border-0">
                    <div className="flex-1 pr-8">
                      <p className="text-xs font-medium text-white mb-0.5">{item.label}</p>
                      <p className="text-[10px] text-ghost-muted/60">{item.desc}</p>
                    </div>
                    <button
                      className="px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all shrink-0"
                      style={{
                        color: item.color,
                        background: `${item.color}12`,
                        border: `1px solid ${item.color}25`,
                      }}
                    >
                      {item.action}
                    </button>
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
