import Link from 'next/link';

export default function PrivacyPage() {
  const effectiveDate = 'February 1, 2026';

  return (
    <div className="min-h-screen bg-ghost-bg text-white" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Background */}
      <div className="fixed inset-0 bg-grid-sm opacity-20 pointer-events-none" />

      <div className="relative max-w-3xl mx-auto px-6 py-16">
        {/* Back */}
        <Link href="/login" className="inline-flex items-center gap-2 text-xs text-ghost-muted hover:text-white transition-colors mb-10 font-mono">
          ← Back
        </Link>

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-ghost-accent"
                 style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.2)' }}>
              ⬡
            </div>
            <span className="text-[10px] text-ghost-muted/60 font-mono uppercase tracking-wider">Operation Ghost</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: 'Space Grotesk' }}>Privacy Policy</h1>
          <p className="text-xs text-ghost-muted font-mono">Effective: {effectiveDate}</p>
        </div>

        <div className="space-y-8">

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>Overview</h2>
            <p className="text-sm text-ghost-muted leading-relaxed">
              This Privacy Policy describes how Operation Ghost — Mission Control Center ("the Portal") collects,
              uses, and protects data. This is a private internal system. All data is owned and controlled by the
              system administrator.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>Data We Collect</h2>
            <div className="space-y-4">
              {[
                {
                  title: 'Authentication Data',
                  items: ['Username and bcrypt-hashed password', 'Session tokens (stored server-side via NextAuth)', 'Login timestamps'],
                },
                {
                  title: 'Operational Data',
                  items: [
                    'Command logs: messages sent via the terminal and their responses',
                    'Job records: agent task execution history, status, and results',
                    'Error logs: system errors and their resolution status',
                    'API usage: token counts, costs, and latency metrics per provider',
                    'Audit events: significant system actions with actor attribution',
                  ],
                },
                {
                  title: 'Agent Memory',
                  items: [
                    'Vector embeddings stored in Pinecone (ghost namespace)',
                    'Contextual memory retrieved during agent operations',
                    'No personally identifiable information is intentionally stored in vectors',
                  ],
                },
              ].map(section => (
                <div key={section.title}>
                  <p className="text-xs font-semibold text-white/80 mb-2">{section.title}</p>
                  <ul className="space-y-1.5">
                    {section.items.map(item => (
                      <li key={item} className="flex items-start gap-2 text-sm text-ghost-muted">
                        <span className="text-ghost-accent mt-0.5 shrink-0">·</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>Data Storage</h2>
            <div className="space-y-3 text-sm text-ghost-muted">
              <p>Operational data is stored in:</p>
              <div className="space-y-2 ml-2">
                <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.1)' }}>
                  <span className="text-ghost-accent font-bold">DB</span>
                  <div>
                    <p className="font-medium text-white/80 text-xs mb-0.5">Neon PostgreSQL</p>
                    <p className="text-[10px]">AWS us-east-1 · TLS-encrypted · Connection pooling via PgBouncer</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.1)' }}>
                  <span className="text-ghost-accent font-bold">VDB</span>
                  <div>
                    <p className="font-medium text-white/80 text-xs mb-0.5">Pinecone Serverless</p>
                    <p className="text-[10px]">AWS us-east-1 · Cosine similarity · 768-dimensional vectors</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>Third-Party AI Providers</h2>
            <p className="text-sm text-ghost-muted leading-relaxed mb-3">
              The Ghost system sends queries to external AI providers to process requests. Each provider has its own
              privacy policy governing how they handle API inputs:
            </p>
            <div className="space-y-2 text-xs">
              {[
                { name: 'Ollama (Local)',    desc: 'Runs entirely on-premises. No data leaves your machine.',                note: '✓ Zero data exposure' },
                { name: 'xAI / Grok',       desc: 'Research and real-time queries sent to xAI API.',                        note: 'Review xAI privacy policy' },
                { name: 'OpenAI',           desc: 'Real-time search and vision queries sent to OpenAI API.',                 note: 'Review OpenAI privacy policy' },
                { name: 'Anthropic Claude', desc: 'Deep synthesis queries (when credits available) sent to Anthropic API.',  note: 'Review Anthropic privacy policy' },
              ].map(p => (
                <div key={p.name} className="flex items-start justify-between p-3 rounded-xl"
                     style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div>
                    <p className="font-medium text-white/80">{p.name}</p>
                    <p className="text-ghost-muted/60 mt-0.5">{p.desc}</p>
                  </div>
                  <span className="text-ghost-muted/40 text-[9px] ml-4 shrink-0">{p.note}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>Data Retention</h2>
            <p className="text-sm text-ghost-muted leading-relaxed">
              Operational logs are retained indefinitely unless manually cleared via the Settings → Danger Zone panel.
              Session tokens expire after the configured session timeout period. Vector memories in Pinecone persist until
              explicitly deleted via the Archivist agent or admin panel.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>Security</h2>
            <p className="text-sm text-ghost-muted leading-relaxed">
              Passwords are stored as bcrypt hashes (never plaintext). API keys are stored in environment variables and
              never committed to version control. All database connections use TLS. The Portal requires authentication
              for all routes. Sensitive operations require Warden approval.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>Your Rights</h2>
            <p className="text-sm text-ghost-muted leading-relaxed">
              As an authorized user, you can request deletion of your account data at any time by contacting the
              system administrator. You can clear operational logs via Settings → Danger Zone.
              Vector memories can be flushed via the same panel.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>Contact</h2>
            <p className="text-sm text-ghost-muted leading-relaxed">
              Questions about this Privacy Policy should be directed to the system administrator via Discord
              or the Portal terminal command: <code className="text-ghost-accent font-mono text-[10px]">@Helm privacy query</code>
            </p>
          </section>

        </div>

        <div className="mt-16 pt-6 border-t border-white/5 flex items-center justify-between text-[10px] text-ghost-muted/30 font-mono">
          <span>Operation Ghost — Mission Control Center</span>
          <span>Created by Terry · {new Date().getFullYear()}</span>
        </div>
      </div>
    </div>
  );
}
