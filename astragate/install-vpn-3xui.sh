#!/usr/bin/env bash
set -e
if [ "$EUID" -ne 0 ]; then echo "Запусти от root"; exit 1; fi
apt update && apt install -y curl socat
bash <(curl -Ls https://raw.githubusercontent.com/MHSanaei/3x-ui/master/install.sh)
echo "Открой x-ui меню командой: x-ui"
echo "Создай VLESS Reality inbound и перенеси public_key, short_id, inbound_id в админку сайта: /admin/settings"
