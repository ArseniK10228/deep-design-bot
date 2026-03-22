process.env.NTBA_FIX_350 = 'true';
require('dotenv').config();
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { WebSocketServer } = require('ws');
const Redis = require('ioredis');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('Ошибка: не задан TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

function buildTelegramBotOptions() {
  const options = { polling: false };
  const baseApiUrl = String(process.env.TELEGRAM_API_BASE_URL || '').trim();
  if (baseApiUrl) {
    options.baseApiUrl = baseApiUrl.replace(/\/$/, '');
    console.log('Telegram API base URL:', options.baseApiUrl);
    return options;
  }
  const proxyUrl = String(process.env.SOCKS5_PROXY_URL || '').trim();
  if (!proxyUrl) return options;

  try {
    const parsed = new URL(proxyUrl);
    if (!/^socks5h?:$/i.test(parsed.protocol)) {
      throw new Error('SOCKS5_PROXY_URL must start with socks5:// or socks5h://');
    }
    const agent = new SocksProxyAgent(proxyUrl);
    options.request = {
      agent,
      timeout: 60000,
      forever: false
    };
    console.log('SOCKS5 proxy enabled for Telegram API');
  } catch (e) {
    console.error('Invalid SOCKS5_PROXY_URL:', e?.message || e);
  }

  return options;
}

// Инициализируем бота до любого использования
const bot = new TelegramBot(token, buildTelegramBotOptions());

// Хранение: при REDIS_URL — Redis на вашем сервере (ioredis, протокол redis://).
// Иначе техработы и owner-chat — в файлы под PERSISTENT_DATA_PATH (presets/portfolio без Redis недоступны).
const maintenanceDir = process.env.PERSISTENT_DATA_PATH || __dirname;
const MAINTENANCE_FILE = path.join(maintenanceDir, '.maintenance');

let redisClient = null;
const redisUrl = String(process.env.REDIS_URL || '').trim();
if (redisUrl) {
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 200, 3000);
      }
    });
    redisClient.on('error', (err) => {
      console.error('Redis connection error:', err?.message || err);
    });
  } catch (e) {
    console.error('Неверный REDIS_URL:', e?.message || e);
    redisClient = null;
  }
}

async function initRedisConnection() {
  if (!redisClient) return;
  try {
    await redisClient.ping();
    console.log('Redis: подключено (REDIS_URL)');
  } catch (e) {
    console.error('Не удалось подключиться к Redis. Проверьте сервис и REDIS_URL:', e?.message || e);
    process.exit(1);
  }
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

// Прокси Telegram Web App SDK — отдаём со своего сервера (важно для РФ: telegram.org может быть недоступен)
app.get('/telegram-web-app.js', (req, res) => {
  const url = 'https://telegram.org/js/telegram-web-app.js';
  fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      res.setHeader('Content-Type', r.headers.get('content-type') || 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return r.arrayBuffer();
    })
    .then((buf) => res.send(Buffer.from(buf)))
    .catch((e) => {
      console.error('telegram-web-app.js proxy:', e?.message || e);
      res.status(502).send('/* Proxy error */');
    });
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  })
);

// ----- WebSocket для чата владельца -----
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/owner-chat' });

// ws подписчики на список диалогов (владелец)
const ownerChatThreadSubscribers = new Set();

// ws подписчики на сообщения конкретного диалога (conversationUserId = id пользователя)
const ownerChatMessageSubscribersByConversationUserId = new Map(); // conversationUserId -> Set<ws>

function getOwnerId() {
  return process.env.OWNER_CHAT_ID ? String(process.env.OWNER_CHAT_ID) : '';
}

function getOrCreateMessageSubSet(conversationUserId) {
  const key = String(conversationUserId);
  let set = ownerChatMessageSubscribersByConversationUserId.get(key);
  if (!set) {
    set = new Set();
    ownerChatMessageSubscribersByConversationUserId.set(key, set);
  }
  return set;
}

function removeWsFromAllSubscriptions(ws) {
  ownerChatThreadSubscribers.delete(ws);

  for (const [convId, set] of ownerChatMessageSubscribersByConversationUserId.entries()) {
    if (set.has(ws)) {
      set.delete(ws);
      if (set.size === 0) ownerChatMessageSubscribersByConversationUserId.delete(convId);
    }
  }
}

function wsBroadcastThreads(threads) {
  const payload = JSON.stringify({ type: 'threads', threads: Array.isArray(threads) ? threads : [] });
  for (const ws of ownerChatThreadSubscribers) {
    if (ws.readyState !== ws.OPEN) continue;
    try { ws.send(payload); } catch (_) {}
  }
}

function wsBroadcastMessages(conversationUserId, messages) {
  const convId = String(conversationUserId);
  const set = ownerChatMessageSubscribersByConversationUserId.get(convId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify({ type: 'messages', conversationUserId: convId, messages: Array.isArray(messages) ? messages : [] });
  for (const ws of set) {
    if (ws.readyState !== ws.OPEN) continue;
    try { ws.send(payload); } catch (_) {}
  }
}

wss.on('connection', (ws, req) => {
  // viewerId приходит из мини-приложения (из tg.initDataUnsafe.user.id)
  const url = new URL(req.url, 'http://localhost');
  const viewerIdFromQuery = url.searchParams.get('viewerId') != null ? String(url.searchParams.get('viewerId')) : '';
  const ownerId = getOwnerId();

  ws._ownerChat = {
    viewerId: viewerIdFromQuery,
    subscribedThreads: false,
    subscribedConversationUserId: null
  };

  ws.on('message', (raw) => {
    let msg = null;
    try { msg = JSON.parse(raw.toString()); } catch (_) {}
    if (!msg || !msg.type) return;

    const ownerChat = ws._ownerChat;
    if (!ownerChat) return;

    // Для простоты доверяем viewerId из query и игнорируем “подстановки” в payload.
    // (HTTP-эндпойнты в проекте тоже опираются на viewerId от фронта.)
    const viewerId = ownerChat.viewerId;
    const payloadViewerId = msg.viewerId != null ? String(msg.viewerId) : '';
    if (payloadViewerId && payloadViewerId !== viewerId) return;

    if (msg.type === 'subscribeThreads') {
      if (!ownerId || !viewerId || viewerId !== ownerId) return;
      ownerChat.subscribedThreads = true;
      ownerChatThreadSubscribers.add(ws);
      return;
    }

    if (msg.type === 'unsubscribeThreads') {
      ownerChat.subscribedThreads = false;
      ownerChatThreadSubscribers.delete(ws);
      return;
    }

    if (msg.type === 'subscribeMessages') {
      const conversationUserId = msg.conversationUserId != null ? String(msg.conversationUserId) : '';
      if (!conversationUserId) return;

      const isOwnerViewer = ownerId && viewerId && viewerId === ownerId;
      if (!isOwnerViewer && conversationUserId !== viewerId) return;

      // перезаписываем подписку (один диалог на сокет)
      if (ownerChat.subscribedConversationUserId) {
        const prevSet = ownerChatMessageSubscribersByConversationUserId.get(String(ownerChat.subscribedConversationUserId));
        if (prevSet) {
          prevSet.delete(ws);
          if (prevSet.size === 0) ownerChatMessageSubscribersByConversationUserId.delete(String(ownerChat.subscribedConversationUserId));
        }
      }

      ownerChat.subscribedConversationUserId = conversationUserId;
      getOrCreateMessageSubSet(conversationUserId).add(ws);
      return;
    }

    if (msg.type === 'unsubscribeMessages') {
      if (ownerChat.subscribedConversationUserId) {
        const prevConvId = String(ownerChat.subscribedConversationUserId);
        const prevSet = ownerChatMessageSubscribersByConversationUserId.get(prevConvId);
        if (prevSet) {
          prevSet.delete(ws);
          if (prevSet.size === 0) ownerChatMessageSubscribersByConversationUserId.delete(prevConvId);
        }
      }
      ownerChat.subscribedConversationUserId = null;
      return;
    }
  });

  ws.on('close', () => {
    removeWsFromAllSubscriptions(ws);
  });
});

app.all('/api/load-report', (req, res) => {
  const q = req.query || {};
  const total = q.t || q.total;
  const toScript = q.s || q.toScript;
  const toReady = q.r || q.toReady;
  const toInit = q.i || q.toInit;
  if (total != null) {
    console.log('[LOAD-REPORT] total:', total, 'ms | toScript:', toScript, 'ms | toReady:', toReady, 'ms | toInit:', toInit, 'ms');
  }
  res.status(204).end();
});

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
    const isUpgrade = requestType === 'upgrade';
    const taskLabel = isComponents
      ? 'Список комплектующих'
      : isUpgrade
        ? 'Что улучшить'
        : 'Задачи и бюджет';
    const subtitle = isComponents
      ? 'Сборка (список комплектующих)'
      : isUpgrade
        ? 'Апгрейд ПК'
        : 'Сборка (соберём вместе)';

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

// ----- Встроенный чат владельца -----
// Идея: храним отдельную переписку для каждого пользователя (thread),
// где владельцу показываются все диалоги, а пользователю — только свой.

const ownerChatDataDir = path.join(maintenanceDir, 'owner-chat');
const OWNER_CHAT_INDEX_FILE = path.join(ownerChatDataDir, 'threadsIndex.json');

function ownerChatThreadKey(conversationUserId) {
  return `ownerChat:thread:${conversationUserId}`;
}

function safeTruncate(str, maxLen) {
  const s = String(str || '');
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

async function getOwnerChatThreadsIndex() {
  if (redisClient) {
    try {
      const raw = await redisClient.get('ownerChat:threadsIndex');
      if (!raw) return {};
      if (typeof raw === 'object') return raw;
      return JSON.parse(raw);
    } catch (e) {
      console.error('Owner chat threadsIndex get error:', e?.message || e);
      return {};
    }
  }

  try {
    if (!fs.existsSync(ownerChatDataDir)) return {};
    const raw = fs.readFileSync(OWNER_CHAT_INDEX_FILE, 'utf8');
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

async function saveOwnerChatThreadsIndex(indexObj) {
  const safeIndex = indexObj && typeof indexObj === 'object' ? indexObj : {};
  if (redisClient) {
    try {
      await redisClient.set('ownerChat:threadsIndex', JSON.stringify(safeIndex));
    } catch (e) {
      console.error('Owner chat threadsIndex save error:', e?.message || e);
    }
    return;
  }

  try {
    fs.mkdirSync(ownerChatDataDir, { recursive: true });
    fs.writeFileSync(OWNER_CHAT_INDEX_FILE, JSON.stringify(safeIndex), 'utf8');
  } catch (e) {
    console.error('Owner chat threadsIndex file save error:', e?.message || e);
  }
}

async function getOwnerChatThread(conversationUserId) {
  const key = ownerChatThreadKey(conversationUserId);
  if (redisClient) {
    try {
      const raw = await redisClient.get(key);
      if (!raw) return [];
      if (Array.isArray(raw)) return raw;
      return JSON.parse(raw);
    } catch (e) {
      console.error('Owner chat thread get error:', e?.message || e);
      return [];
    }
  }

  try {
    if (!fs.existsSync(ownerChatDataDir)) return [];
    const file = path.join(ownerChatDataDir, `thread_${conversationUserId}.json`);
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function saveOwnerChatThread(conversationUserId, messages) {
  const key = ownerChatThreadKey(conversationUserId);
  const list = Array.isArray(messages) ? messages : [];
  if (redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(list));
    } catch (e) {
      console.error('Owner chat thread save error:', e?.message || e);
    }
    return;
  }

  try {
    fs.mkdirSync(ownerChatDataDir, { recursive: true });
    const file = path.join(ownerChatDataDir, `thread_${conversationUserId}.json`);
    fs.writeFileSync(file, JSON.stringify(list), 'utf8');
  } catch (e) {
    console.error('Owner chat thread file save error:', e?.message || e);
  }
}

app.get('/api/owner-chat/threads', async (req, res) => {
  try {
    const ownerId = process.env.OWNER_CHAT_ID;
    const viewerId = req.query.viewerId != null ? String(req.query.viewerId) : '';

    if (!ownerId || !viewerId || String(ownerId) !== String(viewerId)) {
      return res.status(403).json({ ok: false, threads: [] });
    }

    const indexObj = await getOwnerChatThreadsIndex();
    const threads = Object.values(indexObj || {});
    threads.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    res.json({ ok: true, threads });
  } catch (e) {
    console.error('Owner chat threads error:', e?.message || e);
    res.status(500).json({ ok: false });
  }
});

app.get('/api/owner-chat/messages', async (req, res) => {
  try {
    const ownerId = process.env.OWNER_CHAT_ID;
    const viewerId = req.query.viewerId != null ? String(req.query.viewerId) : '';
    const conversationUserId = req.query.conversationUserId != null ? String(req.query.conversationUserId) : '';
    const sinceId = req.query.sinceId != null ? Number(req.query.sinceId) : 0;

    if (!viewerId || !conversationUserId) {
      return res.status(400).json({ ok: false, messages: [] });
    }

    const isOwnerViewer = ownerId && String(ownerId) === String(viewerId);
    if (!isOwnerViewer && String(conversationUserId) !== String(viewerId)) {
      return res.status(403).json({ ok: false, messages: [] });
    }

    const thread = await getOwnerChatThread(conversationUserId);
    const messages = Array.isArray(thread)
      ? thread.filter((m) => m && m.id != null && Number(m.id) > sinceId)
      : [];

    res.json({ ok: true, messages });
  } catch (e) {
    console.error('Owner chat messages error:', e?.message || e);
    res.status(500).json({ ok: false, messages: [] });
  }
});

app.post('/api/owner-chat/send', async (req, res) => {
  try {
    const ownerId = process.env.OWNER_CHAT_ID;
    const maintenanceOn = getMaintenanceFlag();

    const viewerId = req.body && req.body.viewerId != null ? String(req.body.viewerId) : '';
    const toUserId = req.body && req.body.toUserId != null ? String(req.body.toUserId) : '';
    const username = req.body && req.body.username != null ? String(req.body.username) : '';
    const textRaw = req.body && req.body.text != null ? String(req.body.text) : '';
    const text = textRaw.trim();

    if (!ownerId || !viewerId) {
      return res.status(400).json({ ok: false });
    }
    if (maintenanceOn && String(viewerId) !== String(ownerId)) {
      return res.status(423).json({ ok: false });
    }

    if (!text || text.length < 1 || text.length > 1000) {
      return res.status(400).json({ ok: false });
    }

    const isOwnerSender = String(viewerId) === String(ownerId);
    let fromRole = isOwnerSender ? 'owner' : 'user';
    let conversationUserId = isOwnerSender ? toUserId : viewerId;

    if (!conversationUserId || !String(conversationUserId)) {
      return res.status(400).json({ ok: false });
    }
    if (String(conversationUserId) === String(ownerId)) {
      // диалог владельца с самим собой не нужен
      return res.status(400).json({ ok: false });
    }

    if (!isOwnerSender && String(toUserId) && String(toUserId) !== String(viewerId)) {
      // пользователь не может отправлять сообщение "в чужой" диалог
      return res.status(403).json({ ok: false });
    }

    const now = Date.now();
    const id = now * 1000 + Math.floor(Math.random() * 1000);
    const usernameClean = username ? username.replace(/^@/, '') : '';
    const fromUsername = usernameClean ? '@' + usernameClean : '';
    const message = {
      id,
      conversationUserId,
      fromUserId: viewerId,
      fromRole,
      text,
      createdAt: now,
      fromUsername
    };

    const thread = await getOwnerChatThread(conversationUserId);
    thread.push(message);
    const trimmed = thread.slice(-200);
    await saveOwnerChatThread(conversationUserId, trimmed);

    // Обновляем список диалогов владельца (последнее сообщение)
    const indexObj = await getOwnerChatThreadsIndex();
    const prev = indexObj[conversationUserId] || {};
    const threadUsername = fromRole === 'user' ? fromUsername : (prev.username || '');
    indexObj[conversationUserId] = {
      conversationUserId,
      username: threadUsername,
      lastText: safeTruncate(text, 120),
      lastAt: now,
      lastFromRole: fromRole,
      lastFromUserId: viewerId,
      lastFromUsername: usernameClean ? usernameClean : ''
    };
    await saveOwnerChatThreadsIndex(indexObj);

    // WebSocket push: мгновенно обновляем активный диалог и превью диалогов владельца.
    try {
      wsBroadcastMessages(conversationUserId, [message]);
      const threads = Object.values(indexObj || {});
      threads.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
      wsBroadcastThreads(threads);
    } catch (e) {
      console.error('Owner chat WS broadcast error:', e?.message || e);
    }

    // Сигнал в Telegram (чтобы владелец видел сообщения и вне WebApp)
    const safeSender = usernameClean ? '@' + usernameClean : 'Пользователь';
    if (fromRole === 'user') {
      await bot.sendMessage(ownerId, `💬 Новое сообщение от ${safeSender}:\n${text}`);
    } else {
      await bot.sendMessage(conversationUserId, `🖥 Ответ владельца:\n${text}`);
    }

    res.json({ ok: true, message });
  } catch (e) {
    console.error('Owner chat send error:', e?.message || e);
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
  // Всегда делаем URL уникальным при каждом открытии, иначе Telegram/браузер кэширует старую версию.
  const bustPrefix = process.env.WEBAPP_CACHE_BUST ? String(process.env.WEBAPP_CACHE_BUST) + '-' : '';
  const cacheBust = bustPrefix + Date.now().toString();
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
  await initRedisConnection();
  await initMaintenanceStorage();
  if (redisClient) console.log('Данные приложения: Redis (техработы, чат, пресеты, портфолио)');
  if (baseUrl) {
    const webhookPath = '/webhook';
    app.post(webhookPath, (req, res) => {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });
    server.listen(PORT, async () => {
      const webhookUrl = `${baseUrl.replace(/\/$/, '')}${webhookPath}`;
      await bot.setWebHook(webhookUrl);
      console.log('Webhook:', webhookUrl);
      console.log('Сервер:', PORT);
    });
  } else {
    bot.startPolling();
    server.listen(PORT, () => {
      console.log('Polling. Порт:', PORT);
    });
  }
}

start().catch((err) => {
  console.error('Start error:', err?.message || err);
  process.exit(1);
});
