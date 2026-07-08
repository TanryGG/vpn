# Исправление отображения сервера в Happ и проверка VPN

## Что изменено

Раньше имя профиля в Happ могло выглядеть как email, потому что в VLESS-ссылке после `#` стоял внутренний label пользователя.

Теперь:

- внутренний label для 3x-ui выглядит как `vpn-gpt-u1-xxxxxxxx`, без email;
- имя профиля в Happ берётся из настроек `vpn.display_name` + `vpn.region`;
- VLESS-ссылка содержит `encryption=none`, `spx=/` и Reality-параметры;
- в админке появился тест подключения к 3x-ui;
- в админке появилась кнопка пересборки всех VLESS-ссылок.

## Что сделать после обновления

1. Зайди в админку: `/admin/settings`.
2. В разделе `3x-ui / VPN` заполни:
   - Название в Happ: например `VPN+GPT Premium`;
   - Регион/страна: например `Germany`;
   - `vpn.host`: домен или IP VPN-сервера;
   - `vpn.port`: порт inbound, обычно `443`;
   - `vpn.public_key`: public key из Reality inbound;
   - `vpn.short_id`: short id из Reality inbound;
   - `vpn.sni`: SNI из inbound;
   - `vpn.spider_x`: обычно `/`.
3. Зайди в `/admin/vpn`.
4. Нажми `Проверить подключение`.
5. Нажми `Пересобрать все ссылки`.
6. Пользователю нужно удалить старый профиль в Happ и заново импортировать QR/ссылку.

## Если сервер не работает

Проверь на VDS:

```bash
ss -tulpn | grep ':443'
systemctl status x-ui --no-pager
x-ui
```

Если порт 443 занят Apache/Nginx, поставь inbound 3x-ui на другой порт, например 8443, и укажи этот порт в `vpn.port`.

Если VDS имеет firewall:

```bash
apt install -y ufw
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8443/tcp
ufw --force enable
```

Если используешь Cloudflare, для Reality лучше ставить `vpn.host` как прямой DNS A-record без proxy/cloud, то есть DNS only.
