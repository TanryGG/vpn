Чистый архив Astragate.

В архиве оставлена одна основная папка: astragate.
Из старого архива убраны папки .saved, .broken, .old, pre-hard-reset и node_modules.
Исправлено: маршрут /telegram-proxy подключён до 404, чтобы страница Telegram Proxy открывалась.

Быстрая установка на VDS:
1) Загрузить astragate_clean_full.tar.gz на сервер в /root/
2) Выполнить:
   cd /var/www && tar -xzf /root/astragate_clean_full.tar.gz && SITE_HOST=astragate.su WANT_SSL=N bash /var/www/astragate/ONE_COMMAND_INSTALL.sh

Если домен уже направлен на VDS и нужен HTTPS:
   cd /var/www && tar -xzf /root/astragate_clean_full.tar.gz && SITE_HOST=astragate.su WANT_SSL=Y bash /var/www/astragate/ONE_COMMAND_INSTALL.sh

Скрипт сам:
- создаёт бэкап старых папок в /root/astragate-before-cleanup-ДАТА.tar.gz
- удаляет лишние старые папки astragate/vpn-gpt с /var/www
- ставит Node.js, PM2, Apache, MariaDB/MySQL, dante-server
- разворачивает проект в /var/www/vpn-gpt-full
- запускает миграции и seed
- запускает сайт через PM2
- настраивает Apache reverse proxy
- настраивает SOCKS5 Telegram Proxy на порту 8445
