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

// Инициализируем бота до любого использования
const bot = new TelegramBot(token, { polling: false });

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
    const {
      tasks,
      requestType,
      userId,
      username_form: usernameForm,
      username_tg: usernameTg,
      firstName
    } = req.body || {};

    const ownerId = process.env.OWNER_CHAT_ID;
    const tasksText = (tasks || '').trim() || '(не указано)';
    const isComponents = requestType === 'components';
    const taskLabel = isComponents ? 'Список комплектующих' : 'Список';
    const subtitle = isComponents ? 'Сборка (список комплектующих)' : 'Сборка (список)';

    // Логируем для отладки, что реально приходит с фронта
    console.log('Build request body:', req.body);

    const safeFormUsername = usernameForm
      ? '@' + escapeMarkdownV1(String(usernameForm).replace(/^@/, ''))
      : 'не указан';

    const safeProgramUsername = usernameTg
      ? '@' + escapeMarkdownV1(String(usernameTg).replace(/^@/, ''))
      : 'не удалось определить';

    const ownerMsg = `🖥 *Новая заявка: ${subtitle}*\n\n` +
      `*${taskLabel}:*\n${tasksText}\n\n` +
      `*Юзернейм из формы:*\n${safeFormUsername}\n\n` +
      `*От кого отправлено (Telegram):*\n${safeProgramUsername}`;

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

bot.on('callback_query', async (query) => {
  try {
    const data = query.data;
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;

    if (!data || !chatId) return;

    if (data === 'my_orders' || data === 'check_status') {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, 'Эта функция пока в разработке.');
      return;
    }

    // на всякий случай подтверждаем остальные колбэки
    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error('Callback error:', err?.message || err);
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
