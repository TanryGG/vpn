#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${1:-/var/www/vpn-gpt-full}"
DETECTED_FILE="${2:-/var/www/vpn-gpt-updates/vds-detected.json}"
VPN_PORT="8443"
XUI_PORT="2053"
if [ -f "$DETECTED_FILE" ]; then
  VPN_PORT=$(jq -r '.vpn_port // "8443"' "$DETECTED_FILE" 2>/dev/null || echo 8443)
fi

echo "==> VPN+GPT health check"
echo "APP_DIR=$APP_DIR"
echo

echo "==> PM2"
pm2 status || true
echo

echo "==> Apache"
systemctl is-active apache2 || true
systemctl status apache2 --no-pager | head -20 || true
echo

echo "==> Node local site"
curl -sS -m 5 -o /tmp/vpngpt_site.html -w "HTTP %{http_code}\n" http://127.0.0.1:3000/ || true
head -3 /tmp/vpngpt_site.html 2>/dev/null || true
echo

echo "==> Xray service"
systemctl is-active vpn-gpt-xray || true
systemctl status vpn-gpt-xray --no-pager | head -40 || true
echo

echo "==> Listening ports"
ss -tulpn | grep -E ":(80|443|3000|${VPN_PORT}|${XUI_PORT})" || true
echo

echo "==> Xray config"
if [ -f /etc/vpn-gpt-xray/config.json ]; then
  jq '.inbounds[0] | {port, protocol, clients:(.settings.clients|length), security:.streamSettings.security, serverNames:.streamSettings.realitySettings.serverNames, shortIds:.streamSettings.realitySettings.shortIds}' /etc/vpn-gpt-xray/config.json || true
else
  echo "/etc/vpn-gpt-xray/config.json not found"
fi
echo

echo "==> Detected settings"
if [ -f "$DETECTED_FILE" ]; then jq . "$DETECTED_FILE" || cat "$DETECTED_FILE"; else echo "detected json not found"; fi
