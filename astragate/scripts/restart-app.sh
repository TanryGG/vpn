#!/usr/bin/env bash
set -Eeuo pipefail
APP_NAME="${1:-vpn-gpt-full}"
echo "==> restart request for ${APP_NAME}"
sleep 1
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" || pm2 start npm --name "$APP_NAME" -- start
  pm2 save || true
  echo "==> pm2 restarted"
else
  echo "PM2 не найден"
  exit 1
fi
