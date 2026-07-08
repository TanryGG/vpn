# VPN + GPT Full Panel — обновленная версия

Панель с регистрацией, авторизацией, тарифами, YooMoney/CryptoBot, GPT-чатом, MySQL/MariaDB, админкой, статистикой, VLESS Reality ссылками для Happ через 3x-ui и web-обновлениями через админку.

## Быстрый запуск на Debian 12

```bash
cd /var/www
unzip vpn-gpt-full-apache-ui.zip
cd vpn-gpt-full
PROJECT_DIR=/var/www/vpn-gpt-full bash install.sh
```

После установки открой:

```text
http://IP_СЕРВЕРА/install
```

## Что нового

- более нормальный адаптивный дизайн;
- footer теперь прижат вниз и не висит высоко;
- расширенная админка: обзор, пользователи, подписки, платежи, тарифы, VPN, GPT-статистика, настройки, обновления, логи;
- страница `/admin/updates`;
- загрузка ZIP-обновления из админки;
- применение обновления с бэкапом, `npm install`, миграциями и перезапуском PM2;
- больше настроек сайта в админке: название, footer text, платежи, AI, VPN.

## Обновление через админку

1. Зайди в `/admin/updates`.
2. Загрузи новый архив `.zip`.
3. Нажми **Применить последнее загруженное обновление**.
4. Подожди 10–30 секунд и обнови страницу.

Перед применением скрипт делает бэкап в:

```text
/var/backups/vpn-gpt-full
```

Логи обновления лежат в:

```text
/var/www/vpn-gpt-updates/last-update.log
```

## Команды диагностики

```bash
pm2 status
pm2 logs vpn-gpt-full
systemctl status apache2 --no-pager
curl -I http://127.0.0.1:3000/install
```

## VPN / 3x-ui

```bash
cd /var/www/vpn-gpt-full
bash install-vpn-3xui.sh
```

Потом создай VLESS Reality inbound в 3x-ui и перенеси параметры в `/admin/settings`.

## Безопасность

Не вшивай API-ключи в код. Вводи их через `/install` или `/admin/settings`. Ключи, которые уже отправлялись в чат или публично, лучше перевыпустить.


## Объединение папок и автонастройка

Рабочая папка проекта должна быть одна: `/var/www/vpn-gpt-full`.
Если после обновлений появились вложенные папки, выполни:

```bash
cd /var/www/vpn-gpt-full
bash scripts/merge-clean-project.sh /var/www/vpn-gpt-full
```

После входа в админку открой `/admin/vds`, заполни IP/порты или оставь значения по умолчанию и нажми “Запустить полную автонастройку”.
Скрипт сгенерирует пароль 3x-ui, сохранит его в настройках сайта, попробует установить 3x-ui, создать VLESS Reality inbound и синхронизировать параметры VPN.


## AstraGate branding

В этой сборке добавлена иконка `/src/public/img/app-icon.png`, favicon и стандартное имя бренда `AstraGate`.
В Happ прямые VLESS-ссылки не гарантируют отображение кастомной картинки во всех версиях приложения: ссылка надёжно передаёт имя профиля (`AstraGate VPN` / `AstraGate White`), а параметр `icon` добавляется только если в настройках указан абсолютный URL и клиент его поддерживает.

Чтобы дать Happ шанс подтянуть иконку, в админке укажи публичный URL сайта и иконки:

- `app.url = https://твой-домен`
- `app.icon_url = https://твой-домен/img/app-icon.png`

После этого пересобери VPN-ссылки в `/admin/vpn`.
