#!/usr/bin/env bash
# Обновить сайт из GitHub и перезапустить: objekty-update
set -euo pipefail
APP=/opt/objekty
tar -czf /var/backups/objekty/data-before-update-$(date +%F-%H%M).tar.gz -C "$APP" data   # копия базы на всякий случай
git -C "$APP" pull --ff-only
systemctl restart objekty
sleep 2
echo "Обновлено до $(git -C "$APP" log --oneline -1). Ответ сайта: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5180/)"
