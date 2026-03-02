#!/bin/bash
# Load .env vars and start OpenClaw gateway in foreground
set -a
source /home/projects/clawdbot/.env
set +a
export OPENCLAW_HOME=/root
exec /usr/bin/openclaw gateway run --port 18789 --allow-unconfigured --verbose
