(function(){
  var t0=(typeof performance!=='undefined'&&performance.timing)?performance.timing.navigationStart:window.__loadStart||Date.now();
  window.__diag={t0:t0,t1:Date.now(),t2:null,t3:null};
  var t=window.Telegram&&window.Telegram.WebApp;if(t)try{t.ready();window.__diag.t2=Date.now();}catch(e){}
})();
// На некоторых устройствах Telegram внедряет WebApp с задержкой — читаем актуально при каждом обращении.
function getTg() {
  try {
    return (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  } catch (_) { return null; }
}
let tg = getTg();
let currentUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;
const isOwnerApp = !!currentUser && currentUser.username === 'ShadowwOneLove';
if (tg) {
  try { tg.expand(); tg.MainButton.hide(); tg.ready(); } catch (_) {}
}
// Ждём появления Telegram до 5 сек (на части устройств API внедряется с задержкой)
(function waitForTelegram() {
  if (tg) return;
  var attempts = 0;
  var id = setInterval(function() {
    tg = getTg();
    if (tg) {
      clearInterval(id);
      currentUser = tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;
      try { tg.expand(); tg.MainButton.hide(); tg.ready(); } catch (_) {}
      return;
    }
    attempts++;
    if (attempts >= 50) clearInterval(id);
  }, 100);
})();

// Откладываем тяжёлую инициализацию на следующий тик — даём браузеру отрисовать страницу
setTimeout(function preloadProfile() {
  try {
    updateProfileView();
    var runAvatar = function () {
      try { preloadProfileAvatar(); } catch (_) {}
    };
    if (window.requestIdleCallback) {
      window.requestIdleCallback(runAvatar, { timeout: 3000 });
    } else {
      setTimeout(runAvatar, 800);
    }
  } catch (_) {}
}, 0);

setTimeout(function checkMaintenance() {
  var overlay = document.getElementById('maintenance-overlay');
  var cardEl = document.getElementById('maintenance-card');
  var titleEl = document.getElementById('maintenance-title');
  var subtitleEl = document.getElementById('maintenance-subtitle');
  var appEl = document.querySelector('.app');
  function setMaintenance(show) {
    if (!overlay) return;
    if (show) {
      overlay.classList.remove('maintenance-overlay-hidden');
      if (cardEl) cardEl.classList.add('maintenance-mode-active');
      if (titleEl) titleEl.textContent = 'Технические работы';
      if (subtitleEl) subtitleEl.textContent = 'Улучшаем сервис. Скоро вернёмся.';
    } else {
      overlay.classList.add('maintenance-overlay-hidden');
      if (cardEl) cardEl.classList.remove('maintenance-mode-active');
      if (appEl) appEl.classList.remove('app-hidden-until-ready');
    }
  }
  function getUserId() {
    var tg = window.Telegram && window.Telegram.WebApp;
    return (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) || '';
  }
  var pollInterval = 1000;
  function poll() {
    var uid = getUserId();
    var url = '/health' + (uid ? '?user_id=' + encodeURIComponent(uid) : '');
    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      setMaintenance(!!data.maintenance);
      setTimeout(poll, pollInterval);
    }).catch(function() {
      setMaintenance(false);
      setTimeout(poll, pollInterval);
    });
  }
  if (window.location.protocol !== 'file:') poll();
}, 0);

document.getElementById('view-main').addEventListener('animationend', function handler() {
  this.removeEventListener('animationend', handler);
  this.classList.remove('view-enter');
}, { once: true });

/** Поднятие области ввода чата вместе с клавиатурой (Visual Viewport API + Telegram viewport). */
let keyboardInsetPrev = 0;

function syncChatKeyboardInset() {
  const root = document.documentElement;
  const app = document.querySelector('.app');
  if (!app || !app.classList.contains('app--chat-open')) {
    root.style.setProperty('--keyboard-inset', '0px');
    keyboardInsetPrev = 0;
    return;
  }
  const vv = window.visualViewport;
  if (!vv) {
    root.style.setProperty('--keyboard-inset', '0px');
    keyboardInsetPrev = 0;
    return;
  }
  const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  root.style.setProperty('--keyboard-inset', inset + 'px');

  /* К последнему сообщению: при появлении клавиатуры — плавно (в т.ч. если листали историю); пока inset растёт — мгновенно, чтобы не отставать от анимации. */
  if (inset > 0) {
    if (keyboardInsetPrev === 0) {
      scrollOwnerChatToBottomSmooth();
    } else if (inset > keyboardInsetPrev) {
      scrollOwnerChatToBottom();
    }
  }
  keyboardInsetPrev = inset;
}

let chatKeyboardInsetRaf = null;
function scheduleChatKeyboardInset() {
  if (chatKeyboardInsetRaf != null) return;
  chatKeyboardInsetRaf = requestAnimationFrame(function () {
    chatKeyboardInsetRaf = null;
    syncChatKeyboardInset();
  });
}

(function initChatKeyboardViewportListeners() {
  function sched() {
    scheduleChatKeyboardInset();
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', sched, { passive: true });
    window.visualViewport.addEventListener('scroll', sched, { passive: true });
  }
  window.addEventListener('resize', sched, { passive: true });
  window.addEventListener('orientationchange', function () {
    setTimeout(sched, 120);
    setTimeout(sched, 400);
  });
  try {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg && typeof tg.onEvent === 'function') {
      tg.onEvent('viewportChanged', sched);
    }
  } catch (_) {}
})();

function showView(viewId, direction) {
  const views = document.querySelectorAll('.view');
  const target = document.getElementById(viewId);
  const current = document.querySelector('.view-active');
  if (!target || !current || target === current) return;

  const appRoot = document.querySelector('.app');
  if (appRoot) appRoot.classList.toggle('app--chat-open', viewId === 'view-consult');
  if (document.documentElement) {
    document.documentElement.classList.toggle('html--chat-open', viewId === 'view-consult');
  }
  scheduleChatKeyboardInset();

  const tabbar = document.querySelector('.app-tabbar');
  // Нижняя панель не показывается на "Готовые сборки", чтобы экран выглядел как карточка-страница.
  const tabbarViews = ['view-main', 'view-owner-presets', 'view-portfolio', 'view-profile'];
  if (tabbar) {
    const shouldShow = tabbarViews.indexOf(viewId) !== -1;
    tabbar.classList.toggle('app-tabbar-hidden', !shouldShow);
  }

  let leaveClass = 'view-leaving';
  let enterClass = 'view-enter';
  if (direction === 'right') {
    leaveClass = 'view-leave-left';
    enterClass = 'view-enter-right';
  } else if (direction === 'left') {
    leaveClass = 'view-leave-right';
    enterClass = 'view-enter-left';
  }

  current.classList.add(leaveClass);
  current.addEventListener('animationend', function handler() {
    current.removeEventListener('animationend', handler);
    current.classList.remove('view-active', 'view-leaving', 'view-leave-left', 'view-leave-right');
    target.classList.add('view-active', enterClass);
    if (viewId === 'view-consult') {
      try { initOwnerChatThread(); } catch (_) {}
    } else if (viewId === 'view-owner-chat-list') {
      try { initOwnerChatList(); } catch (_) {}
    } else {
      try { stopOwnerChatPolling(); } catch (_) {}
    }
    target.addEventListener('animationend', function h() {
      target.removeEventListener('animationend', h);
      target.classList.remove('view-enter', 'view-enter-right', 'view-enter-left');
    }, { once: true });
  }, { once: true });
}

let isUpgradeMode = false;

function sendActionToBot(action, label) {
  var t = getTg();
  if (!t) {
    // Не блокируем взаимодействие модальным alert: просто показываем баннер.
    try {
      var el = document.getElementById('telegram-required-banner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'telegram-required-banner';
        el.className = 'alert-banner';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.style.position = 'fixed';
        el.style.top = '12px';
        el.style.left = '0';
        el.style.right = '0';
        el.style.zIndex = '10000';
        el.style.margin = '0 16px';
        document.body.appendChild(el);
      }
      el.textContent = 'Откройте мини‑приложение внутри Telegram — без Telegram часть функций недоступна.';
      el.classList.add('alert-banner-visible');
    } catch (_) {}
    // Дальше продолжаем навигацию по локальным экранам.
  }

  if (action === 'consult') {
    // Для пользователей возвращаемся на главный экран
    const backBtn = document.querySelector('#view-consult .back-btn');
    if (backBtn) backBtn.dataset.backTo = 'view-main';

    // Для владельца при входе в "Консультация" должно быть пусто:
    // сбрасываем выбранный диалог, чтобы initOwnerChatThread показал пустое состояние.
    if (isOwnerApp) {
      ownerChatActiveConversationUserId = null;
      ownerChatSelectedDisplayName = '';
      try { clearOwnerChatMessages(); } catch (_) {}
      if (ownerChatMessagesEl) ownerChatMessagesEl.style.display = 'none';
      if (ownerChatComposerEl) ownerChatComposerEl.style.display = 'none';
      if (ownerChatSubtitleEl) ownerChatSubtitleEl.textContent = '';
    }
    showView('view-consult');
    return;
  }

  if (action === 'build') {
    showView('view-build');
    return;
  }

  if (action === 'build_no') {
    isUpgradeMode = false;
    var labelEl = document.querySelector('#view-build-no .form-label');
    var textareaEl = document.getElementById('build-tasks');
    var titleEl = document.querySelector('#view-build-no .page-title');
    var subtitleEl = document.querySelector('#view-build-no .page-subtitle');
    var priceLabelEl = document.querySelector('#view-build-no .form-price-label');
    var priceValueEl = document.querySelector('#view-build-no .form-price-value');
    if (labelEl) labelEl.textContent = 'ЗАДАЧИ И БЮДЖЕТ';
    if (textareaEl && !textareaEl.value) {
      textareaEl.placeholder = 'ПК для игр, бюджет 30000 RUB...';
    }
    if (titleEl) titleEl.textContent = 'Сборка ПК';
    if (subtitleEl) subtitleEl.textContent = 'Опишите задачи';
    if (priceLabelEl) priceLabelEl.textContent = 'Сборка';
    if (priceValueEl) priceValueEl.textContent = 'от 1500 RUB';
    showView('view-build-no');
    return;
  }

  if (action === 'build_yes') {
    showView('view-build-yes');
    return;
  }

  if (action === 'presets') {
    showView('view-presets');
    loadPublicPresets();
    return;
  }

  if (action === 'owner_presets_menu') {
    showView('view-owner-presets-ready', 'right');
    return;
  }

  if (action === 'owner_portfolio_menu') {
    showView('view-owner-portfolio', 'right');
    return;
  }

  if (action === 'owner_chat_menu') {
    showView('view-owner-chat-list', 'right');
    return;
  }

  if (action === 'portfolio_create') {
    portfolioDraft = { title: '', description: '', images: [] };
    var pt = document.getElementById('portfolio-step-title');
    var pd = document.getElementById('portfolio-step-desc');
    var pi = document.getElementById('portfolio-step-image');
    if (pt) pt.value = '';
    if (pd) pd.value = '';
    if (pi) pi.value = '';
    showView('view-portfolio-create-1', 'right');
    return;
  }

  if (action === 'portfolio_edit') {
    showView('view-owner-portfolio-edit', 'right');
    loadOwnerEditPortfolio();
    return;
  }

  if (action === 'owner_create') {
    createDraft = { title: '', description: '', price: '', avitoLink: '', image: '', images: [] };
    var t = document.getElementById('create-step-title');
    var d = document.getElementById('create-step-desc');
    var p = document.getElementById('create-step-price');
    var a = document.getElementById('create-step-avito');
    var i = document.getElementById('create-step-image');
    if (t) t.value = '';
    if (d) d.value = '';
    if (p) p.value = '';
    if (a) a.value = '';
    if (i) i.value = '';
    showView('view-owner-create-1');
    return;
  }

  if (action === 'owner_edit') {
    showView('view-owner-edit');
    loadOwnerEditPresets();
    return;
  }

  if (action === 'upgrade') {
    isUpgradeMode = true;
    var upLabelEl = document.querySelector('#view-build-no .form-label');
    var upTextareaEl = document.getElementById('build-tasks');
    var upTitleEl = document.querySelector('#view-build-no .page-title');
    var upSubtitleEl = document.querySelector('#view-build-no .page-subtitle');
    var upPriceLabelEl = document.querySelector('#view-build-no .form-price-label');
    var upPriceValueEl = document.querySelector('#view-build-no .form-price-value');
    if (upLabelEl) upLabelEl.textContent = 'ЧТО ХОТИТЕ УЛУЧШИТЬ';
    if (upTextareaEl && !upTextareaEl.value) {
      upTextareaEl.placeholder = 'Улучшить GPU, добавить ОЗУ...';
    }
    if (upTitleEl) upTitleEl.textContent = 'Апгрейд ПК';
    if (upSubtitleEl) upSubtitleEl.textContent = 'Опишите, что нужно улучшить';
    if (upPriceLabelEl) upPriceLabelEl.textContent = 'Замена комплектующих';
    if (upPriceValueEl) upPriceValueEl.textContent = 'от 800 RUB';
    showView('view-build-no');
    return;
  }

  if (!action) {
    return;
  }

  const payload = { action, label };
  if (t && typeof t.sendData === 'function') t.sendData(JSON.stringify(payload));
}

document.querySelectorAll('.back-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    let target = btn.dataset.backTo || 'view-main';
    // В режиме апгрейда возвращаемся сразу на главный экран
    if (isUpgradeMode && target === 'view-build') {
      target = 'view-main';
      isUpgradeMode = false;
    }
    showView(target);
    const tabbar = document.querySelector('.app-tabbar');
    if (tabbar && (target === 'view-main' || target === 'view-presets' || target === 'view-portfolio' || target === 'view-profile' || target === 'view-owner-presets')) {
      tabbar.classList.remove('app-tabbar-hidden');
    }
  });
});

// Нижние вкладки
const tabOrder = document.getElementById('tab-order');
const tabPortfolio = document.getElementById('tab-portfolio');
const tabProfile = document.getElementById('tab-profile');
const tabOwner = document.getElementById('tab-owner');
const allTabs = [tabOrder, tabPortfolio, tabProfile, tabOwner];

function setActiveTab(tab) {
  allTabs.forEach(function (t) {
    if (!t) return;
    if (t === tab) t.classList.add('tabbar-item-active');
    else t.classList.remove('tabbar-item-active');
  });
}

if (tabOrder) {
  tabOrder.addEventListener('click', () => {
    const current = document.querySelector('.view-active');
    const dir = current && (current.id === 'view-owner-presets' || current.id === 'view-presets' || current.id === 'view-portfolio') ? 'left' : undefined;
    setActiveTab(tabOrder);
    showView('view-main', dir);
  });
}

if (tabPortfolio) {
  tabPortfolio.addEventListener('click', () => {
    const current = document.querySelector('.view-active');
    const dir =
      current && (current.id === 'view-owner-presets' || current.id === 'view-owner-presets-ready' || current.id === 'view-owner-portfolio') ? 'left'
      : current && current.id === 'view-profile' ? 'left'
      : (current && current.id === 'view-main' ? 'right' : undefined);
    setActiveTab(tabPortfolio);
    showView('view-portfolio', dir);
    loadPublicPortfolio();
  });
}

if (tabProfile) {
  tabProfile.addEventListener('click', () => {
    const current = document.querySelector('.view-active');
    const dir =
      current && (current.id === 'view-owner-presets' || current.id === 'view-owner-presets-ready' || current.id === 'view-owner-portfolio') ? 'left'
      : (current && (current.id === 'view-main' || current.id === 'view-portfolio') ? 'right' : undefined);
    setActiveTab(tabProfile);
    showView('view-profile', dir);
    updateProfileView();
  });
}

if (tabOwner) {
  if (isOwnerApp) {
    tabOwner.style.display = 'flex';
    tabOwner.addEventListener('click', () => {
      setActiveTab(tabOwner);
      showView('view-owner-presets', 'right');
    });
  } else {
    tabOwner.style.display = 'none';
  }
}

// ----- Owner chat (in-app messenger) -----
const ownerChatThreadsEl = document.getElementById('owner-chat-thread-list');
const ownerChatMessagesEl = document.getElementById('owner-chat-messages');
const ownerChatComposerEl = document.getElementById('owner-chat-composer');
const ownerChatInputEl = document.getElementById('owner-chat-input');
const ownerChatSendBtn = document.getElementById('owner-chat-send-btn');
const ownerChatSubtitleEl = document.getElementById('owner-chat-thread-subtitle');
const ownerChatListSubtitleEl = document.getElementById('owner-chat-list-subtitle');

const viewerId = currentUser && currentUser.id != null ? String(currentUser.id) : null;
const viewerUsername = currentUser && currentUser.username ? String(currentUser.username) : '';

let ownerChatActiveConversationUserId = null; // which user we are chatting with (for owner) or current user (for user)
let ownerChatLastSeenId = 0;
let ownerChatPollTimer = null;
let ownerChatIsSending = false;

// ----- WebSocket для чата (без polling) -----
let ownerChatWs = null;
let ownerChatWsActive = false;
let ownerChatWsSubscribedThreads = false;
let ownerChatWsSubscribedConversationUserId = null;
let ownerChatWsReconnectTimer = null;
let ownerChatWsRetry = 0;

function ownerChatWsUrl() {
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return wsProto + '//' + location.host + '/ws/owner-chat?viewerId=' + encodeURIComponent(viewerId || '');
}

function ownerChatWsSend(payload) {
  if (!ownerChatWs || ownerChatWs.readyState !== 1) return;
  try { ownerChatWs.send(JSON.stringify(payload)); } catch (_) {}
}

function ownerChatWsApplySubscriptions() {
  if (ownerChatWsSubscribedThreads) {
    ownerChatWsSend({ type: 'subscribeThreads', viewerId });
  }
  if (ownerChatWsSubscribedConversationUserId) {
    ownerChatWsSend({
      type: 'subscribeMessages',
      viewerId,
      conversationUserId: ownerChatWsSubscribedConversationUserId
    });
  }
}

function ownerChatWsEnsure() {
  if (!ownerChatWsActive) return;
  if (ownerChatWs && ownerChatWs.readyState === 1) return;

  if (ownerChatWsReconnectTimer) clearTimeout(ownerChatWsReconnectTimer);
  ownerChatWsReconnectTimer = null;

  try {
    ownerChatWs = new WebSocket(ownerChatWsUrl());
  } catch (_) {
    ownerChatWs = null;
    return;
  }

  ownerChatWs.onopen = function () {
    ownerChatWsRetry = 0;
    ownerChatWsApplySubscriptions();
  };

  ownerChatWs.onmessage = function (ev) {
    let data = null;
    try { data = JSON.parse(ev.data); } catch (_) { data = null; }
    if (!data || !data.type) return;

    if (data.type === 'threads') {
      if (!isOwnerApp) return;
      if (!ownerChatWsSubscribedThreads) return;
      if (Array.isArray(data.threads)) renderOwnerChatThreads(data.threads);
      return;
    }

    if (data.type === 'messages') {
      if (!ownerChatWsSubscribedConversationUserId) return;
      const convId = data.conversationUserId != null ? String(data.conversationUserId) : '';
      if (String(convId) !== String(ownerChatWsSubscribedConversationUserId)) return;
      if (!Array.isArray(data.messages) || data.messages.length === 0) return;

      const last = data.messages[data.messages.length - 1];
      if (last && last.id != null) ownerChatLastSeenId = Number(last.id || ownerChatLastSeenId);
      appendOwnerChatMessages(data.messages);
    }
  };

  ownerChatWs.onclose = function () {
    ownerChatWs = null;
    if (!ownerChatWsActive) return;
    ownerChatWsRetry++;
    var delay = Math.min(5000, 500 * ownerChatWsRetry);
    ownerChatWsReconnectTimer = setTimeout(ownerChatWsEnsure, delay);
  };

  ownerChatWs.onerror = function () {
    try { ownerChatWs.close(); } catch (_) {}
  };
}

function stopOwnerChatPolling() {
  if (ownerChatPollTimer) {
    clearInterval(ownerChatPollTimer);
    ownerChatPollTimer = null;
  }

  ownerChatWsActive = false;
  ownerChatWsSubscribedThreads = false;
  ownerChatWsSubscribedConversationUserId = null;
  ownerChatPollTimer = null;

  if (ownerChatWsReconnectTimer) clearTimeout(ownerChatWsReconnectTimer);
  ownerChatWsReconnectTimer = null;

  if (ownerChatWs) {
    try { ownerChatWs.close(); } catch (_) {}
    ownerChatWs = null;
  }
}

function formatOwnerChatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function scrollOwnerChatToBottom() {
  if (!ownerChatMessagesEl) return;
  ownerChatMessagesEl.scrollTop = ownerChatMessagesEl.scrollHeight;
}

/** Плавная прокрутка (rAF + ease-out): в Telegram WebView часто не работает scrollTo({ behavior: 'smooth' }). */
let chatSmoothScrollRaf = null;
function scrollOwnerChatToBottomSmooth() {
  const el = ownerChatMessagesEl;
  if (!el) return;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.scrollTop = el.scrollHeight;
    return;
  }
  if (chatSmoothScrollRaf) cancelAnimationFrame(chatSmoothScrollRaf);
  const start = el.scrollTop;
  const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const dur = 420;
  const ease = function (t) {
    return 1 - Math.pow(1 - t, 3);
  };
  function frame(now) {
    const target = Math.max(0, el.scrollHeight - el.clientHeight);
    const u = Math.min(1, (now - t0) / dur);
    el.scrollTop = start + (target - start) * ease(u);
    if (u < 1) {
      chatSmoothScrollRaf = requestAnimationFrame(frame);
    } else {
      chatSmoothScrollRaf = null;
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    }
  }
  chatSmoothScrollRaf = requestAnimationFrame(frame);
}

function clearOwnerChatMessages() {
  if (!ownerChatMessagesEl) return;
  ownerChatMessagesEl.innerHTML = '';
}

function appendOwnerChatMessages(messages, options) {
  if (!ownerChatMessagesEl) return;
  const animateIn = !options || options.animate !== false;
  const meId = viewerId ? String(viewerId) : '';

  messages.forEach((m, idx) => {
    const msgId = m && m.id != null ? Number(m.id) : null;
    if (msgId == null) return;

    // Защита от дублей: если это сообщение уже отрисовано — пропускаем.
    if (ownerChatMessagesEl.querySelector('.chat-msg-row[data-msg-id="' + msgId + '"]')) return;

    const isMe = meId && String(m.fromUserId) === meId;

    const fromUsernameClean = m.fromUsername && String(m.fromUsername).trim()
      ? String(m.fromUsername).trim().replace(/^@/, '')
      : '';

    const displayName = isMe
      ? (m.fromRole === 'owner' ? 'Вы' : (fromUsernameClean || 'Вы'))
      : (fromUsernameClean || (m.fromRole === 'owner' ? 'Владелец' : 'Пользователь'));

    const initials = (function () {
      const s = String(fromUsernameClean || displayName || '').trim();
      if (!s) return '?';
      const parts = s.split(/\s+/);
      const first = (parts[0] && parts[0][0]) ? parts[0][0] : s[0];
      const last = (parts.length > 1 && parts[parts.length - 1][0]) ? parts[parts.length - 1][0] : (s.length > 1 ? s[1] : '');
      return (first + last).toUpperCase();
    })();

    const row = document.createElement('div');
    row.className = isMe ? 'chat-msg-row chat-msg-row-me' : 'chat-msg-row chat-msg-row-them';
    row.setAttribute('data-msg-id', String(msgId));

    if (!isMe) {
      const avatar = document.createElement('div');
      avatar.className = 'chat-avatar';
      avatar.textContent = initials;
      row.appendChild(avatar);
    }

    const contentCol = document.createElement('div');
    contentCol.className = 'chat-msg-col';

    const meta = document.createElement('div');
    meta.className = 'chat-msg-meta';

    const nameEl = document.createElement('div');
    nameEl.className = 'chat-msg-name';
    nameEl.textContent = displayName;

    const timeEl = document.createElement('div');
    timeEl.className = 'chat-msg-time';
    timeEl.textContent = m.createdAt ? formatOwnerChatTime(m.createdAt) : '';

    meta.appendChild(nameEl);
    meta.appendChild(timeEl);

    const bubble = document.createElement('div');
    bubble.className = isMe ? 'chat-bubble chat-bubble-me' : 'chat-bubble chat-bubble-them';

    const text = document.createElement('div');
    text.className = 'chat-bubble-text';
    text.textContent = String(m.text || '');

    bubble.appendChild(text);
    contentCol.appendChild(meta);
    contentCol.appendChild(bubble);
    row.appendChild(contentCol);

    if (animateIn) {
      row.classList.add('chat-msg-row--animate-in');
      row.style.animationDelay = Math.min(idx, 8) * 0.035 + 's';
    }

    ownerChatMessagesEl.appendChild(row);
  });

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (animateIn) scrollOwnerChatToBottomSmooth();
      else scrollOwnerChatToBottom();
    });
  });
}

function renderOwnerChatThreads(threads) {
  if (!ownerChatThreadsEl) return;
  ownerChatThreadsEl.innerHTML = '';

  if (!Array.isArray(threads) || threads.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-thread-empty';
    empty.textContent = 'Пока нет сообщений от пользователей.';
    ownerChatThreadsEl.appendChild(empty);
    return;
  }

  threads.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-thread-item';
    btn.setAttribute('data-conversation-user-id', String(t.conversationUserId));

    const isActive = ownerChatActiveConversationUserId && String(t.conversationUserId) === String(ownerChatActiveConversationUserId);
    if (isActive) btn.classList.add('chat-thread-item-active');

    const usernameClean = t.username && String(t.username).trim() ? String(t.username).trim().replace(/^@/, '') : '';
    const displayName = usernameClean || 'Пользователь';

    const initials = (function () {
      const s = String(usernameClean || displayName).trim();
      if (!s) return '?';
      const parts = s.split(/\s+/);
      const first = (parts[0] && parts[0][0]) ? parts[0][0] : s[0];
      const last = (parts.length > 1 && parts[parts.length - 1][0]) ? parts[parts.length - 1][0] : (s.length > 1 ? s[1] : '');
      return (first + last).toUpperCase();
    })();

    const avatar = document.createElement('div');
    avatar.className = 'chat-thread-avatar';
    avatar.textContent = initials;

    const contentCol = document.createElement('div');
    contentCol.className = 'chat-thread-content';

    const meta = document.createElement('div');
    meta.className = 'chat-thread-meta';

    const nameEl = document.createElement('div');
    nameEl.className = 'chat-thread-name';
    nameEl.textContent = displayName;

    const timeEl = document.createElement('div');
    timeEl.className = 'chat-thread-time';
    timeEl.textContent = t.lastAt ? formatOwnerChatTime(t.lastAt) : '';

    meta.appendChild(nameEl);
    meta.appendChild(timeEl);

    const bubble = document.createElement('div');
    bubble.className = 'chat-thread-bubble';
    const previewText = t.lastText && String(t.lastText).trim() ? String(t.lastText).trim() : '';
    bubble.textContent = previewText;

    // В цвете ориентируемся по тому, кто отправил последнее сообщение
    // (если последнее сообщение от владельца — выделяем “как своё”).
    if (String(t.lastFromRole || '') === 'owner') bubble.classList.add('chat-thread-bubble-me');
    else bubble.classList.add('chat-thread-bubble-them');

    contentCol.appendChild(meta);
    contentCol.appendChild(bubble);

    btn.appendChild(avatar);
    btn.appendChild(contentCol);

    btn.addEventListener('click', () => {
      ownerChatActiveConversationUserId = String(t.conversationUserId);
      ownerChatSelectedDisplayName = displayName;
      ownerChatLastSeenId = 0;
      if (ownerChatSubtitleEl) ownerChatSubtitleEl.textContent = `Диалог с ${displayName}`;
      clearOwnerChatMessages();
      renderOwnerChatThreads(threads);
      showView('view-consult', 'right');
    });

    ownerChatThreadsEl.appendChild(btn);
  });
}

async function apiFetchJSON(url, options) {
  const r = await fetch(url, options);
  return r.json();
}

async function loadOwnerChatThreads() {
  if (!isOwnerApp || !viewerId) return [];
  const data = await apiFetchJSON(
    `/api/owner-chat/threads?viewerId=${encodeURIComponent(viewerId)}`,
    { method: 'GET' }
  ).catch(() => null);

  if (!data || !data.ok) return [];
  return Array.isArray(data.threads) ? data.threads : [];
}

async function loadOwnerChatMessages({ reset } = { reset: false }) {
  if (!viewerId || !ownerChatActiveConversationUserId) return;
  if (!ownerChatMessagesEl) return;

  if (reset) {
    ownerChatLastSeenId = 0;
    clearOwnerChatMessages();
  }

  const sinceId = ownerChatLastSeenId ? Number(ownerChatLastSeenId) : 0;
  const data = await apiFetchJSON(
    `/api/owner-chat/messages?viewerId=${encodeURIComponent(viewerId)}&conversationUserId=${encodeURIComponent(ownerChatActiveConversationUserId)}&sinceId=${encodeURIComponent(String(sinceId))}`,
    { method: 'GET' }
  ).catch(() => null);

  if (!data || !data.ok || !Array.isArray(data.messages)) return;

  if (data.messages.length === 0) return;

  ownerChatLastSeenId = Number(data.messages[data.messages.length - 1].id || sinceId);
  /* Первая подгрузка истории — без анимации; догрузка новых (reset: false) — с анимацией. */
  appendOwnerChatMessages(data.messages, { animate: !reset });
}

let ownerChatSelectedDisplayName = '';

async function initOwnerChatList() {
  if (!getTg()) return;
  if (!isOwnerApp) return;
  if (!viewerId) return;

  stopOwnerChatPolling();
  ownerChatLastSeenId = 0;
  ownerChatActiveConversationUserId = null;
  ownerChatSelectedDisplayName = '';
  clearOwnerChatMessages();

  if (ownerChatMessagesEl) ownerChatMessagesEl.style.display = 'none';
  if (ownerChatComposerEl) ownerChatComposerEl.style.display = 'none';
  if (ownerChatListSubtitleEl) ownerChatListSubtitleEl.textContent = 'Выберите пользователя';

  if (ownerChatThreadsEl) ownerChatThreadsEl.style.display = 'block';

  const threads = await loadOwnerChatThreads();
  renderOwnerChatThreads(threads);

  // Подписываемся на обновления списка диалогов (только владелец).
  ownerChatWsActive = true;
  ownerChatWsSubscribedThreads = true;
  ownerChatWsSubscribedConversationUserId = null;
  ownerChatWsEnsure();
}

async function initOwnerChatThread() {
  if (!getTg()) return;
  if (!viewerId) return;

  if (ownerChatInputEl) {
    ownerChatInputEl.placeholder = isOwnerApp ? 'Ответ владельца...' : 'Сообщение владельцу...';
  }

  if (!ownerChatSubtitleEl) return;

  // Кнопка "Назад" должна вести:
  // - у владельца: в список чатов
  // - у пользователей: на главную
  const backBtn = document.querySelector('#view-consult .back-btn');
  if (backBtn) {
    // Если перед входом в consult уже выставили `view-main` (например, при нажатии "Консультация"),
    // не перетираем — это гарантирует нужное поведение для владельца.
    if (isOwnerApp) {
      if (backBtn.dataset.backTo !== 'view-main') backBtn.dataset.backTo = 'view-owner-chat-list';
    } else {
      backBtn.dataset.backTo = 'view-main';
    }
  }

  stopOwnerChatPolling();
  ownerChatLastSeenId = 0;
  clearOwnerChatMessages();

  if (ownerChatMessagesEl) ownerChatMessagesEl.style.display = '';
  if (ownerChatComposerEl) ownerChatComposerEl.style.display = '';

  if (isOwnerApp) {
    if (!ownerChatActiveConversationUserId) {
      if (ownerChatMessagesEl) ownerChatMessagesEl.style.display = 'none';
      if (ownerChatComposerEl) ownerChatComposerEl.style.display = 'none';
      ownerChatSubtitleEl.textContent = '';
      return;
    }

    if (ownerChatSelectedDisplayName) {
      ownerChatSubtitleEl.textContent = `Диалог с ${ownerChatSelectedDisplayName}`;
    }
  } else {
    ownerChatActiveConversationUserId = viewerId;
    ownerChatSelectedDisplayName = 'Владелец';
    ownerChatSubtitleEl.textContent = 'Диалог с владельцем';
  }

  await loadOwnerChatMessages({ reset: true });

  // Подписываемся на новые сообщения этого диалога.
  ownerChatWsActive = true;
  ownerChatWsSubscribedThreads = false;
  ownerChatWsSubscribedConversationUserId = ownerChatActiveConversationUserId ? String(ownerChatActiveConversationUserId) : null;
  ownerChatWsEnsure();
  scheduleChatKeyboardInset();
}

async function sendOwnerChatMessage() {
  if (!getTg()) return;
  if (!viewerId) return;
  if (ownerChatIsSending) return;
  if (!ownerChatActiveConversationUserId) return;

  const text = ownerChatInputEl ? ownerChatInputEl.value.trim() : '';
  if (!text) return;

  ownerChatIsSending = true;
  if (ownerChatSendBtn) ownerChatSendBtn.disabled = true;

  try {
    const payload = isOwnerApp
      ? {
          viewerId,
          toUserId: ownerChatActiveConversationUserId,
          text,
          username: viewerUsername
        }
      : {
          viewerId,
          toUserId: viewerId,
          text,
          username: viewerUsername
        };

    const data = await apiFetchJSON(
      '/api/owner-chat/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    ).catch(() => null);

    if (!data || !data.ok || !data.message) return;

    const message = data.message;
    ownerChatLastSeenId = Number(message.id || ownerChatLastSeenId);
    appendOwnerChatMessages([message]);
    if (ownerChatInputEl) ownerChatInputEl.value = '';
  } finally {
    ownerChatIsSending = false;
    if (ownerChatSendBtn) ownerChatSendBtn.disabled = false;
  }
}

if (ownerChatSendBtn) {
  ownerChatSendBtn.addEventListener('click', () => {
    sendOwnerChatMessage().catch(() => {});
  });
}

if (ownerChatInputEl) {
  ownerChatInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendOwnerChatMessage().catch(() => {});
    }
  });
  const kbDelays = [0, 50, 120, 250, 400, 600];
  ownerChatInputEl.addEventListener('focus', function () {
    scrollOwnerChatToBottomSmooth();
    kbDelays.forEach(function (ms) {
      setTimeout(function () {
        scheduleChatKeyboardInset();
        scrollOwnerChatToBottom();
      }, ms);
    });
  });
  ownerChatInputEl.addEventListener('blur', function () {
    setTimeout(scheduleChatKeyboardInset, 50);
    setTimeout(scheduleChatKeyboardInset, 200);
    setTimeout(scheduleChatKeyboardInset, 400);
  });
}

document.getElementById('build-tasks').addEventListener('input', () => {
  const el = document.getElementById('build-tasks');
  const err = document.getElementById('build-tasks-error');
  el.classList.remove('form-textarea-error');
  err.textContent = '';
});

document.getElementById('build-username').addEventListener('input', () => {
  const el = document.getElementById('build-username');
  const err = document.getElementById('build-username-error');
  el.classList.remove('form-input-error');
  err.textContent = '';
});

const COMP_FIELDS = [
  { id: 'comp-cpu', label: 'CPU' },
  { id: 'comp-gpu', label: 'GPU' },
  { id: 'comp-motherboard', label: 'Мат. плата' },
  { id: 'comp-ram', label: 'RAM' },
  { id: 'comp-ssd', label: 'SSD' },
  { id: 'comp-psu', label: 'БП' },
  { id: 'comp-case', label: 'Корпус' },
  { id: 'comp-cooling', label: 'Охлаждение' }
];
COMP_FIELDS.forEach(({ id }) => {
  const el = document.getElementById(id);
  const errId = id + '-error';
  if (el) el.addEventListener('input', () => {
    el.classList.remove('form-input-error');
    const err = document.getElementById(errId);
    if (err) err.textContent = '';
  });
});
document.getElementById('comp-username').addEventListener('input', () => {
  const el = document.getElementById('comp-username');
  const err = document.getElementById('comp-username-error');
  el.classList.remove('form-input-error');
  err.textContent = '';
});

document.getElementById('build-submit-btn').addEventListener('click', async () => {
  var t = getTg();
  if (!t) return;
  const RATE_LIMIT_MS = 5 * 60 * 1000;
  const alertEl = document.getElementById('build-rate-limit-alert');

  const currentUser = t.initDataUnsafe?.user || {};
  const isOwner = currentUser && currentUser.username === 'ShadowwOneLove';

  if (!isOwner) {
    const lastTsRaw = localStorage.getItem('buildRequestLastAt');
    const lastTs = lastTsRaw ? parseInt(lastTsRaw, 10) : 0;
    const now = Date.now();
    if (lastTs && now - lastTs < RATE_LIMIT_MS) {
      alertEl.textContent = 'Повторно заявку можно отправить через 5 минут.';
      alertEl.classList.add('alert-banner-visible');
      return;
    } else {
      alertEl.classList.remove('alert-banner-visible');
      alertEl.textContent = '';
    }
  } else {
    alertEl.classList.remove('alert-banner-visible');
    alertEl.textContent = '';
  }
  const tasksEl = document.getElementById('build-tasks');
  const tasks = tasksEl.value.trim();
  const errEl = document.getElementById('build-tasks-error');
  const usernameInput = document.getElementById('build-username');
  const usernameValue = usernameInput.value.trim();
  const usernameErr = document.getElementById('build-username-error');
  let hasError = false;

  if (!tasks) {
    tasksEl.classList.add('form-textarea-error');
    errEl.textContent = isUpgradeMode ? 'Заполните поле.' : 'Заполните поле «Задачи и бюджет».';
    hasError = true;
  } else if (tasks.length < 10) {
    tasksEl.classList.add('form-textarea-error');
    errEl.textContent = 'Сообщение должно содержать минимум 10 символов.';
    hasError = true;
  } else {
    tasksEl.classList.remove('form-textarea-error');
    errEl.textContent = '';
  }

  if (!usernameValue) {
    usernameInput.classList.add('form-input-error');
    usernameErr.textContent = 'Заполните поле @username.';
    hasError = true;
  } else if (usernameValue.indexOf(' ') !== -1) {
    usernameInput.classList.add('form-input-error');
    usernameErr.textContent = 'В @username нельзя использовать пробелы.';
    hasError = true;
  } else if (!/^[A-Za-z0-9_@]+$/.test(usernameValue)) {
    usernameInput.classList.add('form-input-error');
    usernameErr.textContent = '@username должен быть на английском.';
    hasError = true;
  } else if (usernameValue.length < 4) {
    usernameInput.classList.add('form-input-error');
    usernameErr.textContent = 'Слишком короткий @username.';
    hasError = true;
  } else if (!usernameValue.startsWith('@')) {
    usernameInput.classList.add('form-input-error');
    usernameErr.textContent = '@username должен начинаться с "@".';
    hasError = true;
  } else {
    usernameInput.classList.remove('form-input-error');
    usernameErr.textContent = '';
  }

  if (hasError) {
    return;
  }
  const btn = document.getElementById('build-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Отправка...';
  const user = t.initDataUnsafe?.user || {};
  try {
    const res = await fetch('/api/build-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks,
          requestType: isUpgradeMode ? 'upgrade' : undefined,
          userId: user.id,
          username_form: usernameValue || '',
          username_tg: user.username || ''
        })
    });
    const data = await res.json();
    if (data.ok) {
      localStorage.setItem('buildRequestLastAt', String(Date.now()));
      showView('view-build-success');
    } else {
      t.showPopup({ title: 'Ошибка', message: 'Не удалось отправить заявку. Попробуйте позже.', buttons: [{ type: 'ok' }] });
    }
  } catch (e) {
    t.showPopup({ title: 'Ошибка', message: 'Не удалось отправить заявку. Проверьте интернет.', buttons: [{ type: 'ok' }] });
  }
  btn.disabled = false;
  btn.textContent = 'Отправить на оценку';
});

document.getElementById('components-submit-btn').addEventListener('click', async () => {
  var t = getTg();
  if (!t) return;
  const RATE_LIMIT_MS = 5 * 60 * 1000;
  const alertEl = document.getElementById('components-rate-limit-alert');

  const currentUser = t.initDataUnsafe?.user || {};
  const isOwner = currentUser && currentUser.username === 'ShadowwOneLove';

  if (!isOwner) {
    const lastTsRaw = localStorage.getItem('buildRequestLastAt');
    const lastTs = lastTsRaw ? parseInt(lastTsRaw, 10) : 0;
    const now = Date.now();
    if (lastTs && now - lastTs < RATE_LIMIT_MS) {
      alertEl.textContent = 'Повторно заявку можно отправить через 5 минут.';
      alertEl.classList.add('alert-banner-visible');
      return;
    }
  }
  alertEl.classList.remove('alert-banner-visible');
  alertEl.textContent = '';

  let hasError = false;
  COMP_FIELDS.forEach(({ id, label }) => {
    const el = document.getElementById(id);
    const errEl = document.getElementById(id + '-error');
    const v = (el && el.value || '').trim();
    if (!v) {
      el.classList.add('form-input-error');
      errEl.textContent = 'Заполните поле «' + label + '».';
      hasError = true;
    } else {
      el.classList.remove('form-input-error');
      errEl.textContent = '';
    }
  });

  const usernameInput = document.getElementById('comp-username');
  const usernameValue = (usernameInput && usernameInput.value || '').trim();
  const usernameErr = document.getElementById('comp-username-error');
  if (!usernameValue) {
    usernameInput.classList.add('form-input-error');
    usernameErr.textContent = 'Заполните поле @username.';
    hasError = true;
  } else if (usernameValue.indexOf(' ') !== -1) {
    usernameInput.classList.add('form-input-error');
    usernameErr.textContent = 'В @username нельзя использовать пробелы.';
    hasError = true;
  } else if (!/^[A-Za-z0-9_@]+$/.test(usernameValue)) {
    usernameInput.classList.add('form-input-error');
    usernameErr.textContent = '@username должен быть на английском.';
    hasError = true;
  } else if (usernameValue.length < 4) {
    usernameInput.classList.add('form-input-error');
    usernameErr.textContent = 'Слишком короткий @username.';
    hasError = true;
  } else if (!usernameValue.startsWith('@')) {
    usernameInput.classList.add('form-input-error');
    usernameErr.textContent = '@username должен начинаться с "@".';
    hasError = true;
  } else {
    usernameInput.classList.remove('form-input-error');
    usernameErr.textContent = '';
  }

  if (hasError) return;

  const parts = [];
  COMP_FIELDS.forEach(({ id, label }) => {
    const el = document.getElementById(id);
    if (el && el.value) parts.push(label + ': ' + el.value.trim());
  });
  const wishes = (document.getElementById('comp-wishes') && document.getElementById('comp-wishes').value || '').trim();
  if (wishes) parts.push('Пожелания: ' + wishes);
  const tasks = parts.join('\n');

  const btn = document.getElementById('components-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Отправка...';
  const user = t.initDataUnsafe?.user || {};
  try {
    const res = await fetch('/api/build-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks,
        requestType: 'components',
        userId: user.id,
        username_form: usernameValue || '',
        username_tg: user.username || ''
      })
    });
    const data = await res.json();
    if (data.ok) {
      localStorage.setItem('buildRequestLastAt', String(Date.now()));
      showView('view-build-success');
    } else {
      t.showPopup({ title: 'Ошибка', message: 'Не удалось отправить заявку. Попробуйте позже.', buttons: [{ type: 'ok' }] });
    }
  } catch (e) {
    t.showPopup({ title: 'Ошибка', message: 'Не удалось отправить заявку. Проверьте интернет.', buttons: [{ type: 'ok' }] });
  }
  btn.disabled = false;
  btn.textContent = 'Отправить на оценку';
});

document.getElementById('success-home-btn').addEventListener('click', () => {
  showView('view-main');
});

function updateProfileView() {
  var avatarEl = document.getElementById('profile-avatar');
  var usernameEl = document.getElementById('profile-username');
  var avatarImg = document.getElementById('profile-avatar-img');
  if (!avatarEl || !usernameEl || !avatarImg) return;
  var user = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user : null;
  var name = user && (user.first_name || user.last_name) ? String((user.first_name || '') + ' ' + (user.last_name || '')).trim() : '';
  var display = name || 'Пользователь';
  usernameEl.textContent = display;
  var letter = (display && display[0]) ? display[0].toUpperCase() : 'U';
  avatarEl.textContent = letter;

  // Telegram WebApp иногда отдаёт photo_url в user
  var photoUrl = user && user.photo_url ? String(user.photo_url) : '';
  var cached = '';
  try { cached = localStorage.getItem('profileAvatarCompressed') || ''; } catch (_) {}

  if (cached) {
    avatarImg.onload = function () {
      avatarImg.classList.add('profile-avatar-img-visible');
      avatarEl.classList.add('profile-avatar-fallback-hidden');
    };
    avatarImg.onerror = function () {
      avatarImg.classList.remove('profile-avatar-img-visible');
      avatarEl.classList.remove('profile-avatar-fallback-hidden');
    };
    avatarImg.src = cached;
  } else if (photoUrl) {
    avatarImg.onload = function () {
      avatarImg.classList.add('profile-avatar-img-visible');
      avatarEl.classList.add('profile-avatar-fallback-hidden');
    };
    avatarImg.onerror = function () {
      avatarImg.classList.remove('profile-avatar-img-visible');
      avatarEl.classList.remove('profile-avatar-fallback-hidden');
    };
    avatarImg.src = photoUrl;
  } else {
    avatarImg.removeAttribute('src');
    avatarImg.classList.remove('profile-avatar-img-visible');
    avatarEl.classList.remove('profile-avatar-fallback-hidden');
  }
}

async function preloadProfileAvatar() {
  try {
    var user = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user : null;
    var photoUrl = user && user.photo_url ? String(user.photo_url) : '';
    if (!photoUrl) return;

    // Уже есть сжатая версия — ничего не делаем
    try {
      var exists = localStorage.getItem('profileAvatarCompressed');
      if (exists && exists.length > 50) return;
    } catch (_) {}

    // Пытаемся скачать и сжать (в localStorage, не в базе)
    var res = await fetch(photoUrl, { cache: 'force-cache' });
    if (!res.ok) return;
    var blob = await res.blob();
    var bitmap = null;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (_) {
      return;
    }

    var max = 160;
    var w = bitmap.width || max;
    var h = bitmap.height || max;
    var scale = Math.min(1, max / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, cw, ch);

    var dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    } catch (_) {
      return;
    }
    if (!dataUrl || dataUrl.length < 50) return;
    try { localStorage.setItem('profileAvatarCompressed', dataUrl); } catch (_) {}

    // Если пользователь уже на экране "Мои заказы" или аватар ещё не показан — обновим
    updateProfileView();
  } catch (_) {}
}

async function fetchPresets() {
  try {
    const res = await fetch('/api/presets');
    const data = await res.json();
    if (!data || !data.ok || !Array.isArray(data.items)) return [];
    return data.items;
  } catch (_) {
    return [];
  }
}

async function fetchPortfolio() {
  try {
    const res = await fetch('/api/portfolio');
    const data = await res.json();
    if (!data || !data.ok || !Array.isArray(data.items)) return [];
    return data.items;
  } catch (_) {
    return [];
  }
}

var lastPresetsList = [];
var lastPortfolioList = [];
var createDraft = { description: '', title: '', price: '', avitoLink: '', image: '', images: [] };
var portfolioDraft = { title: '', description: '', images: [] };

function formatPriceWithRub(price) {
  var raw = String(price || '').trim();
  if (!raw) return '';
  raw = raw.replace(/[₽рp]+$/gi, '').replace(/\s+$/g, '');
  return raw ? raw + ' ₽' : '';
}

function renderPresetCard(item) {
  var priceText = formatPriceWithRub(item.price);
  var title = escapeAttr(item.title || '');
  var html = '<article class=\"preset-announcement-card\" data-preset-id=\"' + escapeAttr(item.id) + '\" tabindex=\"0\" role=\"button\">';
  html += '<div class=\"preset-card-image-wrap\">';
  if (item.image && item.image.length > 0) {
    html += '<img src=\"' + escapeAttr(item.image) + '\" alt=\"\" />';
  } else {
    html += '<div style=\"width:100%;height:100%;background:#242424;display:flex;align-items:center;justify-content:center;color:#8e8e93;font-size:12px;\">Нет фото</div>';
  }
  if (item.delivery) {
    html += '<span class=\"preset-card-delivery-icon\" aria-hidden=\"true\">🚚</span>';
  }
  html += '</div>';
  html += '<div class=\"preset-card-info\">';
  html += '<p class=\"preset-card-title\">' + title + '</p>';
  html += '<p class=\"preset-card-price' + (priceText ? '' : ' preset-card-price-empty') + '\">' + escapeAttr(priceText || '') + '</p>';
  if (item.oldPrice || item.location) {
    var extra = [item.oldPrice, item.location].filter(Boolean).join(' · ');
    html += '<p class=\"preset-card-extra\">' + escapeAttr(extra) + '</p>';
  }
  html += '</div></article>';
  return html;
}

function renderPortfolioCard(item) {
  var title = escapeAttr(item.title || '');
  var img = '';
  var imgs = Array.isArray(item.images) ? item.images.filter(Boolean) : [];
  if (!imgs.length && item.image) imgs = [item.image];
  img = imgs[0] || '';
  var html = '<article class=\"preset-announcement-card\" data-portfolio-id=\"' + escapeAttr(item.id) + '\" tabindex=\"0\" role=\"button\">';
  html += '<div class=\"preset-card-image-wrap\">';
  if (img) html += '<img src=\"' + escapeAttr(img) + '\" alt=\"\" />';
  else html += '<div style=\"width:100%;height:100%;background:#242424;display:flex;align-items:center;justify-content:center;color:#8e8e93;font-size:12px;\">Нет фото</div>';
  html += '</div>';
  html += '<div class=\"preset-card-info\">';
  html += '<p class=\"preset-card-title\">' + title + '</p>';
  html += '</div></article>';
  return html;
}

function escapeAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ----- Fullscreen photo viewer (pinch zoom) -----
var photoModalEl = document.getElementById('photo-modal');
var photoModalImgEl = document.getElementById('photo-modal-img');
var photoModalCloseEl = document.getElementById('photo-modal-close');
var photoModalInnerEl = document.getElementById('photo-modal-inner');
var photoZoomState = { open: false, scale: 1, tx: 0, ty: 0, pinchStartDist: 0, pinchStartScale: 1 };

function applyPhotoModalTransform() {
  if (!photoModalImgEl) return;
  var s = Math.max(1, Math.min(4, photoZoomState.scale));
  photoZoomState.scale = s;
  photoModalImgEl.style.transform = 'translate3d(' + photoZoomState.tx + 'px,' + photoZoomState.ty + 'px,0) scale(' + photoZoomState.scale + ')';
}

function openPhotoModal(src) {
  if (!photoModalEl || !photoModalImgEl) return;
  if (!src) return;
  photoZoomState.open = true;
  photoZoomState.scale = 1;
  photoZoomState.tx = 0;
  photoZoomState.ty = 0;
  photoZoomState.pinchStartDist = 0;
  photoZoomState.pinchStartScale = 1;
  photoModalImgEl.src = src;
  photoModalEl.classList.add('photo-modal-open');
  photoModalEl.setAttribute('aria-hidden', 'false');
  document.documentElement.style.overflow = 'hidden';
  applyPhotoModalTransform();
}

function closePhotoModal() {
  if (!photoModalEl || !photoModalImgEl) return;
  photoZoomState.open = false;
  photoModalEl.classList.remove('photo-modal-open');
  photoModalEl.setAttribute('aria-hidden', 'true');
  document.documentElement.style.overflow = '';
  // чтобы очистить трансформы и не держать старое изображение в кеше UI
  photoModalImgEl.style.transform = 'translate3d(0,0,0) scale(1)';
}

if (photoModalCloseEl) {
  photoModalCloseEl.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    closePhotoModal();
  });
}

if (photoModalEl) {
  photoModalEl.addEventListener('click', function (e) {
    // клик по затемнённому фону закрывает, клик по изображению — нет
    if (e.target === photoModalEl) closePhotoModal();
  });
}

function touchDistance(t1, t2) {
  var dx = (t1.clientX - t2.clientX);
  var dy = (t1.clientY - t2.clientY);
  return Math.sqrt(dx * dx + dy * dy);
}

function handlePhotoTouchStart(e) {
  if (!photoZoomState.open) return;
  if (!e.touches) return;
  if (e.touches.length === 2) {
    photoZoomState.pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
    photoZoomState.pinchStartScale = photoZoomState.scale;
  } else if (e.touches.length === 1) {
    photoZoomState.lastTouchX = e.touches[0].clientX;
    photoZoomState.lastTouchY = e.touches[0].clientY;
  }
}

function handlePhotoTouchMove(e) {
  if (!photoZoomState.open) return;
  if (!e.touches) return;
  if (e.touches.length === 2 && photoZoomState.pinchStartDist > 0) {
    var dist = touchDistance(e.touches[0], e.touches[1]);
    var ratio = dist / photoZoomState.pinchStartDist;
    photoZoomState.scale = photoZoomState.pinchStartScale * ratio;
    // на pinch не панорамим (чтобы было стабильнее)
    applyPhotoModalTransform();
    e.preventDefault();
    return;
  }
  if (e.touches.length === 1) {
    var x = e.touches[0].clientX;
    var y = e.touches[0].clientY;
    var allowPanBecauseBig =
      (photoModalImgEl && photoModalInnerEl && (
        photoModalImgEl.offsetWidth > photoModalInnerEl.clientWidth + 2 ||
        photoModalImgEl.offsetHeight > photoModalInnerEl.clientHeight + 2
      ));
    if (typeof photoZoomState.lastTouchX === 'number') {
      var dx = x - photoZoomState.lastTouchX;
      var dy = y - photoZoomState.lastTouchY;
      if (photoZoomState.scale > 1.01 || allowPanBecauseBig) {
        photoZoomState.tx += dx;
        photoZoomState.ty += dy;
        applyPhotoModalTransform();
      }
    }
    photoZoomState.lastTouchX = x;
    photoZoomState.lastTouchY = y;
    if (photoZoomState.scale > 1.01 || allowPanBecauseBig) e.preventDefault();
  }
}

function handlePhotoTouchEnd() {
  if (!photoZoomState.open) return;
  photoZoomState.pinchStartDist = 0;
  photoZoomState.pinchStartScale = photoZoomState.scale;
  photoZoomState.lastTouchX = null;
  photoZoomState.lastTouchY = null;
}

if (photoModalEl) {
  photoModalInnerEl && photoModalInnerEl.addEventListener('touchstart', handlePhotoTouchStart, { passive: false });
  photoModalInnerEl && photoModalInnerEl.addEventListener('touchmove', handlePhotoTouchMove, { passive: false });
  photoModalInnerEl && photoModalInnerEl.addEventListener('touchend', handlePhotoTouchEnd, { passive: true });
}

window.addEventListener('keydown', function (e) {
  if (e && e.key === 'Escape') closePhotoModal();
});

function renderOwnerPresetCard(item) {
  var base = renderPresetCard(item);
  return base.replace('</div>', '<button type=\"button\" class=\"preset-delete-btn\" data-preset-id=\"' + escapeAttr(item.id) + '\">Удалить</button></div>');
}

var editPresetImages = {};

function renderOwnerPresetEditCard(item) {
  var pid = String(item.id);
  var imgs = editPresetImages[pid] || item.images || (item.image ? [item.image] : []);
  var inputId = 'preset-edit-image-' + escapeAttr(item.id);
  var imgBlock = '<div class=\"photo-gallery preset-edit-gallery\">';
  imgBlock += '<div class=\"photo-preview-list preset-edit-preview-list\" data-preset-id=\"' + escapeAttr(item.id) + '\">';
  for (var idx = 0; idx < imgs.length; idx++) {
    imgBlock += '<div class=\"photo-preview-card\" data-photo-index=\"' + idx + '\">';
    imgBlock += '<img src=\"' + escapeAttr(imgs[idx]) + '\" alt=\"\" />';
    if (idx === 0) imgBlock += '<span class=\"photo-preview-badge\">Главная</span>';
    imgBlock += '<button type=\"button\" class=\"photo-preview-edit preset-edit-photo-replace\" data-preset-id=\"' + escapeAttr(item.id) + '\" data-photo-index=\"' + idx + '\" aria-label=\"Изменить\">';
    imgBlock += '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\"/><path d=\"M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\"/></svg>';
    imgBlock += '</button>';
    imgBlock += '<button type=\"button\" class=\"photo-preview-delete preset-edit-photo-delete\" data-preset-id=\"' + escapeAttr(item.id) + '\" data-photo-index=\"' + idx + '\" aria-label=\"Удалить фото\">✕</button></div>';
  }
  imgBlock += '</div>';
  imgBlock += '<label class=\"photo-add-card preset-edit-photo-card photo-add-inline\" for=\"' + inputId + '\">';
  imgBlock += '<input type=\"file\" class=\"photo-add-input preset-edit-image-input\" id=\"' + inputId + '\" accept=\"image/*\" data-preset-id=\"' + escapeAttr(item.id) + '\" />';
  imgBlock += '<span class=\"photo-add-icon\"></span>';
  imgBlock += '<span class=\"photo-add-text\">Добавить фото</span>';
  imgBlock += '</label></div>';
  var html = '<article class=\"preset-edit-card\" data-preset-id=\"' + escapeAttr(item.id) + '\">';
  html += '<label class=\"form-label\">Название</label>';
  html += '<input class=\"form-input preset-edit-title\" value=\"' + escapeAttr(item.title) + '\" data-preset-id=\"' + escapeAttr(item.id) + '\" />';
  html += '<label class=\"form-label\">Цена</label>';
  html += '<div class=\"input-with-ruble\"><input class=\"form-input preset-edit-price\" value=\"' + escapeAttr(item.price) + '\" data-preset-id=\"' + escapeAttr(item.id) + '\" /><span class=\"input-ruble-suffix\">₽</span></div>';
  html += '<label class=\"form-label\">Ссылка Avito</label>';
  html += '<input class=\"form-input preset-edit-avito\" value=\"' + escapeAttr(item.avitoLink || '') + '\" data-preset-id=\"' + escapeAttr(item.id) + '\" placeholder=\"https://www.avito.ru/...\" />';
  html += '<h3 class=\"photo-section-title preset-edit-photo-title\">Фотографии</h3>';
  html += '<div class=\"preset-edit-image-wrap\">' + imgBlock + '</div>';
  html += '<label class=\"form-label\">Описание</label>';
  html += '<textarea class=\"form-textarea form-textarea-sm preset-edit-desc\" data-preset-id=\"' + escapeAttr(item.id) + '\">' + escapeAttr(item.description) + '</textarea>';
  html += '<div class=\"preset-edit-actions\">';
  html += '<button type=\"button\" class=\"submit-btn preset-save-btn\" data-preset-id=\"' + escapeAttr(item.id) + '\">Сохранить изменения</button>';
  html += '<button type=\"button\" class=\"preset-delete-btn\" data-preset-id=\"' + escapeAttr(item.id) + '\">Удалить</button>';
  html += '</div></article>';
  return html;
}

function showPresetDetail(item) {
  var wrap = document.getElementById('preset-detail-image-wrap');
  var titleEl = document.getElementById('preset-detail-title');
  var priceEl = document.getElementById('preset-detail-price');
  var descEl = document.getElementById('preset-detail-desc');
  if (!wrap || !titleEl || !priceEl || !descEl) return;
  var imgs = [];
  if (Array.isArray(item.images) && item.images.length) imgs = item.images.filter(Boolean);
  if (!imgs.length && item.image) imgs = [item.image];

  if (imgs.length) {
    var track = '<div class=\"preset-detail-carousel\" id=\"preset-detail-carousel\">';
    track += '<div class=\"preset-detail-carousel-track\" id=\"preset-detail-carousel-track\">';
    for (var i = 0; i < imgs.length; i++) {
      track += '<div class=\"preset-detail-carousel-slide\"><img src=\"' + escapeAttr(imgs[i]) + '\" alt=\"\" /></div>';
    }
    track += '</div>';
    if (imgs.length > 1) {
      track += '<div class=\"preset-detail-dots\" id=\"preset-detail-dots\">';
      for (var d = 0; d < imgs.length; d++) {
        track += '<span class=\"preset-detail-dot' + (d === 0 ? ' preset-detail-dot-active' : '') + '\"></span>';
      }
      track += '</div>';
    }
    track += '</div>';
    wrap.innerHTML = track;
    wrap.classList.remove('hidden');

    (function initCarousel() {
      var carousel = document.getElementById('preset-detail-carousel');
      var trackEl = document.getElementById('preset-detail-carousel-track');
      if (!carousel || !trackEl || imgs.length <= 1) return;
      var dotsWrap = document.getElementById('preset-detail-dots');
      var dots = dotsWrap ? Array.from(dotsWrap.querySelectorAll('.preset-detail-dot')) : [];
      var idx = 0;
      var startX = 0;
      var curX = 0;
      var isDown = false;

      function setIndex(next) {
        idx = Math.max(0, Math.min(imgs.length - 1, next));
        trackEl.style.transition = 'transform 0.22s ease';
        trackEl.style.transform = 'translateX(' + (-idx * 100) + '%)';
        if (dots.length) {
          dots.forEach(function (dot, i) {
            if (i === idx) dot.classList.add('preset-detail-dot-active');
            else dot.classList.remove('preset-detail-dot-active');
          });
        }
      }

      function onStart(x) {
        isDown = true;
        startX = x;
        curX = x;
        trackEl.style.transition = 'none';
      }

      function onMove(x) {
        if (!isDown) return;
        curX = x;
        var dx = curX - startX;
        var w = carousel.clientWidth || 1;
        var px = (-idx * w) + dx;
        trackEl.style.transform = 'translateX(' + px + 'px)';
      }

      function onEnd() {
        if (!isDown) return;
        isDown = false;
        var dx = curX - startX;
        var threshold = Math.min(60, (carousel.clientWidth || 300) * 0.18);
        if (dx > threshold) setIndex(idx - 1);
        else if (dx < -threshold) setIndex(idx + 1);
        else setIndex(idx);
      }

      carousel.addEventListener('touchstart', function (e) { if (e.touches && e.touches[0]) onStart(e.touches[0].clientX); }, { passive: true });
      carousel.addEventListener('touchmove', function (e) { if (e.touches && e.touches[0]) onMove(e.touches[0].clientX); }, { passive: true });
      carousel.addEventListener('touchend', onEnd);

      carousel.addEventListener('mousedown', function (e) { onStart(e.clientX); });
      window.addEventListener('mousemove', function (e) { onMove(e.clientX); });
      window.addEventListener('mouseup', onEnd);

      setIndex(0);
    })();

    // клик по фото открывает полноэкранный просмотрщик
    try {
      wrap.querySelectorAll('#preset-detail-carousel img').forEach(function (imgEl) {
        imgEl.style.cursor = 'zoom-in';
        imgEl.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          openPhotoModal(imgEl.getAttribute('src') || imgEl.src);
        });
      });
    } catch (_) {}
  } else {
    wrap.innerHTML = '';
    wrap.classList.add('hidden');
  }
  titleEl.textContent = item.title || '';
  var priceText = formatPriceWithRub(item.price);
  priceEl.textContent = priceText || '';
  priceEl.style.display = priceText ? '' : 'none';
  descEl.textContent = item.description || '';
  var cta = document.getElementById('preset-detail-cta');
  if (cta) {
    var avitoUrl = item && item.avitoLink ? String(item.avitoLink).trim() : '';
    cta.textContent = 'Купить на Авито';
    cta.classList.remove('avito-buy-btn');
    cta.disabled = false;

    if (avitoUrl) {
      cta.classList.add('avito-buy-btn');
      cta.onclick = function () {
        try {
          if (tg && typeof tg.openLink === 'function') tg.openLink(avitoUrl);
          else window.open(avitoUrl, '_blank', 'noopener,noreferrer');
        } catch (_) {
          window.open(avitoUrl, '_blank', 'noopener,noreferrer');
        }
      };
    } else {
      cta.disabled = true;
      cta.classList.add('avito-buy-btn--disabled');
      cta.onclick = function () {
        try {
          if (tg && typeof tg.showPopup === 'function') {
            tg.showPopup({ title: 'Авито', message: 'Продавец не указал ссылку на объявление.', buttons: [{ type: 'ok' }] });
          }
        } catch (_) {}
      };
    }
  }

  var pickupBtn = document.getElementById('preset-detail-pickup-cta');
  if (pickupBtn) {
    pickupBtn.onclick = function () {
      try {
        if (tg && typeof tg.showPopup === 'function') {
          tg.showPopup({ title: 'Самовывоз', message: 'Функция самовывоза появится позже.', buttons: [{ type: 'ok' }] });
          return;
        }
      } catch (_) {}
      window.alert('Функция самовывоза появится позже.');
    };
  }
  showView('view-preset-detail', 'right');
}

function showPortfolioDetail(item) {
  var wrap = document.getElementById('portfolio-detail-image-wrap');
  var titleEl = document.getElementById('portfolio-detail-title');
  var descEl = document.getElementById('portfolio-detail-desc');
  if (!wrap || !titleEl || !descEl) return;
  var imgs = [];
  if (Array.isArray(item.images) && item.images.length) imgs = item.images.filter(Boolean);
  if (!imgs.length && item.image) imgs = [item.image];

  if (imgs.length) {
    var track = '<div class=\"preset-detail-carousel\" id=\"portfolio-detail-carousel\">';
    track += '<div class=\"preset-detail-carousel-track\" id=\"portfolio-detail-carousel-track\">';
    for (var i = 0; i < imgs.length; i++) {
      track += '<div class=\"preset-detail-carousel-slide\"><img src=\"' + escapeAttr(imgs[i]) + '\" alt=\"\" /></div>';
    }
    track += '</div>';
    if (imgs.length > 1) {
      track += '<div class=\"preset-detail-dots\" id=\"portfolio-detail-dots\">';
      for (var d = 0; d < imgs.length; d++) {
        track += '<span class=\"preset-detail-dot' + (d === 0 ? ' preset-detail-dot-active' : '') + '\"></span>';
      }
      track += '</div>';
    }
    track += '</div>';
    wrap.innerHTML = track;
    wrap.classList.remove('hidden');

    (function initCarousel() {
      var carousel = document.getElementById('portfolio-detail-carousel');
      var trackEl = document.getElementById('portfolio-detail-carousel-track');
      if (!carousel || !trackEl || imgs.length <= 1) return;
      var dotsWrap = document.getElementById('portfolio-detail-dots');
      var dots = dotsWrap ? Array.from(dotsWrap.querySelectorAll('.preset-detail-dot')) : [];
      var idx = 0;
      var startX = 0;
      var curX = 0;
      var isDown = false;

      function setIndex(next) {
        idx = Math.max(0, Math.min(imgs.length - 1, next));
        trackEl.style.transition = 'transform 0.22s ease';
        trackEl.style.transform = 'translateX(' + (-idx * 100) + '%)';
        if (dots.length) {
          dots.forEach(function (dot, i) {
            if (i === idx) dot.classList.add('preset-detail-dot-active');
            else dot.classList.remove('preset-detail-dot-active');
          });
        }
      }

      function onStart(x) {
        isDown = true;
        startX = x;
        curX = x;
        trackEl.style.transition = 'none';
      }

      function onMove(x) {
        if (!isDown) return;
        curX = x;
        var dx = curX - startX;
        var w = carousel.clientWidth || 1;
        var px = (-idx * w) + dx;
        trackEl.style.transform = 'translateX(' + px + 'px)';
      }

      function onEnd() {
        if (!isDown) return;
        isDown = false;
        var dx = curX - startX;
        var threshold = Math.min(60, (carousel.clientWidth || 300) * 0.18);
        if (dx > threshold) setIndex(idx - 1);
        else if (dx < -threshold) setIndex(idx + 1);
        else setIndex(idx);
      }

      carousel.addEventListener('touchstart', function (e) { if (e.touches && e.touches[0]) onStart(e.touches[0].clientX); }, { passive: true });
      carousel.addEventListener('touchmove', function (e) { if (e.touches && e.touches[0]) onMove(e.touches[0].clientX); }, { passive: true });
      carousel.addEventListener('touchend', onEnd);

      carousel.addEventListener('mousedown', function (e) { onStart(e.clientX); });
      window.addEventListener('mousemove', function (e) { onMove(e.clientX); });
      window.addEventListener('mouseup', onEnd);

      setIndex(0);
    })();

    // клик по фото открывает полноэкранный просмотрщик
    try {
      wrap.querySelectorAll('#portfolio-detail-carousel img').forEach(function (imgEl) {
        imgEl.style.cursor = 'zoom-in';
        imgEl.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          openPhotoModal(imgEl.getAttribute('src') || imgEl.src);
        });
      });
    } catch (_) {}
  } else {
    wrap.innerHTML = '';
    wrap.classList.add('hidden');
  }

  titleEl.textContent = item.title || '';
  descEl.textContent = item.description || '';
  showView('view-portfolio-detail', 'right');
}

var loadingPresetsHtml = '<div class=\"list-loading\"><div class=\"list-loading-spinner\"></div><span>Загрузка сборок...</span></div>';
var loadingPortfolioHtml = '<div class=\"list-loading\"><div class=\"list-loading-spinner\"></div><span>Загрузка...</span></div>';

async function loadPublicPresets() {
  var listEl = document.getElementById('presets-list');
  if (!listEl) return;
  listEl.classList.add('preset-list-loading');
  listEl.classList.remove('preset-list-empty');
  listEl.innerHTML = loadingPresetsHtml;
  var items = await fetchPresets();
  lastPresetsList = items || [];
  if (!items.length) {
    listEl.classList.remove('preset-list-loading');
    listEl.classList.add('preset-list-empty');
    listEl.innerHTML = '<p class=\"consult-text\">Пока нет готовых сборок.</p>';
    return;
  }
  listEl.classList.remove('preset-list-loading');
  listEl.classList.remove('preset-list-empty');
  listEl.innerHTML = items.map(renderPresetCard).join('');
  listEl.querySelectorAll('.preset-announcement-card').forEach(function (card) {
    var id = card.getAttribute('data-preset-id');
    var item = lastPresetsList.find(function (p) { return String(p.id) === String(id); });
    if (!item) return;
    function openDetail() { showPresetDetail(item); }
    card.addEventListener('click', openDetail);
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(); } });
  });
}

async function loadPublicPortfolio() {
  var listEl = document.getElementById('portfolio-list');
  if (!listEl) return;
  listEl.classList.add('preset-list-loading');
  listEl.classList.remove('preset-list-empty');
  listEl.innerHTML = loadingPortfolioHtml;
  var items = await fetchPortfolio();
  lastPortfolioList = items || [];
  if (!items.length) {
    listEl.classList.remove('preset-list-loading');
    listEl.classList.add('preset-list-empty');
    listEl.innerHTML = '<p class=\"profile-empty\">Пока нет работ.</p>';
    return;
  }
  listEl.classList.remove('preset-list-loading');
  listEl.classList.remove('preset-list-empty');
  listEl.innerHTML = items.map(renderPortfolioCard).join('');
  listEl.querySelectorAll('[data-portfolio-id]').forEach(function (card) {
    var id = card.getAttribute('data-portfolio-id');
    var item = lastPortfolioList.find(function (p) { return String(p.id) === String(id); });
    if (!item) return;
    function openDetail() { showPortfolioDetail(item); }
    card.addEventListener('click', openDetail);
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(); } });
  });
}

var loadingOwnerHtml = '<div class=\"list-loading\"><div class=\"list-loading-spinner\"></div><span>Загрузка...</span></div>';

var replaceEditIndex = null;
var replaceEditPresetId = null;

async function loadOwnerEditPresets() {
  var listEl = document.getElementById('owner-presets-list');
  if (!listEl) return;
  listEl.innerHTML = loadingOwnerHtml;
  var items = await fetchPresets();
  if (!items.length) {
    listEl.innerHTML = '<p class="consult-text">Нет предложений. Создайте новое во вкладке «Создать новое предложение».</p>';
    return;
  }
  editPresetImages = {};
  items.forEach(function (it) {
    editPresetImages[String(it.id)] = it.images || (it.image ? [it.image] : []);
  });
  listEl.innerHTML = items.map(renderOwnerPresetEditCard).join('');

  function rebuildPresetEditPhotos(pid) {
    if (!pid) return;
    var list = listEl.querySelector('.preset-edit-preview-list[data-preset-id="' + pid.replace(/"/g, '\\"') + '"]');
    if (!list) return;
    var imgs = editPresetImages[pid] || [];
    list.innerHTML = '';
    for (var idx = 0; idx < imgs.length; idx++) {
      var div = document.createElement('div');
      div.className = 'photo-preview-card';
      div.setAttribute('data-photo-index', String(idx));

      var img = document.createElement('img');
      img.src = imgs[idx];
      img.alt = '';
      div.appendChild(img);

      if (idx === 0) {
        var badge = document.createElement('span');
        badge.className = 'photo-preview-badge';
        badge.textContent = 'Главная';
        div.appendChild(badge);
      }

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'photo-preview-edit preset-edit-photo-replace';
      editBtn.setAttribute('data-preset-id', pid);
      editBtn.setAttribute('data-photo-index', String(idx));
      editBtn.setAttribute('aria-label', 'Изменить');
      editBtn.innerHTML = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\"/><path d=\"M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\"/></svg>';
      editBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        replaceEditIndex = parseInt(this.getAttribute('data-photo-index'), 10);
        replaceEditPresetId = this.getAttribute('data-preset-id');
        var inp = document.getElementById('preset-edit-image-' + pid);
        if (inp) inp.click();
      });
      div.appendChild(editBtn);

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'photo-preview-delete preset-edit-photo-delete';
      delBtn.setAttribute('data-preset-id', pid);
      delBtn.setAttribute('data-photo-index', String(idx));
      delBtn.setAttribute('aria-label', 'Удалить фото');
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var id = this.getAttribute('data-preset-id');
        var delIdx = parseInt(this.getAttribute('data-photo-index'), 10);
        var cur = editPresetImages[id] || [];
        if (typeof delIdx === 'number' && delIdx >= 0 && delIdx < cur.length) {
          cur.splice(delIdx, 1);
          editPresetImages[id] = cur;
        }
        replaceEditIndex = null;
        replaceEditPresetId = null;
        rebuildPresetEditPhotos(id);
      });
      div.appendChild(delBtn);

      list.appendChild(div);
    }
  }

  listEl.querySelectorAll('.preset-edit-image-input').forEach(function (input) {
    input.addEventListener('change', function () {
      var pid = this.getAttribute('data-preset-id');
      if (!pid || !this.files || !this.files[0]) return;
      var file = this.files[0];
      compressImageFile(file, 1280, 0.8).then(function (dataUrl) {
        var imgs = editPresetImages[pid] || [];
        var idx = replaceEditIndex;
        var replacePid = replaceEditPresetId;
        replaceEditIndex = null;
        replaceEditPresetId = null;
        if (typeof idx === 'number' && idx >= 0 && replacePid === pid && imgs[idx] !== undefined) {
          imgs[idx] = dataUrl;
          var card = listEl.querySelector('.preset-edit-preview-list[data-preset-id="' + pid.replace(/"/g, '\\"') + '"] .photo-preview-card[data-photo-index="' + idx + '"]');
          if (card) {
            var imgEl = card.querySelector('img');
            if (imgEl) imgEl.src = dataUrl;
          }
        } else {
          imgs.push(dataUrl);
          var list = listEl.querySelector('.preset-edit-preview-list[data-preset-id="' + pid.replace(/"/g, '\\"') + '"]');
          if (list) {
            var newIdx = imgs.length - 1;
            var div = document.createElement('div');
            div.className = 'photo-preview-card';
            div.setAttribute('data-photo-index', String(newIdx));
            var img = document.createElement('img');
            img.src = dataUrl;
            img.alt = '';
            div.appendChild(img);
            if (newIdx === 0) {
              var badge = document.createElement('span');
              badge.className = 'photo-preview-badge';
              badge.textContent = 'Главная';
              div.appendChild(badge);
            }
            var editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'photo-preview-edit preset-edit-photo-replace';
            editBtn.setAttribute('data-preset-id', pid);
            editBtn.setAttribute('data-photo-index', String(newIdx));
            editBtn.setAttribute('aria-label', 'Изменить');
            editBtn.innerHTML = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\"/><path d=\"M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\"/></svg>';
            div.appendChild(editBtn);

            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'photo-preview-delete preset-edit-photo-delete';
            delBtn.setAttribute('data-preset-id', pid);
            delBtn.setAttribute('data-photo-index', String(newIdx));
            delBtn.setAttribute('aria-label', 'Удалить фото');
            delBtn.textContent = '✕';
            div.appendChild(delBtn);

            list.appendChild(div);
            editBtn.addEventListener('click', function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              replaceEditIndex = parseInt(this.getAttribute('data-photo-index'), 10);
              replaceEditPresetId = this.getAttribute('data-preset-id');
              input.click();
            });
            delBtn.addEventListener('click', function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              var id = this.getAttribute('data-preset-id');
              var delIdx = parseInt(this.getAttribute('data-photo-index'), 10);
              var cur = editPresetImages[id] || [];
              if (typeof delIdx === 'number' && delIdx >= 0 && delIdx < cur.length) {
                cur.splice(delIdx, 1);
                editPresetImages[id] = cur;
              }
              replaceEditIndex = null;
              replaceEditPresetId = null;
              rebuildPresetEditPhotos(id);
            });
          }
        }
        editPresetImages[pid] = imgs;
      });
      this.value = '';
    });
  });

  listEl.querySelectorAll('.preset-edit-photo-replace').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var pid = this.getAttribute('data-preset-id');
      replaceEditIndex = parseInt(this.getAttribute('data-photo-index'), 10);
      replaceEditPresetId = pid;
      var inp = document.getElementById('preset-edit-image-' + pid);
      if (inp) inp.click();
    });
  });

  listEl.querySelectorAll('.preset-edit-photo-delete').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var id = this.getAttribute('data-preset-id');
      var delIdx = parseInt(this.getAttribute('data-photo-index'), 10);
      var cur = editPresetImages[id] || [];
      if (typeof delIdx === 'number' && delIdx >= 0 && delIdx < cur.length) {
        cur.splice(delIdx, 1);
        editPresetImages[id] = cur;
      }
      replaceEditIndex = null;
      replaceEditPresetId = null;
      rebuildPresetEditPhotos(id);
    });
  });

  listEl.querySelectorAll('.preset-save-btn').forEach(function (btn) {
    btn.addEventListener('click', async function (e) {
      e.stopPropagation();
      if (!tg || !currentUser) return;
      var id = btn.getAttribute('data-preset-id');
      var card = listEl.querySelector('.preset-edit-card[data-preset-id="' + id + '"]');
      if (!card) return;
      var titleEl = card.querySelector('.preset-edit-title');
      var priceEl = card.querySelector('.preset-edit-price');
      var descEl = card.querySelector('.preset-edit-desc');
      var avitoEl = card.querySelector('.preset-edit-avito');
      var title = (titleEl && titleEl.value || '').trim();
      var price = (priceEl && priceEl.value || '').trim();
      var priceFormatted = formatPriceWithRub(price);
      var description = (descEl && descEl.value || '').trim();
      var avitoLink = (avitoEl && avitoEl.value || '').trim();
      if (!title) {
        tg.showPopup({ title: 'Ошибка', message: 'Заполните название.', buttons: [{ type: 'ok' }] });
        return;
      }
      var imgs = editPresetImages[id] || [];
      var payload = { userId: currentUser.id, id: id, title: title, price: priceFormatted, description: description, avitoLink: avitoLink, images: imgs };
      if (imgs.length > 0) payload.image = imgs[0];
      btn.disabled = true;
      btn.textContent = 'Сохранение...';
      try {
        var res = await fetch('/api/presets/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (data && data.ok) {
          await loadOwnerEditPresets();
          tg.showPopup({ title: 'Готово', message: 'Изменения сохранены.', buttons: [{ type: 'ok' }] });
        } else {
          tg.showPopup({ title: 'Ошибка', message: 'Не удалось сохранить.', buttons: [{ type: 'ok' }] });
        }
      } catch (_) {
        tg.showPopup({ title: 'Ошибка', message: 'Не удалось сохранить.', buttons: [{ type: 'ok' }] });
      } finally {
        btn.disabled = false;
        btn.textContent = 'Сохранить изменения';
      }
    });
  });
  listEl.querySelectorAll('.preset-edit-card .preset-delete-btn').forEach(function (btn) {
    btn.addEventListener('click', async function (e) {
      e.stopPropagation();
      if (!tg || !currentUser) return;
      if (!confirm('Вы точно хотите удалить объявление?')) return;
      var id = btn.getAttribute('data-preset-id');
      try {
        var res = await fetch('/api/presets/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUser.id, id: id })
        });
        var data = await res.json();
        if (data && data.ok) {
          await loadOwnerEditPresets();
        } else {
          tg.showPopup({ title: 'Ошибка', message: 'Не удалось удалить предложение.', buttons: [{ type: 'ok' }] });
        }
      } catch (_) {
        tg.showPopup({ title: 'Ошибка', message: 'Не удалось удалить предложение.', buttons: [{ type: 'ok' }] });
      }
    });
  });
}

// ----- Портфолио (public + owner edit) -----
function renderOwnerPortfolioEditCard(item) {
  var pid = String(item.id);
  var imgs = editPortfolioImages[pid] || item.images || (item.image ? [item.image] : []);
  var inputId = 'portfolio-edit-image-' + escapeAttr(item.id);
  var imgBlock = '<div class=\"photo-gallery preset-edit-gallery\">';
  imgBlock += '<div class=\"photo-preview-list preset-edit-preview-list\" data-portfolio-id=\"' + escapeAttr(item.id) + '\">';
  for (var idx = 0; idx < imgs.length; idx++) {
    imgBlock += '<div class=\"photo-preview-card\" data-photo-index=\"' + idx + '\">';
    imgBlock += '<img src=\"' + escapeAttr(imgs[idx]) + '\" alt=\"\" />';
    if (idx === 0) imgBlock += '<span class=\"photo-preview-badge\">Главная</span>';
    imgBlock += '<button type=\"button\" class=\"photo-preview-edit portfolio-edit-photo-replace\" data-portfolio-id=\"' + escapeAttr(item.id) + '\" data-photo-index=\"' + idx + '\" aria-label=\"Изменить\">';
    imgBlock += '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\"/><path d=\"M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\"/></svg>';
    imgBlock += '</button></div>';
  }
  imgBlock += '</div>';
  imgBlock += '<label class=\"photo-add-card preset-edit-photo-card photo-add-inline\" for=\"' + inputId + '\">';
  imgBlock += '<input type=\"file\" class=\"photo-add-input portfolio-edit-image-input\" id=\"' + inputId + '\" accept=\"image/*\" data-portfolio-id=\"' + escapeAttr(item.id) + '\" />';
  imgBlock += '<span class=\"photo-add-icon\"></span>';
  imgBlock += '<span class=\"photo-add-text\">Добавить фото</span>';
  imgBlock += '</label></div>';

  var html = '<article class=\"preset-edit-card\" data-portfolio-id=\"' + escapeAttr(item.id) + '\">';
  html += '<label class=\"form-label\">Название</label>';
  html += '<input class=\"form-input portfolio-edit-title\" value=\"' + escapeAttr(item.title) + '\" data-portfolio-id=\"' + escapeAttr(item.id) + '\" />';
  html += '<h3 class=\"photo-section-title preset-edit-photo-title\">Фотографии</h3>';
  html += '<div class=\"preset-edit-image-wrap\">' + imgBlock + '</div>';
  html += '<label class=\"form-label\">Описание</label>';
  html += '<textarea class=\"form-textarea form-textarea-sm portfolio-edit-desc\" data-portfolio-id=\"' + escapeAttr(item.id) + '\">' + escapeAttr(item.description) + '</textarea>';
  html += '<div class=\"preset-edit-actions\">';
  html += '<button type=\"button\" class=\"submit-btn preset-save-btn portfolio-save-btn\" data-portfolio-id=\"' + escapeAttr(item.id) + '\">Сохранить изменения</button>';
  html += '<button type=\"button\" class=\"preset-delete-btn portfolio-delete-btn\" data-portfolio-id=\"' + escapeAttr(item.id) + '\">Удалить</button>';
  html += '</div></article>';
  return html;
}

var editPortfolioImages = {};
var replacePortfolioEditIndex = null;
var replacePortfolioEditId = null;

async function loadOwnerEditPortfolio() {
  var listEl = document.getElementById('owner-portfolio-list');
  if (!listEl) return;
  listEl.innerHTML = loadingOwnerHtml;
  var items = await fetchPortfolio();
  if (!items.length) {
    listEl.innerHTML = '<p class=\"consult-text\">Нет работ. Создайте новую в разделе «Создать новую работу».</p>';
    return;
  }
  editPortfolioImages = {};
  items.forEach(function (it) {
    editPortfolioImages[String(it.id)] = it.images || (it.image ? [it.image] : []);
  });
  listEl.innerHTML = items.map(renderOwnerPortfolioEditCard).join('');

  listEl.querySelectorAll('.portfolio-edit-image-input').forEach(function (input) {
    input.addEventListener('change', function () {
      var pid = this.getAttribute('data-portfolio-id');
      if (!pid || !this.files || !this.files[0]) return;
      var file = this.files[0];
      compressImageFile(file, 1280, 0.8).then(function (dataUrl) {
        var imgs = editPortfolioImages[pid] || [];
        var idx = replacePortfolioEditIndex;
        var replacePid = replacePortfolioEditId;
        replacePortfolioEditIndex = null;
        replacePortfolioEditId = null;

        if (typeof idx === 'number' && idx >= 0 && replacePid === pid && imgs[idx] !== undefined) {
          imgs[idx] = dataUrl;
          var card = listEl.querySelector('.preset-edit-preview-list[data-portfolio-id=\"' + pid.replace(/\"/g, '\\\\\"') + '\"] .photo-preview-card[data-photo-index=\"' + idx + '\"]');
          if (card) {
            var imgEl = card.querySelector('img');
            if (imgEl) imgEl.src = dataUrl;
          }
        } else {
          imgs.push(dataUrl);
          var list = listEl.querySelector('.preset-edit-preview-list[data-portfolio-id=\"' + pid.replace(/\"/g, '\\\\\"') + '\"]');
          if (list) {
            var newIdx = imgs.length - 1;
            var div = document.createElement('div');
            div.className = 'photo-preview-card';
            div.setAttribute('data-photo-index', String(newIdx));
            var img = document.createElement('img');
            img.src = dataUrl;
            img.alt = '';
            div.appendChild(img);
            if (newIdx === 0) {
              var badge = document.createElement('span');
              badge.className = 'photo-preview-badge';
              badge.textContent = 'Главная';
              div.appendChild(badge);
            }
            var editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'photo-preview-edit portfolio-edit-photo-replace';
            editBtn.setAttribute('data-portfolio-id', pid);
            editBtn.setAttribute('data-photo-index', String(newIdx));
            editBtn.setAttribute('aria-label', 'Изменить');
            editBtn.innerHTML = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\"/><path d=\"M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\"/></svg>';
            div.appendChild(editBtn);
            list.appendChild(div);
            editBtn.addEventListener('click', function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              replacePortfolioEditIndex = parseInt(this.getAttribute('data-photo-index'), 10);
              replacePortfolioEditId = this.getAttribute('data-portfolio-id');
              input.click();
            });
          }
        }
        editPortfolioImages[pid] = imgs;
      });
      this.value = '';
    });
  });

  listEl.querySelectorAll('.portfolio-edit-photo-replace').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var pid = this.getAttribute('data-portfolio-id');
      replacePortfolioEditIndex = parseInt(this.getAttribute('data-photo-index'), 10);
      replacePortfolioEditId = pid;
      var inp = document.getElementById('portfolio-edit-image-' + pid);
      if (inp) inp.click();
    });
  });

  listEl.querySelectorAll('.portfolio-save-btn').forEach(function (btn) {
    btn.addEventListener('click', async function (e) {
      e.stopPropagation();
      if (!tg || !currentUser) return;
      var id = btn.getAttribute('data-portfolio-id');
      var card = listEl.querySelector('.preset-edit-card[data-portfolio-id=\"' + id + '\"]');
      if (!card) return;
      var titleEl = card.querySelector('.portfolio-edit-title');
      var descEl = card.querySelector('.portfolio-edit-desc');
      var title = (titleEl && titleEl.value || '').trim();
      var description = (descEl && descEl.value || '').trim();
      if (!title) {
        tg.showPopup({ title: 'Ошибка', message: 'Заполните название.', buttons: [{ type: 'ok' }] });
        return;
      }
      var imgs = editPortfolioImages[id] || [];
      var payload = { userId: currentUser.id, id: id, title: title, description: description, images: imgs };
      btn.disabled = true;
      btn.textContent = 'Сохранение...';
      try {
        var res = await fetch('/api/portfolio/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (data && data.ok) {
          await loadOwnerEditPortfolio();
          tg.showPopup({ title: 'Готово', message: 'Изменения сохранены.', buttons: [{ type: 'ok' }] });
        } else {
          tg.showPopup({ title: 'Ошибка', message: 'Не удалось сохранить.', buttons: [{ type: 'ok' }] });
        }
      } catch (_) {
        tg.showPopup({ title: 'Ошибка', message: 'Не удалось сохранить.', buttons: [{ type: 'ok' }] });
      } finally {
        btn.disabled = false;
        btn.textContent = 'Сохранить изменения';
      }
    });
  });

  listEl.querySelectorAll('.portfolio-delete-btn').forEach(function (btn) {
    btn.addEventListener('click', async function (e) {
      e.stopPropagation();
      if (!tg || !currentUser) return;
      if (!confirm('Вы точно хотите удалить работу?')) return;
      var id = btn.getAttribute('data-portfolio-id');
      try {
        var res = await fetch('/api/portfolio/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUser.id, id: id })
        });
        var data = await res.json();
        if (data && data.ok) {
          await loadOwnerEditPortfolio();
        } else {
          tg.showPopup({ title: 'Ошибка', message: 'Не удалось удалить работу.', buttons: [{ type: 'ok' }] });
        }
      } catch (_) {
        tg.showPopup({ title: 'Ошибка', message: 'Не удалось удалить работу.', buttons: [{ type: 'ok' }] });
      }
    });
  });
}

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function (e) { reject(e); };
    reader.readAsDataURL(file);
  });
}

// Сжатие изображений перед загрузкой (уменьшаем размер, оставляя приемлемое качество)
function compressImageFile(file, maxSize, quality) {
  maxSize = maxSize || 1280;
  quality = quality || 0.8;
  return new Promise(function (resolve, reject) {
    readFileAsDataUrl(file).then(function (dataUrl) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.width;
          var h = img.height;
          if (!w || !h) {
            return resolve(dataUrl);
          }
          var scale = 1;
          if (w > h && w > maxSize) scale = maxSize / w;
          else if (h >= w && h > maxSize) scale = maxSize / h;
          if (scale >= 1) {
            return resolve(dataUrl);
          }
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          try {
            var compressed = canvas.toDataURL('image/jpeg', quality);
            resolve(compressed && compressed.length < dataUrl.length ? compressed : dataUrl);
          } catch (e) {
            resolve(dataUrl);
          }
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = function (e) { reject(e); };
      img.src = dataUrl;
    }).catch(reject);
  });
}

if (isOwnerApp) {
  function createStep1Next() {
    var titleEl = document.getElementById('create-step-title');
    var errEl = document.getElementById('create-step-title-error');
    var v = (titleEl && titleEl.value || '').trim();
    if (!v) {
      if (titleEl) titleEl.classList.add('form-input-error');
      if (errEl) errEl.textContent = 'Заполните поле.';
      return;
    }
    if (titleEl) titleEl.classList.remove('form-input-error');
    if (errEl) errEl.textContent = '';
    createDraft.title = v;
    showView('view-owner-create-2', 'right');
    var d = document.getElementById('create-step-desc');
    if (d) d.value = createDraft.description || '';
  }
  function createStep2Next() {
    var descEl = document.getElementById('create-step-desc');
    var errEl = document.getElementById('create-step-desc-error');
    var v = (descEl && descEl.value || '').trim();
    if (!v) {
      if (descEl) descEl.classList.add('form-textarea-error');
      if (errEl) errEl.textContent = 'Заполните поле.';
      return;
    }
    if (descEl) descEl.classList.remove('form-textarea-error');
    if (errEl) errEl.textContent = '';
    createDraft.description = v;
    showView('view-owner-create-3', 'right');
    var p = document.getElementById('create-step-price');
    if (p) p.value = createDraft.price || '';
    var a = document.getElementById('create-step-avito');
    if (a) a.value = createDraft.avitoLink || '';
  }
  var replacePhotoIndex = null;

  function renderCreateStep4Gallery() {
    var listEl = document.getElementById('create-step-preview-list');
    var wrap = document.getElementById('create-step-image-wrap');
    if (!listEl || !wrap) return;
    var imgs = createDraft.images || [];
    var html = '';
    for (var idx = 0; idx < imgs.length; idx++) {
      html += '<div class=\"photo-preview-card\" data-photo-index=\"' + idx + '\">';
      html += '<img src=\"' + escapeAttr(imgs[idx]) + '\" alt=\"\" />';
      if (idx === 0) html += '<span class=\"photo-preview-badge\">Главная</span>';
      html += '<button type=\"button\" class=\"photo-preview-edit\" data-photo-index=\"' + idx + '\" aria-label=\"Изменить фото\">';
      html += '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\"/><path d=\"M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\"/></svg>';
      html += '</button></div>';
    }
    listEl.innerHTML = html;
    listEl.querySelectorAll('.photo-preview-edit').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        replacePhotoIndex = parseInt(btn.getAttribute('data-photo-index'), 10);
        document.getElementById('create-step-image').click();
      });
    });
    wrap.classList.toggle('photo-add-inline', imgs.length > 0);
  }

  function createStep3Next() {
    var priceEl = document.getElementById('create-step-price');
    var v = (priceEl && priceEl.value || '').trim();
    createDraft.price = v;
    var avitoEl = document.getElementById('create-step-avito');
    var avitoV = (avitoEl && avitoEl.value || '').trim();
    createDraft.avitoLink = avitoV;
    showView('view-owner-create-4', 'right');
    renderCreateStep4Gallery();
  }
  function createStep4Next() {
    var wrap = document.getElementById('create-step-image-wrap');
    var errEl = document.getElementById('create-step-image-error');
    if (errEl) errEl.textContent = '';
    if (wrap) wrap.classList.remove('form-input-error');
    var imgs = createDraft.images || [];
    if (!imgs.length) {
      if (wrap) wrap.classList.add('form-input-error');
      if (errEl) errEl.textContent = 'Добавьте хотя бы одно фото.';
      return;
    }
    createDraft.image = imgs[0];
    goToCreateStep5();
  }
  function goToCreateStep5() {
    var titleEl = document.getElementById('review-title');
    var descEl = document.getElementById('review-desc');
    var priceEl = document.getElementById('review-price');
    var photoEl = document.getElementById('review-photo');
    var avitoEl = document.getElementById('review-avito');
    if (titleEl) titleEl.textContent = createDraft.title || '—';
    if (descEl) descEl.textContent = (createDraft.description || '—').slice(0, 200) + (createDraft.description && createDraft.description.length > 200 ? '…' : '');
    if (priceEl) priceEl.textContent = createDraft.price || '—';
    if (avitoEl) avitoEl.textContent = createDraft.avitoLink ? (String(createDraft.avitoLink).slice(0, 50) + (String(createDraft.avitoLink).length > 50 ? '…' : '')) : '—';
    if (photoEl) photoEl.textContent = (createDraft.images && createDraft.images.length) ? 'Добавлено ' + createDraft.images.length + ' фото' : 'Нет';
    showView('view-owner-create-5', 'right');
  }
  var createImageInput = document.getElementById('create-step-image');
  if (createImageInput) {
    createImageInput.addEventListener('change', function () {
      var wrap = document.getElementById('create-step-image-wrap');
      var errEl = document.getElementById('create-step-image-error');
      if (!this.files || !this.files[0]) return;
      var file = this.files[0];
      compressImageFile(file, 1280, 0.8).then(function (dataUrl) {
        if (errEl) errEl.textContent = '';
        if (wrap) wrap.classList.remove('form-input-error');
        var idx = replacePhotoIndex;
        replacePhotoIndex = null;
        if (typeof idx === 'number' && idx >= 0 && createDraft.images && createDraft.images[idx] !== undefined) {
          createDraft.images[idx] = dataUrl;
        } else {
          if (!createDraft.images) createDraft.images = [];
          createDraft.images.push(dataUrl);
        }
        renderCreateStep4Gallery();
      }).catch(function () {
        if (wrap) wrap.classList.add('form-input-error');
        if (errEl) errEl.textContent = 'Не удалось прочитать файл.';
      });
      this.value = '';
    });
  }

  document.getElementById('create-step-1-next')?.addEventListener('click', createStep1Next);
  document.getElementById('create-step-2-next')?.addEventListener('click', createStep2Next);
  document.getElementById('create-step-3-next')?.addEventListener('click', createStep3Next);
  document.getElementById('create-step-4-next')?.addEventListener('click', createStep4Next);

  var publishBtn = document.getElementById('create-step-5-publish');
  if (publishBtn) {
    publishBtn.addEventListener('click', async function () {
      if (!tg || !currentUser) return;
      publishBtn.disabled = true;
      publishBtn.textContent = 'Публикация...';
      try {
        var priceFormatted = formatPriceWithRub(createDraft.price);
        var imgs = createDraft.images || [];
        var mainImage = imgs.length ? imgs[0] : (createDraft.image || '');
        var res = await fetch('/api/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUser.id,
            title: createDraft.title,
            price: priceFormatted,
            image: mainImage,
            images: imgs,
            description: createDraft.description,
            avitoLink: createDraft.avitoLink
          })
        });
        var data = null;
        try {
          data = await res.json();
        } catch (_) {
          data = { ok: false };
        }
        if (res.status === 413) {
          tg.showPopup({ title: 'Ошибка', message: 'Фото слишком большое. Выберите изображение до 2–3 МБ.', buttons: [{ type: 'ok' }] });
        } else if (!data || !data.ok) {
          var msg = 'Не удалось сохранить предложение.';
          if (res.status === 403) msg = 'Нет доступа. Войдите как владелец.';
          else if (res.status === 400) msg = 'Заполните название объявления.';
          tg.showPopup({ title: 'Ошибка', message: msg, buttons: [{ type: 'ok' }] });
        } else {
          createDraft = { title: '', description: '', price: '', avitoLink: '', image: '', images: [] };
          showView('view-owner-presets-ready');
          tg.showPopup({ title: 'Готово', message: 'Объявление опубликовано.', buttons: [{ type: 'ok' }] });
        }
      } catch (e) {
        tg.showPopup({ title: 'Ошибка', message: 'Нет связи или сервер недоступен. Проверьте интернет.', buttons: [{ type: 'ok' }] });
      } finally {
        publishBtn.disabled = false;
        publishBtn.textContent = 'Опубликовать';
      }
    });
  }

  // ----- Портфолио: создание -----
  var portfolioReplaceIndex = null;

  function renderPortfolioStep3Gallery() {
    var listEl = document.getElementById('portfolio-step-preview-list');
    var wrap = document.getElementById('portfolio-step-image-wrap');
    if (!listEl || !wrap) return;
    var imgs = portfolioDraft.images || [];
    var html = '';
    for (var idx = 0; idx < imgs.length; idx++) {
      html += '<div class=\"photo-preview-card\" data-photo-index=\"' + idx + '\">';
      html += '<img src=\"' + escapeAttr(imgs[idx]) + '\" alt=\"\" />';
      if (idx === 0) html += '<span class=\"photo-preview-badge\">Главная</span>';
      html += '<button type=\"button\" class=\"photo-preview-edit\" data-photo-index=\"' + idx + '\" aria-label=\"Изменить фото\">';
      html += '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\"/><path d=\"M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\"/></svg>';
      html += '</button></div>';
    }
    listEl.innerHTML = html;
    listEl.querySelectorAll('.photo-preview-edit').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        portfolioReplaceIndex = parseInt(btn.getAttribute('data-photo-index'), 10);
        document.getElementById('portfolio-step-image').click();
      });
    });
    wrap.classList.toggle('photo-add-inline', imgs.length > 0);
  }

  function portfolioStep1Next() {
    var titleEl = document.getElementById('portfolio-step-title');
    var errEl = document.getElementById('portfolio-step-title-error');
    var v = (titleEl && titleEl.value || '').trim();
    if (!v) {
      if (titleEl) titleEl.classList.add('form-input-error');
      if (errEl) errEl.textContent = 'Заполните поле.';
      return;
    }
    if (titleEl) titleEl.classList.remove('form-input-error');
    if (errEl) errEl.textContent = '';
    portfolioDraft.title = v;
    showView('view-portfolio-create-2', 'right');
    var d = document.getElementById('portfolio-step-desc');
    if (d) d.value = portfolioDraft.description || '';
  }

  function portfolioStep2Next() {
    var descEl = document.getElementById('portfolio-step-desc');
    var errEl = document.getElementById('portfolio-step-desc-error');
    var v = (descEl && descEl.value || '').trim();
    if (!v) {
      if (descEl) descEl.classList.add('form-textarea-error');
      if (errEl) errEl.textContent = 'Заполните поле.';
      return;
    }
    if (descEl) descEl.classList.remove('form-textarea-error');
    if (errEl) errEl.textContent = '';
    portfolioDraft.description = v;
    showView('view-portfolio-create-3', 'right');
    renderPortfolioStep3Gallery();
  }

  function portfolioStep3Next() {
    var wrap = document.getElementById('portfolio-step-image-wrap');
    var errEl = document.getElementById('portfolio-step-image-error');
    if (errEl) errEl.textContent = '';
    if (wrap) wrap.classList.remove('form-input-error');
    var imgs = portfolioDraft.images || [];
    if (!imgs.length) {
      if (wrap) wrap.classList.add('form-input-error');
      if (errEl) errEl.textContent = 'Добавьте хотя бы одно фото.';
      return;
    }
    var titleEl = document.getElementById('portfolio-review-title');
    var descEl = document.getElementById('portfolio-review-desc');
    var photoEl = document.getElementById('portfolio-review-photo');
    if (titleEl) titleEl.textContent = portfolioDraft.title || '—';
    if (descEl) descEl.textContent = (portfolioDraft.description || '—').slice(0, 200) + (portfolioDraft.description && portfolioDraft.description.length > 200 ? '…' : '');
    if (photoEl) photoEl.textContent = imgs.length ? ('Добавлено ' + imgs.length + ' фото') : 'Нет';
    showView('view-portfolio-create-4', 'right');
  }

  var portfolioImageInput = document.getElementById('portfolio-step-image');
  if (portfolioImageInput) {
    portfolioImageInput.addEventListener('change', function () {
      var wrap = document.getElementById('portfolio-step-image-wrap');
      var errEl = document.getElementById('portfolio-step-image-error');
      if (!this.files || !this.files[0]) return;
      var file = this.files[0];
      compressImageFile(file, 1280, 0.8).then(function (dataUrl) {
        if (errEl) errEl.textContent = '';
        if (wrap) wrap.classList.remove('form-input-error');
        var idx = portfolioReplaceIndex;
        portfolioReplaceIndex = null;
        if (!portfolioDraft.images) portfolioDraft.images = [];
        if (typeof idx === 'number' && idx >= 0 && portfolioDraft.images[idx] !== undefined) portfolioDraft.images[idx] = dataUrl;
        else portfolioDraft.images.push(dataUrl);
        renderPortfolioStep3Gallery();
      }).catch(function () {
        if (wrap) wrap.classList.add('form-input-error');
        if (errEl) errEl.textContent = 'Не удалось прочитать файл.';
      });
      this.value = '';
    });
  }

  document.getElementById('portfolio-step-1-next')?.addEventListener('click', portfolioStep1Next);
  document.getElementById('portfolio-step-2-next')?.addEventListener('click', portfolioStep2Next);
  document.getElementById('portfolio-step-3-next')?.addEventListener('click', portfolioStep3Next);

  var portfolioPublishBtn = document.getElementById('portfolio-step-4-publish');
  if (portfolioPublishBtn) {
    portfolioPublishBtn.addEventListener('click', async function () {
      if (!tg || !currentUser) return;
      portfolioPublishBtn.disabled = true;
      portfolioPublishBtn.textContent = 'Публикация...';
      try {
        var imgs = portfolioDraft.images || [];
        var res = await fetch('/api/portfolio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUser.id,
            title: portfolioDraft.title,
            description: portfolioDraft.description,
            images: imgs
          })
        });
        var data = null;
        try { data = await res.json(); } catch (_) { data = { ok: false }; }
        if (res.status === 413) {
          tg.showPopup({ title: 'Ошибка', message: 'Фото слишком большое. Выберите изображение до 2–3 МБ.', buttons: [{ type: 'ok' }] });
        } else if (!data || !data.ok) {
          var msg = 'Не удалось сохранить работу.';
          if (res.status === 403) msg = 'Нет доступа. Войдите как владелец.';
          else if (res.status === 400) msg = 'Заполните название.';
          tg.showPopup({ title: 'Ошибка', message: msg, buttons: [{ type: 'ok' }] });
        } else {
          portfolioDraft = { title: '', description: '', images: [] };
          showView('view-owner-portfolio');
          tg.showPopup({ title: 'Готово', message: 'Работа опубликована.', buttons: [{ type: 'ok' }] });
        }
      } catch (_) {
        tg.showPopup({ title: 'Ошибка', message: 'Нет связи или сервер недоступен. Проверьте интернет.', buttons: [{ type: 'ok' }] });
      } finally {
        portfolioPublishBtn.disabled = false;
        portfolioPublishBtn.textContent = 'Опубликовать';
      }
    });
  }
}

document.querySelectorAll('.service-card').forEach((card) => {
  card.addEventListener('click', () => {
    const action = card.dataset.action;
    const label = card.querySelector('.service-title')?.textContent?.trim() || 'Услуга';
    const desc = card.querySelector('.service-desc')?.textContent?.trim();
    const fullLabel = desc ? `${label} — ${desc}` : label;
    sendActionToBot(action, fullLabel);
  });
});

(function reportLoad(){
  if(!window.__diag)return;
  window.__diag.t3=Date.now();
  var d=window.__diag, total=d.t3-d.t0, toScript=d.t1-d.t0, toReady=(d.t2?d.t2-d.t0:0), toInit=d.t3-d.t1;
  if(total>2000){
    var msg='Диагностика: всего '+Math.round(total/1000*10)/10+'с (до скрипта: '+Math.round(toScript)+'мс, до ready: '+(d.t2?Math.round(toReady)+'мс':'?')+', инициализация: '+Math.round(toInit)+'мс)';
    try{
      var div=document.createElement('div');
      div.style.cssText='position:fixed;bottom:12px;left:12px;right:12px;padding:12px;background:#333;color:#fff;font-size:12px;border-radius:8px;z-index:99999;';
      div.textContent=msg;
      div.id='load-diag-banner';
      document.body.appendChild(div);
      setTimeout(function(){var el=document.getElementById('load-diag-banner');if(el)el.remove();},8000);
    }catch(_){}
    try{navigator.sendBeacon && navigator.sendBeacon('/api/load-report?t='+total+'&s='+toScript+'&r='+toReady+'&i='+toInit);}catch(_){}
  }
})();