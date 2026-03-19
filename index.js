process.env.NTBA_FIX_350 = 'true';
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { Redis } = require('@upstash/redis');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('Ошибка: не задан TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

// Инициализируем бота до любого использования
const bot = new TelegramBot(token, { polling: false });

// Хранение флага техработ: при наличии UPSTASH_REDIS_* — в Redis (сохраняется после деплоя),
// иначе в файл (сбрасывается при деплое).
const maintenanceDir = process.env.PERSISTENT_DATA_PATH || __dirname;
const MAINTENANCE_FILE = path.join(maintenanceDir, '.maintenance');

let redisClient = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    enableTelemetry: false
  });
}

let maintenanceCache = false;

async function initMaintenanceStorage() {
  if (redisClient) {
    try {
      const v = await redisClient.get('maintenance');
      maintenanceCache = v === 'true' || v === true;
    } catch (e) {
      console.error('Redis init maintenance:', e?.message || e);
    }
  } else {
    try {
      maintenanceCache = fs.readFileSync(MAINTENANCE_FILE, 'utf8').trim() === 'true';
    } catch (_) {}
  }
}

function getMaintenanceFlag() {
  return maintenanceCache;
}

async function setMaintenanceFlag(value) {
  maintenanceCache = !!value;
  if (redisClient) {
    try {
      await redisClient.set('maintenance', value ? 'true' : 'false');
    } catch (e) {
      console.error('Redis set maintenance:', e?.message || e);
    }
  } else {
    try {
      fs.mkdirSync(maintenanceDir, { recursive: true });
      fs.writeFileSync(MAINTENANCE_FILE, value ? 'true' : 'false', 'utf8');
    } catch (_) {}
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  const maintenanceOn = getMaintenanceFlag();
  const ownerId = process.env.OWNER_CHAT_ID;
  const userId = req.query.user_id != null ? String(req.query.user_id) : null;
  const isOwner = ownerId && userId && String(ownerId) === userId;
  const maintenance = maintenanceOn && !isOwner;
  res.json({ status: 'ok', maintenance });
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
      username_tg: usernameTg
    } = req.body || {};

    const ownerId = process.env.OWNER_CHAT_ID;
    const tasksText = (tasks || '').trim() || '(не указано)';
    const isComponents = requestType === 'components';
    const taskLabel = isComponents ? 'Список комплектующих' : 'Задачи и бюджет';
    const subtitle = isComponents ? 'Сборка (список комплектующих)' : 'Сборка (соберём вместе)';

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

// ----- Готовые сборки (presets) -----
// Храним массив предложений в Redis под ключом "presets".
// Каждый элемент: { id, title, price, image, description, createdAt }

async function getPresets() {
  if (!redisClient) return [];
  try {
    const raw = await redisClient.get('presets');
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return JSON.parse(raw);
  } catch (e) {
    console.error('Redis get presets:', e?.message || e);
    return [];
  }
}

async function savePresets(list) {
  if (!redisClient) return;
  try {
    await redisClient.set('presets', JSON.stringify(list));
  } catch (e) {
    console.error('Redis set presets:', e?.message || e);
  }
}

app.get('/api/presets', async (req, res) => {
  try {
    const list = await getPresets();
    res.json({ ok: true, items: list });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

app.post('/api/presets', async (req, res) => {
  try {
    const ownerId = process.env.OWNER_CHAT_ID;
    const { userId, title, price, image, images, description } = req.body || {};
    if (!ownerId || !userId || String(ownerId) !== String(userId)) {
      return res.status(403).json({ ok: false });
    }
    const safeTitle = String(title || '').trim();
    if (!safeTitle) {
      return res.status(400).json({ ok: false });
    }
    const list = await getPresets();
    const now = Date.now();
    const imagesArr = Array.isArray(images) && images.length > 0
      ? images.map((img) => String(img || '').trim()).filter(Boolean)
      : (image ? [String(image).trim()] : []);
    const mainImage = imagesArr[0] || String(image || '').trim();
    const item = {
      id: String(now),
      title: safeTitle,
      price: String(price || '').trim(),
      image: mainImage,
      images: imagesArr,
      description: String(description || '').trim(),
      createdAt: now
    };
    list.unshift(item);
    await savePresets(list);
    res.json({ ok: true, item });
  } catch (e) {
    console.error('Presets add error:', e?.message || e);
    res.status(500).json({ ok: false });
  }
});

app.post('/api/presets/update', async (req, res) => {
  try {
    const ownerId = process.env.OWNER_CHAT_ID;
    const { userId, id, title, price, image, images, description } = req.body || {};
    if (!ownerId || !userId || String(ownerId) !== String(userId)) {
      return res.status(403).json({ ok: false });
    }
    const cur = await getPresets();
    const idx = cur.findIndex((item) => String(item.id) === String(id));
    if (idx === -1) {
      return res.status(404).json({ ok: false });
    }
    if (title !== undefined) cur[idx].title = String(title || '').trim();
    if (price !== undefined) cur[idx].price = String(price || '').trim();
    if (image !== undefined) cur[idx].image = String(image || '').trim();
    if (images !== undefined) {
      const arr = Array.isArray(images) ? images.map((img) => String(img || '').trim()).filter(Boolean) : [];
      cur[idx].images = arr;
      cur[idx].image = arr.length > 0 ? arr[0] : '';
    }
    if (description !== undefined) cur[idx].description = String(description || '').trim();
    await savePresets(cur);
    res.json({ ok: true, item: cur[idx] });
  } catch (e) {
    console.error('Presets update error:', e?.message || e);
    res.status(500).json({ ok: false });
  }
});

app.post('/api/presets/delete', async (req, res) => {
  try {
    const ownerId = process.env.OWNER_CHAT_ID;
    const { userId, id } = req.body || {};
    if (!ownerId || !userId || String(ownerId) !== String(userId)) {
      return res.status(403).json({ ok: false });
    }
    const cur = await getPresets();
    const next = cur.filter((item) => String(item.id) !== String(id));
    await savePresets(next);
    res.json({ ok: true });
  } catch (e) {
    console.error('Presets delete error:', e?.message || e);
    res.status(500).json({ ok: false });
  }
});

// ----- Портфолио -----
// Храним массив работ в Redis под ключом "portfolio".
// Каждый элемент: { id, title, image, images, description, createdAt }

async function getPortfolio() {
  if (!redisClient) return [];
  try {
    const raw = await redisClient.get('portfolio');
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return JSON.parse(raw);
  } catch (e) {
    console.error('Redis get portfolio:', e?.message || e);
    return [];
  }
}

async function savePortfolio(list) {
  if (!redisClient) return;
  try {
    await redisClient.set('portfolio', JSON.stringify(list));
  } catch (e) {
    console.error('Redis set portfolio:', e?.message || e);
  }
}

app.get('/api/portfolio', async (req, res) => {
  try {
    const list = await getPortfolio();
    res.json({ ok: true, items: list });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

app.post('/api/portfolio', async (req, res) => {
  try {
    const ownerId = process.env.OWNER_CHAT_ID;
    const { userId, title, images, description } = req.body || {};
    if (!ownerId || !userId || String(ownerId) !== String(userId)) {
      return res.status(403).json({ ok: false });
    }
    const safeTitle = String(title || '').trim();
    if (!safeTitle) {
      return res.status(400).json({ ok: false });
    }
    const list = await getPortfolio();
    const now = Date.now();
    const imagesArr = Array.isArray(images) && images.length > 0
      ? images.map((img) => String(img || '').trim()).filter(Boolean)
      : [];
    const mainImage = imagesArr[0] || '';
    const item = {
      id: String(now),
      title: safeTitle,
      image: mainImage,
      images: imagesArr,
      description: String(description || '').trim(),
      createdAt: now
    };
    list.unshift(item);
    await savePortfolio(list);
    res.json({ ok: true, item });
  } catch (e) {
    console.error('Portfolio add error:', e?.message || e);
    res.status(500).json({ ok: false });
  }
});

app.post('/api/portfolio/update', async (req, res) => {
  try {
    const ownerId = process.env.OWNER_CHAT_ID;
    const { userId, id, title, images, description } = req.body || {};
    if (!ownerId || !userId || String(ownerId) !== String(userId)) {
      return res.status(403).json({ ok: false });
    }
    const cur = await getPortfolio();
    const idx = cur.findIndex((item) => String(item.id) === String(id));
    if (idx === -1) return res.status(404).json({ ok: false });
    if (title !== undefined) cur[idx].title = String(title || '').trim();
    if (description !== undefined) cur[idx].description = String(description || '').trim();
    if (images !== undefined) {
      const arr = Array.isArray(images) ? images.map((img) => String(img || '').trim()).filter(Boolean) : [];
      cur[idx].images = arr;
      cur[idx].image = arr.length > 0 ? arr[0] : '';
    }
    await savePortfolio(cur);
    res.json({ ok: true, item: cur[idx] });
  } catch (e) {
    console.error('Portfolio update error:', e?.message || e);
    res.status(500).json({ ok: false });
  }
});

app.post('/api/portfolio/delete', async (req, res) => {
  try {
    const ownerId = process.env.OWNER_CHAT_ID;
    const { userId, id } = req.body || {};
    if (!ownerId || !userId || String(ownerId) !== String(userId)) {
      return res.status(403).json({ ok: false });
    }
    const cur = await getPortfolio();
    const next = cur.filter((item) => String(item.id) !== String(id));
    await savePortfolio(next);
    res.json({ ok: true });
  } catch (e) {
    console.error('Portfolio delete error:', e?.message || e);
    res.status(500).json({ ok: false });
  }
});

let welcomePhotoFileId = null;

function buildStartKeyboard(chatId, fullWebAppUrl) {
  const ownerId = process.env.OWNER_CHAT_ID;
  const isOwner = ownerId && String(chatId) === String(ownerId);
  const maintenanceOn = getMaintenanceFlag();
  return {
    inline_keyboard: [
      [{ text: 'Оформить заявку', web_app: { url: fullWebAppUrl } }],
      [{ text: 'Мои заказы', callback_data: 'my_orders' }],
      [{ text: 'Проверить статус', callback_data: 'check_status' }],
      ...(isOwner ? [[{ text: maintenanceOn ? '🔧 Техработы: ВКЛ' : '🔧 Техработы: ВЫКЛ', callback_data: 'maintenance_toggle' }]] : [])
    ]
  };
}

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

  const replyMarkup = buildStartKeyboard(chatId, fullWebAppUrl);

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

bot.onText(/\/maintenance/i, async (msg) => {
  const ownerId = process.env.OWNER_CHAT_ID;
  if (!ownerId || String(msg.from?.id) !== String(ownerId)) return;
  try {
    const on = getMaintenanceFlag();
    const text = on
      ? '🔧 *Режим техработ включён*\nПользователи видят экран «Технические работы». Нажмите кнопку, чтобы выключить.'
      : '🔧 *Режим техработ выключен*\nНажмите кнопку, чтобы включить — тогда у всех будет показываться «Технические работы».';
    const buttonText = on ? '✅ Выключить техработы' : '⚠️ Включить техработы';
    await bot.sendMessage(msg.chat.id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: buttonText, callback_data: 'maintenance_toggle' }]] }
    });
  } catch (err) {
    console.error('Maintenance command error:', err?.message || err);
  }
});

bot.on('callback_query', async (query) => {
  try {
    const data = query.data;
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    const ownerId = process.env.OWNER_CHAT_ID;

    if (!data || !chatId) return;

    if (data === 'maintenance_toggle') {
      if (!ownerId || String(query.from?.id) !== String(ownerId)) {
        await bot.answerCallbackQuery(query.id, { text: 'Только владелец бота может переключать.' });
        return;
      }
      const wasOn = getMaintenanceFlag();
      await setMaintenanceFlag(!wasOn);
      const nowOn = getMaintenanceFlag();
      await bot.answerCallbackQuery(query.id, { text: nowOn ? 'Техработы включены' : 'Техработы выключены' });
      const isPhotoMessage = query.message?.photo && query.message.photo.length > 0;
      if (isPhotoMessage) {
        const baseUrl = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || 'https://example.com';
        const webAppUrl = baseUrl.replace(/\/$/, '');
        const fullWebAppUrl = `${webAppUrl}${webAppUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
        const newMarkup = buildStartKeyboard(chatId, fullWebAppUrl);
        await bot.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: messageId });
      } else {
        const buttonText = nowOn ? '🔧 Техработы: ВКЛ' : '🔧 Техработы: ВЫКЛ';
        const newMarkup = { inline_keyboard: [[{ text: buttonText, callback_data: 'maintenance_toggle' }]] };
        const text = nowOn
          ? '🔧 *Режим техработ включён*\nПользователи видят экран «Технические работы». Нажмите кнопку, чтобы выключить.'
          : '🔧 *Режим техработ выключен*\nНажмите кнопку, чтобы включить.';
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: newMarkup
        });
      }
      return;
    }

    if (data === 'my_orders' || data === 'check_status') {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, 'Эта функция пока в разработке.');
      return;
    }

    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error('Callback error:', err?.message || err);
  }
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));

const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;

async function start() {
  await initMaintenanceStorage();
  if (redisClient) console.log('Техработы: хранение в Redis (сохраняется после деплоя)');
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
}

start().catch((err) => {
  console.error('Start error:', err?.message || err);
  process.exit(1);
});
