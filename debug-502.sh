#!/bin/bash
# Отладка 502 — выполните на VPS

echo "=== 1. Проверка доступа к Render ==="
curl -sI -o /dev/null -w "HTTP: %{http_code}\nTime: %{time_total}s\n" --connect-timeout 15 https://deep-design-bot.onrender.com/

echo ""
echo "=== 2. Последние ошибки nginx ==="
tail -20 /var/log/nginx/error.log

echo ""
echo "=== 3. Проверка с Host: deep-design-bot.onrender.com ==="
curl -sI -o /dev/null -w "HTTP: %{http_code}\n" -H "Host: deep-design-bot.onrender.com" https://deep-design-bot.onrender.com/

echo ""
echo "=== 4. Проверка с Host: app.deepdesignpc.ru ==="
curl -sI -o /dev/null -w "HTTP: %{http_code}\n" -H "Host: app.deepdesignpc.ru" https://deep-design-bot.onrender.com/
