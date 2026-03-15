# Развёртывание на Render (бесплатно)

Бот и мини-приложение будут на одном хостинге. Один сервис — всё сразу.

## 1. Репозиторий на GitHub

1. Создай репозиторий (например `deep-design-bot`)
2. Загрузи все файлы, **кроме** `node_modules` и `.env`
3. Обязательно добавь `welcome.png` в корень проекта

## 2. Деплой на Render

1. Зайди на [render.com](https://render.com), войди через GitHub
2. **New** → **Web Service**
3. Подключи свой репозиторий `deep-design-bot`
4. Параметры:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. В **Environment** добавь:
   - **TELEGRAM_BOT_TOKEN** — токен бота (скопируй из BotFather)
   - **OWNER_CHAT_ID** — твой ID в Telegram (чтобы заявки «Отправить на оценку» приходили тебе). Узнать ID: напиши боту @userinfobot
6. Нажми **Create Web Service**

## 3. Техработы после деплоя (бесплатно — Upstash Redis)

Чтобы режим «Техработы» (вкл/выкл кнопкой в боте) **не сбрасывался после перезагрузки и нового деплоя**, подключи бесплатный Redis в Upstash:

1. Зайди на [console.upstash.com](https://console.upstash.com) и зарегистрируйся (логин через GitHub или email).
2. **Create Database** → выбери регион (например Frankfurt), имя любое (например `deep-design`), тип **Regional**.
3. На бесплатном тарифе лимиты достаточны для одного ключа «техработы». Нажми **Create**.
4. На странице базы открой вкладку **REST API**: скопируй **UPSTASH_REDIS_REST_URL** и **UPSTASH_REDIS_REST_TOKEN**.
5. В Render у своего сервиса: **Environment** → **Add Environment Variable**:
   - **Key:** `UPSTASH_REDIS_REST_URL` → **Value:** вставь URL из Upstash.
   - **Key:** `UPSTASH_REDIS_REST_TOKEN` → **Value:** вставь токен из Upstash.
6. Сохрани — Render перезапустит сервис.

После этого состояние техработ хранится в Redis и сохраняется при любых деплоях и перезапусках. Без этих переменных техработы по-прежнему работают, но сбрасываются после деплоя.

## 4. Итог

Render выдаст URL вида `https://deep-design-bot-xxx.onrender.com`:

- **Бот** — отвечает в Telegram
- **Мини-приложение** — открывается по этому же URL (кнопка «Оформить заявку»)

Render сам задаёт `RENDER_EXTERNAL_URL`, поэтому дополнительно ничего указывать не нужно.

---

**Важно:** на бесплатном тарифе Render сервис «засыпает» после ~15 минут без запросов. Первое сообщение может обрабатываться 30–60 секунд, затем всё снова работает быстро.
