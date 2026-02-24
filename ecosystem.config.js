/**
 * PM2 Ecosystem Config — Ghost AI
 *
 * Usage:
 *   npm run pm2:start    — start Ghost under PM2
 *   npm run pm2:stop     — stop
 *   npm run pm2:restart  — restart
 *   npm run pm2:logs     — tail logs
 *   npm run pm2:status   — process list
 *   npm run pm2:save     — persist process list across reboots
 *   npm run pm2:startup  — generate OS startup script (run once)
 */

module.exports = {
  apps: [
    {
      name:   'ghost-portal',
      script: 'portal-start.js',
      cwd:    '.',

      // ── Restart behaviour ───────────────────────────────────────────────────
      autorestart:              true,
      restart_delay:            5000,
      exp_backoff_restart_delay: 100,
      max_restarts:             10,

      // ── Memory guard ────────────────────────────────────────────────────────
      max_memory_restart: '512M',

      // ── Logs ────────────────────────────────────────────────────────────────
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file:      './logs/portal-error.log',
      out_file:        './logs/portal-out.log',
      merge_logs:      true,

      // ── Environment ─────────────────────────────────────────────────────────
      env: {
        NODE_ENV:       'production',
        PORT:           '3001',
      },
    },
    {
      name:   'ghost',
      script: 'server.js',

      // ── Restart behaviour ───────────────────────────────────────────────────
      // Auto-restart if it crashes
      autorestart: true,
      // Wait 5s between crash restarts (prevents restart loops hammering APIs)
      restart_delay: 5000,
      // Back off exponentially on repeated crashes (5s → 10s → 20s …)
      exp_backoff_restart_delay: 100,
      // Give up after 10 restarts in a restart loop
      max_restarts: 10,

      // ── Memory guard ────────────────────────────────────────────────────────
      // Restart cleanly if RSS exceeds 450MB (qwen2.5-coder:7b is CPU-side,
      // Node.js itself stays well under this)
      max_memory_restart: '450M',

      // ── Scheduled daily restart ─────────────────────────────────────────────
      // 04:00 UTC — fresh process before the 08:00 Scribe briefing.
      // Clears any memory accumulation from the previous day.
      cron_restart: '0 4 * * *',

      // ── Logs ────────────────────────────────────────────────────────────────
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file:      './logs/error.log',
      out_file:        './logs/out.log',
      merge_logs:      true,

      // ── Environment ─────────────────────────────────────────────────────────
      env: {
        NODE_ENV:              'production',
        // Shut down after 2 hours of no Discord messages or HTTP requests.
        // PM2 will restart the process immediately — this just frees memory
        // and clears any state from long-running sessions.
        IDLE_SHUTDOWN_MINUTES: '120',
      },
    },
  ],
};
