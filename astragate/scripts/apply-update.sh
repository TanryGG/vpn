#!/usr/bin/env bash
set -Eeuo pipefail
ZIP_FILE="$1"
APP_DIR="${2:-/var/www/vpn-gpt-full}"
APP_NAME="vpn-gpt-full"
BACKUP_DIR="/var/backups/vpn-gpt-full"
TMP_DIR="/tmp/vpn-gpt-update-$(date +%s)"
mkdir -p "$BACKUP_DIR" "$TMP_DIR"
echo "==> ZIP: $ZIP_FILE"
echo "==> APP_DIR: $APP_DIR"
if [ ! -f "$ZIP_FILE" ]; then echo "ZIP не найден"; exit 1; fi
if [ ! -d "$APP_DIR" ]; then echo "APP_DIR не найден"; exit 1; fi
BACKUP="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).tar.gz"
echo "==> Делаю бэкап: $BACKUP"
tar --exclude=node_modules --exclude=.git -czf "$BACKUP" -C "$(dirname "$APP_DIR")" "$(basename "$APP_DIR")"
echo "==> Распаковываю обновление"
unzip -q "$ZIP_FILE" -d "$TMP_DIR"
SRC="$TMP_DIR/vpn-gpt-full"
if [ ! -d "$SRC" ]; then SRC="$TMP_DIR"; fi
if [ ! -f "$SRC/package.json" ]; then
  FOUND=$(find "$TMP_DIR" -maxdepth 4 -name package.json -type f | head -n1 || true)
  if [ -n "$FOUND" ]; then SRC=$(dirname "$FOUND"); fi
fi
if [ ! -f "$SRC/package.json" ]; then echo "В архиве не найден package.json"; exit 1; fi
cp "$APP_DIR/.env" /tmp/vpn-gpt-env-backup 2>/dev/null || true
echo "==> Копирую файлы"
rsync -a --delete --exclude node_modules --exclude .env --exclude uploads "$SRC"/ "$APP_DIR"/
if [ -f /tmp/vpn-gpt-env-backup ]; then cp /tmp/vpn-gpt-env-backup "$APP_DIR/.env"; fi
cd "$APP_DIR"
echo "==> npm install"
npm install --omit=dev --no-fund
if npm run | grep -q ' migrate'; then
  echo "==> migrations"
  npm run migrate
fi
if npm run | grep -q ' seed'; then
  echo "==> seed"
  npm run seed || true
fi
echo "==> restart pm2"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" || pm2 start npm --name "$APP_NAME" -- start
  pm2 save || true
else
  echo "PM2 не найден"
fi
echo "==> done"
