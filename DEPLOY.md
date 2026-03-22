# Деплой изменений

Краткая памятка по обновлению бота на VPS.

---

## 1. Локально (на вашем компьютере)

```bash
cd c:\Users\Arsen\Project\Test

git add .
git commit -m "Update"
git push origin main
```

---

## 2. На сервере (SSH)

```bash
ssh root@84.22.148.125
```

```bash
cd /opt/deepdesign-bot
```

```bash
su - deepbot -c "cd /opt/deepdesign-bot && git pull && npm ci"
```

```bash
systemctl restart deepdesign-bot
```

```bash
systemctl status deepdesign-bot   # проверить, что запустилось
```

---

## Одной строкой (на сервере)

```bash
cd /opt/deepdesign-bot && su - deepbot -c "cd /opt/deepdesign-bot && git pull && npm ci" && systemctl restart deepdesign-bot
```

---

## Если изменился только код (без package.json)

```bash
cd /opt/deepdesign-bot
su - deepbot -c "cd /opt/deepdesign-bot && git pull"
systemctl restart deepdesign-bot
```

---

## Полезные команды

| Действие              | Команда                                      |
|-----------------------|----------------------------------------------|
| Логи бота             | `journalctl -u deepdesign-bot -f`            |
| Статус сервиса        | `systemctl status deepdesign-bot`            |
| Проверить webhook     | `curl -s -o /dev/null -w "%{http_code}" -X POST https://app.deepdesignpc.ru/webhook -H "Content-Type: application/json" -d '{}'` |
