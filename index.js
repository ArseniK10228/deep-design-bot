process.env.NTBA_FIX_350 = 'true';
require('dotenv').config();
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('Ошибка: не задан TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

function escapeMarkdownV1(text) {
  return String(text || '').replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

app.post('/api/build-request', async (req, res) => {
  try {
    const { tasks, userId, username, firstName } = req.body || {};
    const ownerId = process.env.OWNER_CHAT_ID;
    const tasksText = (tasks || '').trim() || '(не указано)';

    // Лёгкое логирование для отладки, почему иногда нет username/id
    console.log('Build request body:', req.body);

    let resolvedUsername = username;
    let resolvedFirstName = firstName;

    // Если id есть, но username не пришёл с фронта — пробуем достать из Telegram API
    if (userId && !resolvedUsername) {
      try {
        const chat = await bot.getChat(userId);
        if (chat) {
          resolvedUsername = chat.username || resolvedUsername;
          resolvedFirstName = chat.first_name || resolvedFirstName;
        }
      } catch (e) {
        console.error('getChat error:', e?.message || e);
      }
    }

    const safeFirstName = escapeMarkdownV1(resolvedFirstName || 'Пользователь');
    const safeUsername = resolvedUsername ? ' @' + escapeMarkdownV1(resolvedUsername) : '';
    const safeId = escapeMarkdownV1(userId);

    const ownerMsg = `🖥 *Новая заявка: Сборка (подберём вместе)*\n\n` +
      `*Задачи:*\n${tasksText}\n\n` +
      `От: ${safeFirstName}${safeUsername} (ID: \`${safeId}\`)`;

    if (ownerId) {
      await bot.sendMessage(ownerId, ownerMsg, { parse_mode: 'Markdown' });
    }

    if (userId) {
      await bot.sendMessage(userId, '✅ Заявка отправлена! Менеджер свяжется с вами в ближайшее время.');
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Build request error:', err?.message || err);
    res.status(500).json({ ok: false });
  }
});

const bot = new TelegramBot(token, { polling: false });

let welcomePhotoFileId = null;

async function handleStart(chatId) {
  const baseUrl = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || 'https://example.com';
  const webAppUrl = baseUrl.replace(/\/$/, '');
  const cacheBust = process.env.WEBAPP_CACHE_BUST || Date.now().toString();
  const fullWebAppUrl = `${webAppUrl}${webAppUrl.includes('?') ? '&' : '?'}v=${cacheBust}`;

  try {
    const INVISIBLE = '\u200B';
    const m = await bot.sendMessage(chatId, INVISIBLE, {
      reply_markup: { remove_keyboard: true },
      disable_notification: true
    });
    bot.deleteMessage(chatId, m.message_id).catch(() => {});
  } catch (_) {}

  const replyMarkup = {
    inline_keyboard: [
      [{ text: 'Оформить заявку', web_app: { url: fullWebAppUrl } }],
      [{ text: 'Мои заказы', callback_data: 'my_orders' }],
      [{ text: 'Проверить статус', callback_data: 'check_status' }]
    ]
  };

  const text = '*Deep Design PC*\n\nСборка, апгрейд и консультации.\nНажмите «Оформить заявку».';

  const welcomeImagePath = path.join(__dirname, 'welcome.png');
  const photo = welcomePhotoFileId || welcomeImagePath;

  const sent = await bot.sendPhoto(chatId, photo, {
    caption: text,
    reply_markup: replyMarkup,
    parse_mode: 'Markdown'
  });

  try {
    const sizes = sent?.photo;
    if (Array.isArray(sizes) && sizes.length > 0) {
      welcomePhotoFileId = sizes[sizes.length - 1].file_id;
    }
  } catch (_) {}
}

bot.onText(/\/start|\/menu/i, async (msg) => {
  try {
    await handleStart(msg.chat.id);
  } catch (err) {
    console.error('Start error:', err?.message || err);
  }
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));

const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;

if (baseUrl) {
  const webhookPath = '/webhook';
  app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  app.listen(PORT, async () => {
    const webhookUrl = `${baseUrl.replace(/\/$/, '')}${webhookPath}`;
    await bot.setWebHook(webhookUrl);
    console.log('Webhook:', webhookUrl);
    console.log('Сервер:', PORT);
  });
} else {
  bot.startPolling();
  app.listen(PORT, () => {
    console.log('Polling. Порт:', PORT);
  });
}
