#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="/var/www/vpn-gpt-full"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="/var/backups/vpn-gpt-full"
mkdir -p "$BACKUP_DIR"
echo "==> Backup current app"
tar -czf "$BACKUP_DIR/before-full-rebuild-$(date +%F-%H%M).tar.gz" "$APP_DIR" 2>/dev/null || true
cp "$APP_DIR/.env" /tmp/vpn-gpt-env-backup 2>/dev/null || true
mkdir -p /tmp/vpn-gpt-uploads-backup
rsync -a "$APP_DIR/uploads/" /tmp/vpn-gpt-uploads-backup/ 2>/dev/null || true

echo "==> Replace files in $APP_DIR"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude='.env' --exclude='node_modules' --exclude='uploads' "$SRC_DIR/" "$APP_DIR/"
cp /tmp/vpn-gpt-env-backup "$APP_DIR/.env" 2>/dev/null || true
mkdir -p "$APP_DIR/uploads"
rsync -a /tmp/vpn-gpt-uploads-backup/ "$APP_DIR/uploads/" 2>/dev/null || true

cd "$APP_DIR"
chmod +x scripts/*.sh scripts/*.js install.sh repair-apache.sh install-vpn-3xui.sh FORCE_RESTORE.sh 2>/dev/null || true

echo "==> Install npm deps"
npm install --omit=dev

echo "==> Migrate + seed"
npm run migrate
npm run seed || true

echo "==> Repair Happ/Xray/VLESS links"
bash scripts/repair-happ-vpn-now.sh || true

echo "==> Recreate PM2 process from exact path"
pm2 delete vpn-gpt-full 2>/dev/null || true
pm2 start "$APP_DIR/src/app.js" --name vpn-gpt-full --cwd "$APP_DIR" --time --update-env
pm2 save

echo "==> Restart Apache"
systemctl restart apache2 || true

echo "==> Verify"
sleep 2
curl -I http://127.0.0.1:3000 || true
pm2 status

echo "DONE. Open site and hard refresh: Ctrl+F5 / clear mobile cache."
