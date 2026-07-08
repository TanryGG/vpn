#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${1:-/var/www/vpn-gpt-full}"
WWW_DIR="$(dirname "$APP_DIR")"
BACKUP_DIR="/var/backups/vpn-gpt-full"
mkdir -p "$BACKUP_DIR"
echo "==> Рабочая папка: $APP_DIR"
echo "==> Делаю бэкап"
tar --exclude=node_modules --exclude=.git -czf "$BACKUP_DIR/before-merge-clean-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$WWW_DIR" "$(basename "$APP_DIR")" 2>/dev/null || true
# If nested project exists, lift it up while preserving .env/uploads.
if [ -f "$APP_DIR/vpn-gpt-full/package.json" ]; then
  echo "==> Найдена вложенная папка $APP_DIR/vpn-gpt-full. Объединяю."
  TMP="/tmp/vpn-gpt-merge-$(date +%s)"
  mkdir -p "$TMP"
  rsync -a "$APP_DIR/vpn-gpt-full/" "$TMP/"
  [ -f "$APP_DIR/.env" ] && cp "$APP_DIR/.env" "$TMP/.env"
  [ -d "$APP_DIR/uploads" ] && rsync -a "$APP_DIR/uploads/" "$TMP/uploads/"
  rsync -a --delete --exclude node_modules "$TMP/" "$APP_DIR/"
  rm -rf "$TMP" "$APP_DIR/vpn-gpt-full"
fi
# Remove known temp dirs around app.
rm -rf "$WWW_DIR/vpn-gpt-full-new" "$WWW_DIR/vpn-gpt-clean" 2>/dev/null || true
cd "$APP_DIR"
chmod +x scripts/*.sh install.sh repair-apache.sh install-vpn-3xui.sh 2>/dev/null || true
npm install --omit=dev --no-fund
npm run migrate
npm run seed || true
pm2 restart vpn-gpt-full || pm2 start npm --name vpn-gpt-full -- start
pm2 save || true
systemctl restart apache2 || true
echo "==> Готово. Оставлена одна рабочая папка: $APP_DIR"
