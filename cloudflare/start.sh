#!/usr/bin/env bash
set -euo pipefail

cd /opt/control-agent

node scripts/dashboard-web.js 3456 &
dashboard_pid=$!

cleanup() {
  kill "$dashboard_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

exec node /opt/cloudflare/server.mjs
