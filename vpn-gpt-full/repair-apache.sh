#!/usr/bin/env bash
set -Eeuo pipefail
APP_NAME="vpn-gpt-full"
APP_DIR="/var/www/vpn-gpt-full"
APP_PORT="3000"
log(){ echo -e "\n\033[1;36m==> $*\033[0m"; }
if [ "${EUID}" -ne 0 ]; then echo "Запусти от root: sudo bash repair-apache.sh"; exit 1; fi
PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
read -rp "Домен или IP [${PUBLIC_IP:-localhost}]: " SITE_HOST
SITE_HOST="${SITE_HOST:-${PUBLIC_IP:-localhost}}"
log "Чиним dpkg/apt"
dpkg --configure -a || true
apt-get -f install -y || true
log "Удаляем Nginx, если мешает"
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true
apt-get remove --purge -y nginx nginx-common nginx-core nginx-full python3-certbot-nginx || true
apt-get autoremove -y || true
log "Ставим Apache"
apt-get update
apt-get install -y apache2 certbot python3-certbot-apache curl
log "Настраиваем Apache proxy"
a2enmod proxy proxy_http headers rewrite ssl remoteip >/dev/null
cat > /etc/apache2/sites-available/${APP_NAME}.conf <<APACHE
<VirtualHost *:80>
    ServerName ${SITE_HOST}
    ServerAlias www.${SITE_HOST}
    ProxyPreserveHost On
    ProxyRequests Off
    RequestHeader set X-Forwarded-Proto "http"
    ProxyPass / http://127.0.0.1:${APP_PORT}/ retry=0 timeout=300
    ProxyPassReverse / http://127.0.0.1:${APP_PORT}/
    ErrorLog \${APACHE_LOG_DIR}/${APP_NAME}_error.log
    CustomLog \${APACHE_LOG_DIR}/${APP_NAME}_access.log combined
</VirtualHost>
APACHE
a2dissite 000-default >/dev/null 2>&1 || true
a2ensite ${APP_NAME}.conf >/dev/null
apache2ctl configtest
systemctl enable apache2
systemctl restart apache2
log "Проверяем Node-приложение"
cd "$APP_DIR" 2>/dev/null || { echo "Нет $APP_DIR. Сначала запусти install.sh"; exit 1; }
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
pm2 restart "$APP_NAME" || pm2 start src/app.js --name "$APP_NAME" --time
pm2 save
curl -I http://127.0.0.1:${APP_PORT}/install || true
echo "Готово: http://${SITE_HOST}/install"
