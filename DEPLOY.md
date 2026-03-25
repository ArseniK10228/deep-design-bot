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


| Действие          | Команда                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Логи бота         | `journalctl -u deepdesign-bot -f`                                                                                                |
| Статус сервиса    | `systemctl status deepdesign-bot`                                                                                                |
| Проверить webhook | `curl -s -o /dev/null -w "%{http_code}" -X POST https://app.deepdesignpc.ru/webhook -H "Content-Type: application/json" -d '{}'` |


---

## Очистить всю историю чатов

Сначала задеплойте актуальный код (`git pull` + `systemctl restart …`), иначе будет ответ `Cannot POST /api/owner-chat/clear-all` — на сервере старая версия без этого маршрута.

**Через API** (в `viewerId` должен быть тот же id, что и `OWNER_CHAT_ID` на сервере):

```bash
curl -s -X POST https://app.deepdesignpc.ru/api/owner-chat/clear-all \
  -H "Content-Type: application/json" \
  -d "{\"viewerId\":\"5105869781\"}"
```

Ожидаемый ответ: `{"ok":true}`. Если в `.env` задан `OWNER_CHAT_CLEAR_SECRET`, добавьте в JSON: `"secret":"тот_же_секрет"`.

**Только файлы** (без Redis, на сервере под пользователем бота):

```bash
cd /opt/deepdesign-bot && node scripts/clear-owner-chat.js
```

**Redis** вручную (если нет доступа к API): удалить ключи `ownerChat:threadsIndex` и `ownerChat:thread:`*.