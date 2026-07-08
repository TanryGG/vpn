#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${1:-/var/www/vpn-gpt-full}"
DETECTED_FILE="${2:-/var/www/vpn-gpt-updates/vds-detected.json}"
MODE="${3:-full}"
PUBLIC_IP_ARG="${4:-}"
XUI_PORT="${5:-2053}"
XUI_USER="${6:-admin}"
XUI_PASS="${7:-}"
VPN_PORT="${8:-8443}"
VPN_SNI="${9:-www.microsoft.com}"
VPN_NAME="${10:-VPN+GPT Premium}"
VPN_REGION="${11:-Premium}"
WHITE_VPN_PORT="${12:-8444}"
WHITE_VPN_NAME="${13:-White VPN}"
WHITE_VPN_REGION="${14:-White}"

log(){ echo "==> $*"; }
fail(){ echo "ERROR: $*"; exit 1; }

if [ "$(id -u)" != "0" ]; then
  fail "Автонастройка должна запускаться от root. PM2/Node должен быть запущен от root."
fi

mkdir -p "$(dirname "$DETECTED_FILE")" /etc/vpn-gpt-xray
log "VPN+GPT full autosetup"
log "APP_DIR: $APP_DIR"
log "MODE: $MODE"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl wget unzip jq lsof socat ca-certificates ufw apache2 build-essential sqlite3 openssl rsync

systemctl enable apache2 || true
systemctl restart apache2 || true

if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw allow "${XUI_PORT}/tcp" || true
  ufw allow "${VPN_PORT}/tcp" || true
  ufw allow "${WHITE_VPN_PORT}/tcp" || true
fi

PUBLIC_IP="$PUBLIC_IP_ARG"
if [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP=$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
fi
[ -n "$PUBLIC_IP" ] || fail "Не удалось определить public IP"

if [ -z "$XUI_PASS" ]; then
  XUI_PASS=$(openssl rand -hex 8)
fi
SHORT_ID=$(openssl rand -hex 4)
INBOUND_ID="local"

log "Public IP: $PUBLIC_IP"
log "VPN port: $VPN_PORT"
log "White VPN port: $WHITE_VPN_PORT"
log "SNI: $VPN_SNI"

# Получаем Xray binary. Самый надёжный путь: использовать binary из 3x-ui, если он уже стоит.
XRAY_BIN=""
for b in /usr/local/x-ui/bin/xray-linux-amd64 /usr/local/x-ui/bin/xray /usr/bin/xray /usr/local/bin/xray /usr/local/bin/vpn-gpt-xray; do
  if [ -x "$b" ]; then XRAY_BIN="$b"; break; fi
done

if [ -z "$XRAY_BIN" ]; then
  log "Xray binary не найден. Устанавливаю 3x-ui, чтобы получить Xray-core."
  bash <(curl -Ls https://raw.githubusercontent.com/MHSanaei/3x-ui/master/install.sh) || true
  systemctl restart x-ui || true
  sleep 2
  for b in /usr/local/x-ui/bin/xray-linux-amd64 /usr/local/x-ui/bin/xray /usr/bin/xray /usr/local/bin/xray; do
    if [ -x "$b" ]; then XRAY_BIN="$b"; break; fi
  done
fi
[ -n "$XRAY_BIN" ] || fail "Xray binary не найден даже после установки 3x-ui"

cp "$XRAY_BIN" /usr/local/bin/vpn-gpt-xray || true
chmod +x /usr/local/bin/vpn-gpt-xray
XRAY_RUN="/usr/local/bin/vpn-gpt-xray"
log "Xray binary: $XRAY_RUN"

gen_reality_keys(){
  local label="$1"
  log "Генерирую Reality ключи: ${label}"
  local out="" priv="" pub=""
  for kb in "$XRAY_RUN" /usr/local/x-ui/bin/xray-linux-amd64 /usr/local/x-ui/bin/xray /usr/bin/xray /usr/local/bin/xray; do
    if [ -x "$kb" ]; then
      log "Пробую ключи через: $kb x25519"
      out=$($kb x25519 2>&1 || true)
      echo "$out"
      priv=$(echo "$out" | sed -nE 's/.*[Pp]rivate[ _-]?[Kk]ey[^A-Za-z0-9_-]*([A-Za-z0-9_-]{20,}).*/\1/p' | head -n1)
      pub=$(echo "$out" | sed -nE 's/.*[Pp]ublic[ _-]?[Kk]ey[^A-Za-z0-9_-]*([A-Za-z0-9_-]{20,}).*/\1/p' | head -n1)
      if [ -n "$priv" ] && [ -n "$pub" ]; then
        echo "$priv|$pub"
        return 0
      fi
    fi
  done
  echo "ERROR|$out"
  return 1
}

MAIN_KEYS=$(gen_reality_keys "обычный VPN" | tail -n1)
PRIVATE_KEY=$(echo "$MAIN_KEYS" | cut -d'|' -f1)
PUBLIC_KEY=$(echo "$MAIN_KEYS" | cut -d'|' -f2)
[ "$PRIVATE_KEY" != "ERROR" ] || fail "Не удалось получить private/public key Reality для обычного VPN"
WHITE_KEYS=$(gen_reality_keys "White VPN" | tail -n1)
WHITE_PRIVATE_KEY=$(echo "$WHITE_KEYS" | cut -d'|' -f1)
WHITE_PUBLIC_KEY=$(echo "$WHITE_KEYS" | cut -d'|' -f2)
[ "$WHITE_PRIVATE_KEY" != "ERROR" ] || fail "Не удалось получить private/public key Reality для White VPN"
SHORT_ID=$(openssl rand -hex 4)
WHITE_SHORT_ID=$(openssl rand -hex 4)
log "Reality public key VPN: $PUBLIC_KEY"
log "Reality public key White: $WHITE_PUBLIC_KEY"

cat > /etc/vpn-gpt-xray/clients.json <<'JSON'
[]
JSON

cat > /etc/vpn-gpt-xray/config.json <<JSON
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "tag": "vpn-gpt-main",
      "listen": "0.0.0.0",
      "port": ${VPN_PORT},
      "protocol": "vless",
      "settings": { "clients": [], "decryption": "none" },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "${VPN_SNI}:443",
          "xver": 0,
          "serverNames": ["${VPN_SNI}"],
          "privateKey": "${PRIVATE_KEY}",
          "minClient": "",
          "maxClient": "",
          "maxTimediff": 0,
          "shortIds": ["${SHORT_ID}"],
          "settings": { "publicKey": "", "fingerprint": "chrome", "serverName": "", "spiderX": "/" }
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"], "metadataOnly": false, "routeOnly": false }
    },
    {
      "tag": "vpn-gpt-white",
      "listen": "0.0.0.0",
      "port": ${WHITE_VPN_PORT},
      "protocol": "vless",
      "settings": { "clients": [], "decryption": "none" },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "${VPN_SNI}:443",
          "xver": 0,
          "serverNames": ["${VPN_SNI}"],
          "privateKey": "${WHITE_PRIVATE_KEY}",
          "minClient": "",
          "maxClient": "",
          "maxTimediff": 0,
          "shortIds": ["${WHITE_SHORT_ID}"],
          "settings": { "publicKey": "", "fingerprint": "chrome", "serverName": "", "spiderX": "/" }
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"], "metadataOnly": false, "routeOnly": false }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct", "settings": { "domainStrategy": "UseIPv4" } },
    { "protocol": "blackhole", "tag": "block" }
  ],
  "dns": { "servers": ["1.1.1.1", "8.8.8.8", "localhost"] }
}
JSON

cat > /etc/systemd/system/vpn-gpt-xray.service <<'EOF2'
[Unit]
Description=VPN+GPT managed Xray Reality server
After=network.target nss-lookup.target

[Service]
User=root
ExecStart=/usr/local/bin/vpn-gpt-xray run -config /etc/vpn-gpt-xray/config.json
Restart=on-failure
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF2

systemctl daemon-reload
systemctl enable vpn-gpt-xray
systemctl restart vpn-gpt-xray
sleep 2
systemctl is-active --quiet vpn-gpt-xray || { journalctl -u vpn-gpt-xray -n 80 --no-pager; fail "vpn-gpt-xray не запустился"; }

# 3x-ui больше не обязателен для работы VPN. Если установлен — просто настроим доступ к панели по возможности.
WEBPATH="/panel/"
if command -v x-ui >/dev/null 2>&1; then
  log "3x-ui найден. Пробую выставить логин/пароль/path для панели."
  x-ui setting -username "$XUI_USER" -password "$XUI_PASS" -port "$XUI_PORT" -webBasePath "$WEBPATH" || true
  systemctl restart x-ui || true
fi

jq -n \
  --arg public_ip "$PUBLIC_IP" \
  --arg xui_base_url "http://${PUBLIC_IP}:${XUI_PORT}${WEBPATH%/}" \
  --arg xui_username "$XUI_USER" \
  --arg xui_password "$XUI_PASS" \
  --arg xui_inbound_id "$INBOUND_ID" \
  --arg xui_web_base_path "$WEBPATH" \
  --arg vpn_port "$VPN_PORT" \
  --arg vpn_public_key "$PUBLIC_KEY" \
  --arg vpn_private_key "$PRIVATE_KEY" \
  --arg vpn_short_id "$SHORT_ID" \
  --arg vpn_sni "$VPN_SNI" \
  --arg vpn_display_name "$VPN_NAME" \
  --arg vpn_region "$VPN_REGION" \
  --arg white_vpn_host "$PUBLIC_IP" \
  --arg white_vpn_port "$WHITE_VPN_PORT" \
  --arg white_vpn_public_key "$WHITE_PUBLIC_KEY" \
  --arg white_vpn_private_key "$WHITE_PRIVATE_KEY" \
  --arg white_vpn_short_id "$WHITE_SHORT_ID" \
  --arg white_vpn_sni "$VPN_SNI" \
  --arg white_vpn_display_name "$WHITE_VPN_NAME" \
  --arg white_vpn_region "$WHITE_VPN_REGION" \
  --arg xray_config_path "/etc/vpn-gpt-xray/config.json" \
  --arg xray_service "vpn-gpt-xray" \
  '{public_ip:$public_ip,xui_base_url:$xui_base_url,xui_username:$xui_username,xui_password:$xui_password,xui_inbound_id:$xui_inbound_id,xui_web_base_path:$xui_web_base_path,vpn_port:$vpn_port,vpn_public_key:$vpn_public_key,vpn_private_key:$vpn_private_key,vpn_short_id:$vpn_short_id,vpn_sni:$vpn_sni,vpn_display_name:$vpn_display_name,vpn_region:$vpn_region,vpn_flow:"xtls-rprx-vision",vpn_fingerprint:"chrome",vpn_spider_x:"/",white_vpn_host:$white_vpn_host,white_vpn_port:$white_vpn_port,white_vpn_public_key:$white_vpn_public_key,white_vpn_private_key:$white_vpn_private_key,white_vpn_short_id:$white_vpn_short_id,white_vpn_sni:$white_vpn_sni,white_vpn_display_name:$white_vpn_display_name,white_vpn_region:$white_vpn_region,white_vpn_flow:"xtls-rprx-vision",white_vpn_fingerprint:"chrome",white_vpn_spider_x:"/",xray_local_enabled:"true",xray_config_path:$xray_config_path,xray_service:$xray_service}' > "$DETECTED_FILE"

if [ -f "$APP_DIR/scripts/sync-detected-settings.js" ]; then
  log "Синхронизирую настройки в сайт"
  node "$APP_DIR/scripts/sync-detected-settings.js" "$DETECTED_FILE"
fi

log "Проверка портов"
ss -tulpn | grep -E ":(${VPN_PORT}|${XUI_PORT})" || true
systemctl status vpn-gpt-xray --no-pager | head -40 || true

log "Перезапускаю сайт PM2"
pm2 restart vpn-gpt-full --update-env || pm2 start npm --name vpn-gpt-full -- start || true
pm2 save || true

cat <<EOF3

ГОТОВО. VPN теперь работает через локальный Xray, без зависимости от 3x-ui API.

Сайт сам будет добавлять клиентов в:
  /etc/vpn-gpt-xray/config.json

Параметры для Happ:
  host: ${PUBLIC_IP}
  port: ${VPN_PORT}
  public_key: ${PUBLIC_KEY}
  short_id: ${SHORT_ID}
  sni: ${VPN_SNI}

White VPN для Happ:
  host: ${PUBLIC_IP}
  port: ${WHITE_VPN_PORT}
  public_key: ${WHITE_PUBLIC_KEY}
  short_id: ${WHITE_SHORT_ID}
  sni: ${VPN_SNI}

Панель 3x-ui, если нужна:
  http://${PUBLIC_IP}:${XUI_PORT}${WEBPATH}
  login: ${XUI_USER}
  password: ${XUI_PASS}

Теперь в админке открой /admin/vds и нажми “Проверить всю настройку”, потом /admin/vpn.
EOF3
