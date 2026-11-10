#!/usr/bin/env bash
# Установка «Объекты» на чистый Ubuntu 24.04 (запускать от root один раз).
#   bash setup.sh [домен]
# Без домена сайт откроется по IP (http). С доменом — сразу HTTPS через Let's Encrypt.
set -euo pipefail
DOMAIN="${1:-}"
APP=/opt/objekty
REPO=https://github.com/kutcollcenter-oss/-.git
PORT=5180

echo "== Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx ufw ca-certificates
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "== Пользователь и код"
id objekty >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin objekty
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone --depth 1 "$REPO" "$APP"; fi
mkdir -p "$APP/data" /var/backups/objekty
chown -R objekty:objekty "$APP/data"

echo "== Служба (автозапуск, перезапуск при сбое)"
cat > /etc/systemd/system/objekty.service <<EOF
[Unit]
Description=Objekty site
After=network.target

[Service]
User=objekty
WorkingDirectory=$APP
Environment=PORT=$PORT
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $APP/serve.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now objekty
systemctl restart objekty

echo "== nginx: сжатие, кэш, чат без буферизации, загрузка фото до 20 МБ"
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/objekty <<EOF
server {
  listen 80;
  server_name $SERVER_NAME;
  client_max_body_size 20m;
  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml text/plain;
  gzip_min_length 1024;

  location ~ ^/api/(guest|staff)/stream {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
  }
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF
ln -sf /etc/nginx/sites-available/objekty /etc/nginx/sites-enabled/objekty
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "== Брандмауэр: только SSH, HTTP, HTTPS"
ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable >/dev/null

echo "== Ежедневная копия базы (чаты, сотрудники, расчёты, фото), хранится 30 дней"
cat > /etc/cron.daily/objekty-backup <<EOF
#!/bin/sh
tar -czf /var/backups/objekty/data-\$(date +%F).tar.gz -C $APP data
find /var/backups/objekty -name 'data-*.tar.gz' -mtime +30 -delete
EOF
chmod +x /etc/cron.daily/objekty-backup

echo "== Команда обновления: objekty-update"
install -m 755 "$APP/deploy/update.sh" /usr/local/bin/objekty-update

if [ -n "$DOMAIN" ]; then
  echo "== HTTPS для $DOMAIN"
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
fi

sleep 2
echo
echo "Готово. Проверка: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/)"
[ -f "$APP/data/admin-password.txt" ] && echo "Пароль администратора: $APP/data/admin-password.txt — смените его после входа."
