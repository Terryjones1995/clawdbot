/**
 * portal-start.js — PM2-compatible Next.js server starter (Windows safe)
 *
 * PM2 cannot run bash shebang scripts (.bin/next) directly on Windows.
 * This script starts the Next.js server by importing the server module
 * directly, bypassing the shebang wrapper.
 */

'use strict';

const path = require('path');

// Next.js reads cwd for the project directory
process.chdir(path.join(__dirname, 'portal'));

process.env.PORT     = process.env.PORT     || '3001';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { nextStart } = require('./portal/node_modules/next/dist/cli/next-start');

nextStart({ port: parseInt(process.env.PORT, 10), hostname: '0.0.0.0' }, '.')
  .catch((err) => {
    console.error('[ghost-portal] Startup error:', err);
    process.exit(1);
  });
