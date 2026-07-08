#!/usr/bin/env bash
set -Eeuo pipefail
cd /var/www/vpn-gpt-full
node scripts/repair-happ-vpn-now.js
systemctl daemon-reload
systemctl enable vpn-gpt-xray >/dev/null 2>&1 || true
systemctl restart vpn-gpt-xray
ufw allow 8443/tcp >/dev/null 2>&1 || true
ufw allow 8444/tcp >/dev/null 2>&1 || true
pm2 restart vpn-gpt-full --update-env || pm2 start src/app.js --name vpn-gpt-full --time --update-env
pm2 save
systemctl restart apache2 || true
TOKEN=$(mysql -u root -N -B -e "USE vpn_gpt; SELECT sub_token FROM vpn_accounts WHERE sub_token IS NOT NULL AND sub_token!='' ORDER BY id DESC LIMIT 1;" 2>/dev/null || true)
echo "SUB=https://astragate.su/sub/$TOKEN"
echo "PLAIN=https://astragate.su/sub/$TOKEN/plain"
echo "=== SUB TEST ==="
[ -n "$TOKEN" ] && curl -i "https://astragate.su/sub/$TOKEN" | head -80 || true
echo "=== PLAIN BODY ==="
[ -n "$TOKEN" ] && curl -s "https://astragate.su/sub/$TOKEN/plain" | head -5 || true
echo "=== XRAY ==="
systemctl status vpn-gpt-xray --no-pager | head -30 || true
echo "=== PORTS ==="
ss -tulpn | grep -E ':8443|:8444' || true
