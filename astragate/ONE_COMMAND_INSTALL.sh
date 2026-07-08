#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="vpn-gpt-full"
APP_DIR="/var/www/${APP_NAME}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PORT="${APP_PORT:-3000}"
SITE_HOST="${SITE_HOST:-astragate.su}"
WANT_SSL="${WANT_SSL:-N}"
TG_PROXY_HOST="${TG_PROXY_HOST:-$SITE_HOST}"
TG_PROXY_PORT="${TG_PROXY_PORT:-8445}"
DB_NAME="${DB_NAME:-vpn_gpt}"
DB_USER="${DB_USER:-vpn_gpt_user}"
DB_PASS="${DB_PASS:-$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)}"
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -base64 64 | tr -d '\n')}"
STAMP="$(date +%Y%m%d-%H%M%S)"

log(){ echo -e "\n\033[1;36m==> $*\033[0m"; }
warn(){ echo -e "\033[1;33mWARN: $*\033[0m"; }
fail(){ echo -e "\033[1;31mERROR: $*\033[0m"; exit 1; }
[ "$(id -u)" = "0" ] || fail "Запусти от root: sudo bash ONE_COMMAND_INSTALL.sh"

if [[ "$WANT_SSL" =~ ^[Yy]$ ]]; then APP_URL="https://${SITE_HOST}"; else APP_URL="http://${SITE_HOST}"; fi

log "Резервная копия старых папок astragate/vpn-gpt"
cd /var/www 2>/dev/null || mkdir -p /var/www && cd /var/www
shopt -s nullglob
OLD=(astragate.saved-* astragate-rebuild.saved-* astragate-recovery.saved-* astragate-updates vpn-gpt-updates vpn-gpt-full vpn-gpt-full.*)
if [ ${#OLD[@]} -gt 0 ]; then
  tar -czf "/root/astragate-before-cleanup-${STAMP}.tar.gz" "${OLD[@]}" || true
  log "Бэкап создан: /root/astragate-before-cleanup-${STAMP}.tar.gz"
fi

log "Удаляем лишние старые папки с VDS"
rm -rf /var/www/astragate.saved-* /var/www/astragate-rebuild.saved-* /var/www/astragate-recovery.saved-* /var/www/astragate-updates /var/www/vpn-gpt-updates /var/www/vpn-gpt-full /var/www/vpn-gpt-full.*

log "Чиним apt/dpkg и ставим пакеты"
export DEBIAN_FRONTEND=noninteractive
dpkg --configure -a || true
apt-get -f install -y || true
apt-get update
apt-get install -y curl rsync git apache2 certbot python3-certbot-apache default-mysql-server build-essential openssl ca-certificates dante-server

log "Отключаем nginx, если мешает Apache"
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true

log "Node.js и PM2"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

log "MySQL/MariaDB"
systemctl enable mariadb 2>/dev/null || systemctl enable mysql 2>/dev/null || true
systemctl start mariadb 2>/dev/null || systemctl start mysql 2>/dev/null || true
mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

log "Копируем чистый проект в ${APP_DIR}"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude .git "$SRC_DIR"/ "$APP_DIR"/
cd "$APP_DIR"

log "Создаём production .env"
cat > .env <<ENV
NODE_ENV=production
PORT=${APP_PORT}
APP_URL=${APP_URL}
SESSION_SECRET=${SESSION_SECRET}
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}
ENV
chmod 600 .env

log "npm install, миграции, seed"
npm install --omit=dev
npm run migrate || node scripts/migrate.js
npm run seed || node scripts/seed.js || true

log "Запускаем приложение PM2"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start src/app.js --name "$APP_NAME" --time
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

log "Apache reverse proxy"
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

if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw allow ${APP_PORT}/tcp || true
  ufw allow ${TG_PROXY_PORT}/tcp || true
fi

if [[ "$WANT_SSL" =~ ^[Yy]$ ]]; then
  log "SSL Certbot"
  certbot --apache -d "$SITE_HOST" --non-interactive --agree-tos -m "admin@${SITE_HOST}" --redirect || warn "SSL не выпустился. Проверь DNS и запусти позже: certbot --apache -d ${SITE_HOST}"
fi

log "Telegram SOCKS5 proxy"
APP_DIR="$APP_DIR" TG_PROXY_HOST="$TG_PROXY_HOST" TG_PROXY_PORT="$TG_PROXY_PORT" bash scripts/ag-proxy-autosetup.sh || warn "Telegram proxy не настроился автоматически. Проверь: systemctl status danted --no-pager"

log "Проверка"
pm2 restart "$APP_NAME" --update-env || true
curl -I "http://127.0.0.1:${APP_PORT}/" || true
systemctl status danted --no-pager -l || true

cat <<DONE

✅ Готово.
Сайт: ${APP_URL}/install
Админка/кабинет — после завершения установки через браузер.
Telegram Proxy страница: ${APP_URL}/telegram-proxy

Старые лишние папки удалены. Бэкап старого состояния лежит в /root/astragate-before-cleanup-${STAMP}.tar.gz
Проверка:
  pm2 status
  pm2 logs ${APP_NAME}
  systemctl status apache2 --no-pager
  systemctl status danted --no-pager

Если домен другой, переустанови так:
  SITE_HOST=your-domain.com WANT_SSL=Y bash /var/www/astragate/ONE_COMMAND_INSTALL.sh
DONE
