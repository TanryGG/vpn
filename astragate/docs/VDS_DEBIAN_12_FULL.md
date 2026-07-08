# Установка на Debian 12 через Apache

## 1. Загрузка и запуск

```bash
apt update && apt install -y unzip curl rsync
unzip vpn-gpt-full-apache.zip && cd vpn-gpt-full
bash install.sh
```

На вопрос `Домен сайта или IP` можно нажать Enter. Тогда сайт откроется по IP.

На вопрос про HTTPS отвечай `N`, если нет домена или DNS ещё не настроен.

## 2. Открыть установщик

```text
http://IP_СЕРВЕРА/install
```

Создай админа и внеси основные ключи.

## 3. Если была ошибка Nginx

Ошибка вида:

```text
Errors were encountered while processing:
 nginx
 python3-certbot-nginx
 E: Sub-process /usr/bin/dpkg returned an error code (1)
```

Решение:

```bash
cd vpn-gpt-full
bash repair-apache.sh
```

Этот скрипт:

- делает `dpkg --configure -a`;
- делает `apt-get -f install`;
- останавливает и удаляет Nginx;
- удаляет `python3-certbot-nginx`;
- ставит Apache;
- включает `proxy`, `proxy_http`, `headers`, `rewrite`, `ssl`;
- настраивает reverse proxy на Node.js порт 3000.

## 4. Проверка

```bash
pm2 status
pm2 logs vpn-gpt-full
curl -I http://127.0.0.1:3000/install
curl -I http://127.0.0.1/install
systemctl status apache2 --no-pager
```

## 5. HTTPS после DNS

Когда домен уже указывает на IP:

```bash
certbot --apache -d example.com -d www.example.com
```

## 6. Firewall

У провайдера VDS должны быть открыты:

- 80/tcp для HTTP;
- 443/tcp для HTTPS и VLESS Reality, если используешь 443;
- порт панели 3x-ui, если нужен внешний доступ.

## 7. Где лежит сайт

```text
/var/www/vpn-gpt-full
```

`.env` создаётся автоматически и содержит доступ к базе. Права ставятся `600`.
