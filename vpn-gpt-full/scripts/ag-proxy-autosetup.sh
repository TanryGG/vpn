#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${APP_DIR:-/var/www/vpn-gpt-full}";HOST="${TG_PROXY_HOST:-astragate.su}";PORT="${TG_PROXY_PORT:-8445}";USER_NAME="${TG_PROXY_USER:-tgproxy}";PASSWORD="${TG_PROXY_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)}"
[ "$(id -u)" = "0" ] || { echo "Run as root"; exit 1; }
apt-get update;DEBIAN_FRONTEND=noninteractive apt-get install -y dante-server curl openssl
IFACE="$(ip route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')";[ -n "$IFACE" ]||IFACE="eth0"
id "$USER_NAME" >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin "$USER_NAME" || true
echo "$USER_NAME:$PASSWORD"|chpasswd
cat >/etc/danted.conf <<EOF
logoutput: syslog
internal: 0.0.0.0 port = $PORT
external: $IFACE
socksmethod: username
clientmethod: none
user.privileged: root
user.notprivileged: nobody
user.libwrap: nobody
client pass { from: 0.0.0.0/0 to: 0.0.0.0/0 log: connect disconnect error }
socks pass { from: 0.0.0.0/0 to: 0.0.0.0/0 command: bind connect udpassociate socksmethod: username log: connect disconnect error }
EOF
systemctl enable danted;systemctl restart danted;ufw allow "$PORT"/tcp 2>/dev/null || true
mkdir -p /root/astragate
TG_URL="tg://socks?server=$HOST&port=$PORT&user=$USER_NAME&pass=$PASSWORD"
cat >/root/astragate/telegram-proxy.json <<EOF
{"type":"socks5","host":"$HOST","port":"$PORT","username":"$USER_NAME","password":"$PASSWORD","url":"$TG_URL","price_month_rub":50}
EOF
chmod 600 /root/astragate/telegram-proxy.json
cd "$APP_DIR";node scripts/ag-proxy-save.js --host "$HOST" --port "$PORT" --username "$USER_NAME" --password "$PASSWORD" || true;node scripts/ag-proxy-seed.js || true
pm2 restart vpn-gpt-full --update-env 2>/dev/null || pm2 restart astragate --update-env 2>/dev/null || pm2 restart all --update-env || true
echo "$TG_URL"
