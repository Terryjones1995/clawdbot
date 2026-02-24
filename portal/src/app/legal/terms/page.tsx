import Link from 'next/link';

export default function TermsPage() {
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
          <h1 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: 'Space Grotesk' }}>Terms of Service</h1>
          <p className="text-xs text-ghost-muted font-mono">Effective: {effectiveDate}</p>
        </div>

        <div className="prose prose-sm prose-invert max-w-none space-y-8">

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>1. Acceptance of Terms</h2>
            <p className="text-sm text-ghost-muted leading-relaxed">
              By accessing Operation Ghost — Mission Control Center ("the Portal"), you agree to be bound by these Terms of Service.
              This Portal is a private, internal tool. Access is restricted to authorized personnel only.
              Unauthorized access is strictly prohibited and may be subject to legal action.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>2. Authorized Use</h2>
            <p className="text-sm text-ghost-muted leading-relaxed mb-3">
              The Portal may only be used for legitimate operational purposes, including:
            </p>
            <ul className="space-y-1.5 text-sm text-ghost-muted">
              {[
                'Monitoring and managing AI agent operations',
                'Reviewing job queues, error logs, and system health',
                'Interacting with the Ghost reception system via the terminal',
                'Managing Discord server integrations and approvals',
                'Reviewing API usage and credit consumption',
              ].map(item => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-ghost-accent mt-0.5 shrink-0">·</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>3. Prohibited Actions</h2>
            <p className="text-sm text-ghost-muted leading-relaxed mb-3">You must not:</p>
            <ul className="space-y-1.5 text-sm text-ghost-muted">
              {[
                'Share credentials with unauthorized parties',
                'Attempt to bypass authentication or authorization controls',
                'Use the Portal or AI agents for illegal activities',
                'Trigger mass operations (mass DM, bulk deletes) without proper authorization via Warden',
                'Intentionally cause service disruption or agent overload',
              ].map(item => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5 shrink-0">✕</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>4. AI Agent Behavior</h2>
            <p className="text-sm text-ghost-muted leading-relaxed">
              The Ghost system uses multiple AI models (Ollama, Grok, OpenAI GPT-4o, Anthropic Claude) to process requests.
              AI responses are generated automatically and may contain errors. All consequential actions — especially those
              flagged by the Warden agent — require human review and approval before execution.
              You remain responsible for reviewing AI-generated content before acting on it.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>5. Data and Privacy</h2>
            <p className="text-sm text-ghost-muted leading-relaxed">
              The Portal stores operational data including command logs, job records, error reports, and API usage metrics
              in a PostgreSQL database (Neon). Agent memory is stored in Pinecone vector database. All data is subject
              to our <Link href="/legal/privacy" className="text-ghost-accent hover:underline">Privacy Policy</Link>.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>6. Service Availability</h2>
            <p className="text-sm text-ghost-muted leading-relaxed">
              The Ghost system runs on a best-effort basis. PM2 manages automatic restarts, and the system includes
              an idle-shutdown mechanism after 120 minutes of inactivity. No uptime SLA is guaranteed for this
              internal operations tool.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>7. Modifications</h2>
            <p className="text-sm text-ghost-muted leading-relaxed">
              These Terms may be updated at any time. Continued use of the Portal constitutes acceptance of the
              updated Terms. The effective date at the top of this page reflects the most recent revision.
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk' }}>8. Contact</h2>
            <p className="text-sm text-ghost-muted leading-relaxed">
              For questions about these Terms, contact the system administrator via Discord or the Portal terminal.
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
