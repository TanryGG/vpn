#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/var/www/vpn-gpt-full"
APP_NAME="vpn-gpt-full"
APP_PORT="3000"
DB_NAME="vpn_gpt"
DB_USER="vpn_gpt_user"
DB_PASS="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)"
SESSION_SECRET="$(openssl rand -base64 64 | tr -d '\n')"

log(){ echo -e "\n\033[1;36m==> $*\033[0m"; }
warn(){ echo -e "\033[1;33mWARN: $*\033[0m"; }
fail(){ echo -e "\033[1;31mERROR: $*\033[0m"; exit 1; }

if [ "${EUID}" -ne 0 ]; then fail "Запусти от root: sudo bash install.sh"; fi

PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
DEFAULT_HOST="${PUBLIC_IP:-localhost}"
read -rp "Домен сайта или IP [${DEFAULT_HOST}]: " SITE_HOST
SITE_HOST="${SITE_HOST:-$DEFAULT_HOST}"
read -rp "Выпускать HTTPS через Certbot? Только если домен уже указывает на сервер. [y/N]: " WANT_SSL
WANT_SSL="${WANT_SSL:-N}"

if [[ "$WANT_SSL" =~ ^[Yy]$ ]]; then
  APP_URL="https://${SITE_HOST}"
else
  APP_URL="http://${SITE_HOST}"
fi

log "Чиним незавершённые установки apt/dpkg, если они есть"
dpkg --configure -a || true
apt-get -f install -y || true

log "Убираем Nginx и nginx-плагин Certbot, чтобы не было конфликта с Apache"
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true
apt-get remove --purge -y nginx nginx-common nginx-core nginx-full python3-certbot-nginx || true
apt-get autoremove -y || true
dpkg --configure -a || true
apt-get -f install -y || true

log "Ставим системные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl unzip rsync git apache2 certbot python3-certbot-apache default-mysql-server build-essential openssl ca-certificates

log "Включаем Apache reverse proxy"
a2enmod proxy proxy_http headers rewrite ssl remoteip >/dev/null
systemctl enable apache2
systemctl restart apache2

log "Ставим Node.js 22, если его нет"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

log "Ставим PM2"
npm install -g pm2

log "Готовим MySQL/MariaDB"
systemctl enable mariadb 2>/dev/null || systemctl enable mysql 2>/dev/null || true
systemctl start mariadb 2>/dev/null || systemctl start mysql 2>/dev/null || true
mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

log "Копируем проект в ${APP_DIR}"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude .git ./ "$APP_DIR"/
cd "$APP_DIR"

log "Создаём .env"
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

log "Ставим npm-зависимости и миграции"
npm install --omit=dev
npm run migrate
npm run seed

log "Запускаем приложение через PM2"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start src/app.js --name "$APP_NAME" --time
pm2 save
pm2 startup systemd -u root --hp /root >/tmp/pm2-startup.txt 2>/dev/null || true

log "Настраиваем Apache на порт 80 как reverse proxy"
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
systemctl reload apache2

if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw allow ${APP_PORT}/tcp || true
fi

if [[ "$WANT_SSL" =~ ^[Yy]$ ]]; then
  log "Пробуем выпустить SSL. Если DNS ещё не настроен — сайт всё равно будет доступен по http://${SITE_HOST}"
  certbot --apache -d "$SITE_HOST" --non-interactive --agree-tos -m "admin@${SITE_HOST}" --redirect || warn "SSL не выпустился. Проверь DNS и запусти: certbot --apache -d ${SITE_HOST}"
fi

log "Проверяем локальный порт"
curl -I "http://127.0.0.1:${APP_PORT}/install" || true

cat <<DONE

✅ Установка завершена.

Открой:
  ${APP_URL}/install

Если открываешь по IP и HTTPS не включал:
  http://${SITE_HOST}/install

Полезные команды:
  pm2 status
  pm2 logs ${APP_NAME}
  systemctl status apache2 --no-pager
  journalctl -u apache2 -n 80 --no-pager

Если сайт не открывается снаружи, проверь firewall у VDS-провайдера: нужны порты 80 и 443.
DONE
