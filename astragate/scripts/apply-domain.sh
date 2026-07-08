#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${1:-/var/www/vpn-gpt-full}"
DOMAIN="${2:-}"
EMAIL="${3:-admin@example.com}"
UPDATE_DIR="${4:-/var/www/vpn-gpt-updates}"
LOG_PREFIX="==>"
if [ -z "$DOMAIN" ]; then echo "ERROR: domain is required"; exit 1; fi
DOMAIN=$(echo "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##; s#^www\.##')
if ! echo "$DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'; then echo "ERROR: invalid domain: $DOMAIN"; exit 1; fi
mkdir -p "$UPDATE_DIR"
echo "$LOG_PREFIX Домен: $DOMAIN"
echo "$LOG_PREFIX APP_DIR: $APP_DIR"
cd "$APP_DIR"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y apache2 certbot python3-certbot-apache dnsutils curl jq ufw
PUBLIC_IP=$(curl -4fsS https://api.ipify.org || hostname -I | awk '{print $1}')
DOMAIN_IP=$(dig +short A "$DOMAIN" | tail -n1 || true)
WWW_IP=$(dig +short A "www.$DOMAIN" | tail -n1 || true)
echo "$LOG_PREFIX IP сервера: $PUBLIC_IP"
echo "$LOG_PREFIX A $DOMAIN: ${DOMAIN_IP:-не найден}"
echo "$LOG_PREFIX A www.$DOMAIN: ${WWW_IP:-не найден}"
if [ -n "$DOMAIN_IP" ] && [ "$DOMAIN_IP" != "$PUBLIC_IP" ]; then
  echo "WARNING: A-запись $DOMAIN указывает на $DOMAIN_IP, а сервер $PUBLIC_IP. Certbot может не пройти. Исправь DNS, если будет ошибка."
fi
cat >/etc/apache2/sites-available/vpn-gpt-full.conf <<APACHE
<VirtualHost *:80>
    ServerName $DOMAIN
    ServerAlias www.$DOMAIN

    ProxyPreserveHost On
    ProxyRequests Off
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/

    ErrorLog \${APACHE_LOG_DIR}/vpn-gpt-full-error.log
    CustomLog \${APACHE_LOG_DIR}/vpn-gpt-full-access.log combined
</VirtualHost>
APACHE

a2enmod proxy proxy_http headers rewrite ssl >/dev/null || true
a2dissite 000-default.conf >/dev/null 2>&1 || true
a2ensite vpn-gpt-full.conf >/dev/null
apache2ctl configtest
systemctl restart apache2
ufw allow 80/tcp || true
ufw allow 443/tcp || true
if [ "$EMAIL" = "" ] || [ "$EMAIL" = "admin@example.com" ]; then EMAIL="admin@$DOMAIN"; fi
CERTBOT_DOMAINS=("-d" "$DOMAIN")
if [ -n "$WWW_IP" ] && [ "$WWW_IP" = "$PUBLIC_IP" ]; then CERTBOT_DOMAINS+=("-d" "www.$DOMAIN"); fi
echo "$LOG_PREFIX Запускаю certbot для ${CERTBOT_DOMAINS[*]}"
certbot --apache --non-interactive --agree-tos --redirect -m "$EMAIL" "${CERTBOT_DOMAINS[@]}" || {
  echo "WARNING: Certbot не смог выпустить SSL. Сайт будет работать по HTTP, проверь DNS и запусти повторно."
}
node scripts/set-domain-settings.js "$DOMAIN" || true
pm2 restart vpn-gpt-full --update-env || pm2 start npm --name vpn-gpt-full -- start
pm2 save || true
systemctl restart apache2
cat >"$UPDATE_DIR/domain-last.json" <<JSON
{"domain":"$DOMAIN","public_ip":"$PUBLIC_IP","domain_ip":"$DOMAIN_IP","www_ip":"$WWW_IP","app_url":"https://$DOMAIN","icon_url":"https://$DOMAIN/img/app-icon.png","completed_at":"$(date -Iseconds)"}
JSON
echo "$LOG_PREFIX Готово"
echo "$LOG_PREFIX Сайт: https://$DOMAIN"
echo "$LOG_PREFIX Icon URL: https://$DOMAIN/img/app-icon.png"
echo "$LOG_PREFIX Happ host теперь будет: $DOMAIN после пересборки ссылок"
