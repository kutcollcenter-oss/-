/* Юрта — живой чат гость ↔ сотрудник, уведомления и пульт сотрудника */
(() => {
  const VIEW_DELAY = 3000; // через сколько мс просмотра квартиры уведомлять сотрудников
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const som = (v) => (window.YurtaApp ? window.YurtaApp.som(v) : v + ' сом');
  const time = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'только что' : s < 3600 ? `${Math.round(s / 60)} мин назад` : s < 86400 ? `${Math.round(s / 3600)} ч назад` : new Date(t).toLocaleDateString('ru-RU'); };
  async function api(path, data, method) {
    const opt = data !== undefined ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : { method: method || 'GET' };
    const r = await fetch(path, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Ошибка');
    return j;
  }
  function viewText(v) {
    if (!v || !v.project) return 'на главной';
    let s = v.project;
    if (v.block) s += ` · блок ${v.block}`;
    if (v.floor) s += ` · ${v.floor} эт.`;
    if (v.apt) s += ` · кв. ${v.apt}`;
    return s;
  }
  function viewDetails(v) { return v && v.apt ? `${v.rooms}, ${String(v.area).replace('.', ',')} м² · ${som(v.price)}` : ''; }
  function beep() {
    try {
      const ac = beep.ac || (beep.ac = new (window.AudioContext || window.webkitAudioContext)());
      [880, 1320].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = f; o.connect(g); g.connect(ac.destination);
        const t = ac.currentTime + i * 0.14;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.start(t); o.stop(t + 0.25);
      });
    } catch (e) {}
  }

  let me = null;          // сотрудник, если вошёл
  let route = {};         // что сейчас открыто на сайте

  /* =================== ГОСТЬ =================== */
  let gid = null;
  try { gid = localStorage.getItem('yurta_gid'); } catch (e) {}
  if (!gid || !/^[a-zA-Z0-9-]{8,64}$/.test(gid)) {
    gid = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    try { localStorage.setItem('yurta_gid', gid); } catch (e) {}
  }
  const guest = { open: false, messages: [], assignedName: '', staffOnline: 0, es: null, viewTimer: 0, unread: 0, askedContact: false };

  const gBtn = h('button', 'chat-fab'); gBtn.setAttribute('aria-label', 'Чат с менеджером');
  gBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg><span>Вопрос менеджеру</span><b class="badge" hidden></b>';
  const gPanel = h('section', 'chat-panel'); gPanel.hidden = true;
  gPanel.innerHTML = `
    <header><div class="who"><span class="dot"></span><div><b>Менеджер</b><small></small></div></div><button class="x" aria-label="Свернуть">✕</button></header>
    <div class="ctx" hidden></div>
    <div class="msgs"></div>
    <form class="contact" hidden><div class="small">Как с вами связаться, если вы уйдёте с сайта?</div><input name="name" placeholder="Имя" autocomplete="name" maxlength="60"><input name="phone" placeholder="Телефон / WhatsApp" type="tel" autocomplete="tel" maxlength="30"><div class="row"><button type="submit">Сохранить</button><button type="button" class="skip">Позже</button></div></form>
    <form class="send"><textarea rows="1" placeholder="Напишите вопрос…" maxlength="2000"></textarea><button type="submit" aria-label="Отправить">➤</button></form>`;
  document.body.append(gBtn, gPanel);
  const gMsgs = $('.msgs', gPanel), gInput = $('.send textarea', gPanel);

  function guestHeader() {
    $('.who b', gPanel).textContent = guest.assignedName || 'Менеджер';
    $('.who small', gPanel).textContent = guest.staffOnline ? 'в сети — ответим за пару минут' : 'оставьте вопрос — ответим как можно скорее';
    $('.dot', gPanel).classList.toggle('on', guest.staffOnline > 0);
    const c = $('.ctx', gPanel);
    if (route.apt) { c.hidden = false; c.textContent = `Вы смотрите: ${viewText(route)}`; } else c.hidden = true;
  }
  function renderGuestMsgs() {
    gMsgs.innerHTML = '';
    if (!guest.messages.length) {
      const w = h('div', 'msg staff'); w.append(h('div', 'bubble', 'Здравствуйте! Подскажем по любой квартире, рассрочке и срокам сдачи. Задайте вопрос 👇'));
      gMsgs.append(w);
    }
    for (const m of guest.messages) gMsgs.append(msgEl(m, m.from === 'guest'));
    gMsgs.scrollTop = gMsgs.scrollHeight;
  }
  function msgEl(m, mine) {
    const w = h('div', 'msg ' + (mine ? 'mine' : 'staff'));
    if (!mine && m.from === 'staff' && m.staffName) w.append(h('div', 'name', m.staffName));
    if (m.from === 'guest' && !mine) w.append(h('div', 'name', 'Гость'));
    w.append(h('div', 'bubble', m.text), h('div', 'time', time(m.at)));
    return w;
  }
  function setGuestOpen(v) {
    guest.open = v; gPanel.hidden = !v; gBtn.classList.toggle('active', v);
    if (v) { guest.unread = 0; updateBadge(); guestHeader(); renderGuestMsgs(); setTimeout(() => gInput.focus(), 50); }
  }
  function updateBadge() { const b = $('.badge', gBtn); b.hidden = !guest.unread; b.textContent = guest.unread; }
  gBtn.onclick = () => setGuestOpen(!guest.open);
  $('.x', gPanel).onclick = () => setGuestOpen(false);
  gInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('.send', gPanel).requestSubmit(); } });
  $('.send', gPanel).onsubmit = async (e) => {
    e.preventDefault();
    const text = gInput.value.trim(); if (!text) return;
    gInput.value = '';
    try {
      const r = await api('/api/guest/message', { gid, text, view: { hash: route.hash } });
      if (!guest.messages.some((m) => m.id === r.message.id)) guest.messages.push(r.message);
      renderGuestMsgs();
      if (!guest.askedContact) { guest.askedContact = true; $('.contact', gPanel).hidden = false; }
    } catch (err) { gInput.value = text; alert(err.message); }
  };
  $('.contact', gPanel).onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try { await api('/api/guest/contact', { gid, name: fd.get('name'), phone: fd.get('phone') }); } catch (err) {}
    e.target.hidden = true;
  };
  $('.contact .skip', gPanel).onclick = () => { $('.contact', gPanel).hidden = true; };

  function connectGuest() {
    if (guest.es) return;
    api('/api/guest/messages?gid=' + encodeURIComponent(gid)).then((r) => {
      guest.messages = r.messages; guest.assignedName = r.assignedName; guest.staffOnline = r.staffOnline;
      guest.askedContact = r.messages.some((m) => m.from === 'guest');
      if (guest.open) renderGuestMsgs(); guestHeader();
    }).catch(() => {});
    const es = new EventSource('/api/guest/stream?gid=' + encodeURIComponent(gid));
    guest.es = es;
    es.addEventListener('hello', (e) => { const d = JSON.parse(e.data); guest.staffOnline = d.staffOnline; if (d.assignedName) guest.assignedName = d.assignedName; guestHeader(); });
    es.addEventListener('assigned', (e) => { guest.assignedName = JSON.parse(e.data).name; guestHeader(); });
    es.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (guest.messages.some((x) => x.id === m.id)) return;
      guest.messages.push(m);
      if (m.from === 'staff') {
        if (!guest.open) { setGuestOpen(true); beep(); } // менеджер написал — чат открывается сам
        else renderGuestMsgs();
      }
    });
  }
  function disconnectGuest() { if (guest.es) { guest.es.close(); guest.es = null; } }

  // Гость смотрит одну квартиру дольше 3 секунд → сигнал сотрудникам
  window.addEventListener('yurta:route', (e) => {
    route = e.detail || {};
    clearTimeout(guest.viewTimer);
    if (guest.open) guestHeader();
    if (me) { staffOnRoute(); return; }
    if (route.apt && route.status !== 'sold') {
      guest.viewTimer = setTimeout(() => {
        if (document.hidden) return;
        api('/api/guest/view', { gid, view: route }).catch(() => {});
      }, VIEW_DELAY);
    }
  });

  /* =================== СОТРУДНИК =================== */
  const staff = { es: null, chats: new Map(), openGid: null, tab: 'live', staffOnline: [], dockOpen: true };
  const loginBtn = h('button', 'staff-login');
  loginBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span>Сотрудникам</span>';
  $('.topbar').append(loginBtn);
  // Кнопка скрыта от гостей. Открыть: ссылка сайта с ?staff (браузер запомнит), выйти из режима: ?staff=off
  let staffDevice = false;
  try {
    const q = new URLSearchParams(location.search).get('staff');
    if (q === 'off') localStorage.removeItem('yurta_staff_device'); else if (q !== null) localStorage.setItem('yurta_staff_device', '1');
    staffDevice = localStorage.getItem('yurta_staff_device') === '1';
  } catch (e) {}
  loginBtn.hidden = !staffDevice;

  const overlay = h('div', 'yc-modal'); overlay.hidden = true;
  overlay.innerHTML = '<div class="yc-backdrop"></div><div class="yc-card"></div>';
  document.body.append(overlay);
  const card = $('.yc-card', overlay);
  function modal(html) { card.innerHTML = '<button class="yc-close" aria-label="Закрыть">✕</button>' + html; overlay.hidden = false; $('.yc-close', card).onclick = closeModal; return card; }
  function closeModal() { overlay.hidden = true; card.innerHTML = ''; }
  $('.yc-backdrop', overlay).onclick = closeModal;

  loginBtn.onclick = () => {
    if (me) { setDock(!staff.dockOpen); return; }
    const c = modal(`<h2>Вход для сотрудников</h2>
      <form class="yc-form"><label>Логин<input name="login" autocomplete="username" required></label>
      <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="yc-err" hidden></div><button class="yc-btn" type="submit">Войти</button></form>`);
    $('input', c).focus();
    $('form', c).onsubmit = async (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (err) {}
      try { const r = await api('/api/login', { login: fd.get('login'), password: fd.get('password') }); closeModal(); startStaff(r.user); }
      catch (err) { const el = $('.yc-err', c); el.hidden = false; el.textContent = err.message; }
    };
  };

  const dock = h('aside', 'staff-dock'); dock.hidden = true;
  dock.innerHTML = `
    <header><div><b class="me-name"></b><small class="online"></small></div>
      <div class="acts"><button class="adm" title="Сотрудники" hidden>👥</button><button class="pw" title="Сменить пароль">🔑</button><button class="out" title="Выйти">⎋</button><button class="hide" title="Свернуть">✕</button></div></header>
    <nav><button data-tab="live" class="on">Смотрят сейчас <b class="n-live"></b></button><button data-tab="chats">Чаты <b class="n-unread"></b></button></nav>
    <div class="list"></div>
    <div class="conv" hidden>
      <div class="conv-head"><button class="back">‹</button><div><b class="g-name"></b><small class="g-view"></small></div><button class="open-apt" title="Открыть то же, что смотрит гость">Открыть</button></div>
      <div class="views"></div>
      <div class="msgs"></div>
      <div class="quick"></div>
      <form class="send"><textarea rows="1" placeholder="Ответ гостю…" maxlength="2000"></textarea><button type="submit">➤</button></form>
    </div>`;
  const toasts = h('div', 'staff-toasts');
  document.body.append(dock, toasts);

  function setDock(v) { staff.dockOpen = v; dock.hidden = !v; document.body.classList.toggle('dock-open', v); }
  $('.hide', dock).onclick = () => setDock(false);
  $('.out', dock).onclick = async () => { await api('/api/logout', {}).catch(() => {}); location.reload(); };
  $('.pw', dock).onclick = () => {
    const c = modal(`<h2>Смена пароля</h2><form class="yc-form"><label>Текущий пароль<input name="old" type="password" required autocomplete="current-password"></label><label>Новый пароль (мин. 6 символов)<input name="password" type="password" minlength="6" required autocomplete="new-password"></label><div class="yc-err" hidden></div><button class="yc-btn">Сохранить</button></form>`);
    $('form', c).onsubmit = async (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      try { await api('/api/me/password', { old: fd.get('old'), password: fd.get('password') }); card.innerHTML = '<h2>Пароль изменён ✓</h2><button class="yc-btn">Готово</button>'; $('.yc-btn', card).onclick = closeModal; }
      catch (err) { const el = $('.yc-err', c); el.hidden = false; el.textContent = err.message; }
    };
  };
  $('.adm', dock).onclick = openAdmin;
  dock.querySelectorAll('nav button').forEach((b) => b.onclick = () => { staff.tab = b.dataset.tab; dock.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b)); closeConv(); renderList(); });
  $('.conv .back', dock).onclick = closeConv;
  const cInput = $('.conv textarea', dock);
  cInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('.conv .send', dock).requestSubmit(); } });
  $('.conv .send', dock).onsubmit = async (e) => {
    e.preventDefault(); const text = cInput.value.trim(); if (!text || !staff.openGid) return;
    cInput.value = '';
    try { await api(`/api/staff/chats/${staff.openGid}/message`, { text }); } catch (err) { cInput.value = text; alert(err.message); }
  };

  async function startStaff(user) {
    me = user;
    document.body.classList.add('is-staff');
    disconnectGuest(); gBtn.hidden = true; gPanel.hidden = true;
    loginBtn.hidden = false;
    try { localStorage.setItem('yurta_staff_device', '1'); } catch (e) {}
    loginBtn.querySelector('span').textContent = 'Пульт';
    $('.me-name', dock).textContent = me.name + (me.role === 'admin' ? ' · админ' : '');
    $('.adm', dock).hidden = me.role !== 'admin';
    setDock(true);
    const r = await api('/api/staff/chats').catch(() => ({ chats: [] }));
    r.chats.forEach((c) => staff.chats.set(c.gid, { ...c, messages: null }));
    staff.staffOnline = r.staffOnline || [];
    renderList(); updateCounts();
    const es = new EventSource('/api/staff/stream'); staff.es = es;
    es.addEventListener('hello', (e) => { staff.staffOnline = JSON.parse(e.data).staffOnline; updateCounts(); });
    es.addEventListener('staff', (e) => { staff.staffOnline = JSON.parse(e.data).staffOnline; updateCounts(); });
    es.addEventListener('view', (e) => {
      const d = JSON.parse(e.data); upsert(d.chat);
      toast(`👀 Гость смотрит ${viewText(d.view)}`, viewDetails(d.view), d.gid, d.chat.assignedName && d.chat.assignedTo !== me.id ? `ведёт ${d.chat.assignedName}` : '');
    });
    es.addEventListener('presence', (e) => { const d = JSON.parse(e.data); upsert(d.chat); });
    es.addEventListener('chat', (e) => upsert(JSON.parse(e.data).chat));
    es.addEventListener('message', (e) => {
      const d = JSON.parse(e.data); const c = upsert(d.chat);
      if (c.messages && !c.messages.some((m) => m.id === d.message.id)) c.messages.push(d.message);
      if (staff.openGid === d.gid) { renderConv(); if (d.message.from === 'guest') api(`/api/staff/chats/${d.gid}/read`, {}).catch(() => {}); }
      else if (d.message.from === 'guest') toast(`💬 ${d.chat.guestName || 'Гость'} пишет`, d.message.text, d.gid);
    });
  }
  function upsert(summary) {
    const old = staff.chats.get(summary.gid) || {};
    const c = { ...old, ...summary, messages: old.messages || null };
    staff.chats.set(summary.gid, c);
    renderList(); updateCounts();
    if (staff.openGid === c.gid) renderConvHead();
    return c;
  }
  function updateCounts() {
    const live = [...staff.chats.values()].filter((c) => c.online).length;
    const unread = [...staff.chats.values()].reduce((s, c) => s + (c.unreadStaff || 0), 0);
    $('.n-live', dock).textContent = live || '';
    $('.n-unread', dock).textContent = unread || '';
    $('.online', dock).textContent = `в сети сотрудников: ${staff.staffOnline.length}`;
    loginBtn.classList.toggle('alert', unread > 0);
  }
  function renderList() {
    const list = $('.list', dock); list.innerHTML = '';
    let items = [...staff.chats.values()];
    items = staff.tab === 'live' ? items.filter((c) => c.online).sort((a, b) => ((b.lastView && b.lastView.at) || 0) - ((a.lastView && a.lastView.at) || 0))
                                 : items.filter((c) => c.count > 0).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!items.length) { list.append(h('div', 'empty', staff.tab === 'live' ? 'Сейчас никто не смотрит квартиры. Как только гость задержится на квартире дольше 3 секунд — придёт уведомление.' : 'Пока нет переписок.')); return; }
    for (const c of items) {
      const it = h('button', 'item' + (c.unreadStaff ? ' unread' : ''));
      const top = h('div', 'top');
      top.append(h('b', '', c.guestName || 'Гость ' + c.gid.slice(0, 4).toUpperCase()), h('span', 'when', c.online ? '● онлайн' : ago(c.updatedAt)));
      it.append(top, h('div', 'what', viewText(c.lastView)));
      if (c.last) it.append(h('div', 'last', (c.last.from === 'staff' ? 'Вы: ' : '') + c.last.text));
      const meta = h('div', 'meta', c.assignedName ? `ведёт: ${c.assignedName}` : 'никто не взял');
      if (c.unreadStaff) meta.append(h('b', 'cnt', String(c.unreadStaff)));
      it.append(meta);
      it.onclick = () => openConv(c.gid);
      list.append(it);
    }
  }
  async function openConv(gid) {
    staff.openGid = gid; setDock(true);
    $('.list', dock).hidden = true; $('.conv', dock).hidden = false;
    const r = await api(`/api/staff/chats/${gid}`).catch(() => null);
    if (!r) return;
    const c = upsert(r.chat); c.messages = r.messages; c.views = r.views;
    renderConv();
    api(`/api/staff/chats/${gid}/read`, {}).catch(() => {});
    cInput.focus();
  }
  function closeConv() { staff.openGid = null; $('.conv', dock).hidden = true; $('.list', dock).hidden = false; renderList(); }
  function renderConvHead() {
    const c = staff.chats.get(staff.openGid); if (!c) return;
    $('.g-name', dock).textContent = (c.guestName || 'Гость ' + c.gid.slice(0, 4).toUpperCase()) + (c.guestPhone ? ' · ' + c.guestPhone : '') + (c.online ? ' ●' : '');
    $('.g-view', dock).textContent = 'Сейчас: ' + viewText(c.lastView) + (c.lastView && c.lastView.apt ? ' — ' + viewDetails(c.lastView) : '');
    $('.open-apt', dock).hidden = !(c.lastView && c.lastView.hash);
    $('.open-apt', dock).onclick = () => { if (c.lastView.hash) location.hash = c.lastView.hash; };
  }
  function renderConv() {
    const c = staff.chats.get(staff.openGid); if (!c) return;
    renderConvHead();
    const v = $('.views', dock); v.innerHTML = '';
    const views = (c.views || []).filter((x) => x.apt).slice(-4).reverse();
    if (views.length) { v.append(h('div', 'small', 'Смотрел квартиры:')); views.forEach((x) => { const b = h('button', 'vchip', `${x.project} · бл. ${x.block} · кв. ${x.apt}`); b.onclick = () => { location.hash = x.hash; }; v.append(b); }); }
    const box = $('.conv .msgs', dock); box.innerHTML = '';
    if (!(c.messages || []).length) box.append(h('div', 'empty', 'Напишите гостю первым — у него сразу откроется чат на сайте.'));
    for (const m of c.messages || []) box.append(msgEl(m, m.from === 'staff' && m.staffId === me.id));
    box.scrollTop = box.scrollHeight;
    const q = $('.quick', dock); q.innerHTML = '';
    const lv = c.lastView;
    const tpl = [
      lv && lv.apt ? `Здравствуйте! Вижу, вы смотрите ${lv.rooms.toLowerCase()} ${String(lv.area).replace('.', ',')} м² (кв. ${lv.apt}, блок ${lv.block}). Рассказать про рассрочку?` : 'Здравствуйте! Чем могу помочь с выбором квартиры?',
      'Могу забронировать эту квартиру за вами — оставьте, пожалуйста, номер телефона.',
      'Приглашаем на просмотр в офис продаж — когда вам удобно?',
    ];
    tpl.forEach((t) => { const b = h('button', 'qbtn', t.length > 46 ? t.slice(0, 44) + '…' : t); b.title = t; b.onclick = () => { cInput.value = t; cInput.focus(); }; q.append(b); });
  }
  function staffOnRoute() { /* сотрудник может свободно ходить по сайту — пульт остаётся открытым */ }

  function toast(title, text, gid, note) {
    beep();
    const t = h('div', 'toast');
    t.append(h('b', '', title));
    if (text) t.append(h('div', 'txt', text));
    if (note) t.append(h('div', 'note', note));
    const row = h('div', 'row'), go = h('button', 'go', 'Написать'), x = h('button', 'x', 'Скрыть');
    go.onclick = () => { openConv(gid); t.remove(); };
    x.onclick = () => t.remove();
    row.append(go, x); t.append(row);
    toasts.prepend(t);
    setTimeout(() => t.remove(), 20000);
    while (toasts.children.length > 4) toasts.lastChild.remove();
    try { if (document.hidden && window.Notification && Notification.permission === 'granted') { const n = new Notification(title, { body: text || '' }); n.onclick = () => { window.focus(); openConv(gid); }; } } catch (e) {}
  }

  /* --- админ: сотрудники --- */
  async function openAdmin() {
    const c = modal(`<h2>Сотрудники</h2><div class="users"></div>
      <h3 style="margin-top:18px">Добавить сотрудника</h3>
      <form class="yc-form"><label>Имя (видит гость)<input name="name" required maxlength="60" placeholder="Айбек"></label>
      <label>Логин (латиницей)<input name="login" required pattern="[a-zA-Z0-9._-]{3,32}" placeholder="aibek"></label>
      <label>Пароль (мин. 6 символов)<input name="password" required minlength="6" autocomplete="new-password"></label>
      <label class="chk"><input type="checkbox" name="admin"> администратор (может добавлять сотрудников)</label>
      <div class="yc-err" hidden></div><button class="yc-btn">Добавить</button></form>`);
    const load = async () => {
      const box = $('.users', c); box.innerHTML = '';
      const r = await api('/api/users');
      for (const u of r.users) {
        const row = h('div', 'urow');
        const info = h('div'); info.append(h('b', '', u.name), h('small', '', ` ${u.login} · ${u.role === 'admin' ? 'админ' : 'сотрудник'}`));
        const reset = h('button', 'lnk', 'сбросить пароль'), del = h('button', 'lnk red', 'удалить');
        reset.onclick = async () => { const pw = prompt(`Новый пароль для ${u.name} (мин. 6 символов):`); if (!pw) return; try { await api(`/api/users/${u.id}/password`, { password: pw }); alert('Пароль изменён'); } catch (e) { alert(e.message); } };
        del.onclick = async () => { if (!confirm(`Удалить сотрудника ${u.name}?`)) return; try { await api(`/api/users/${u.id}`, undefined, 'DELETE'); load(); } catch (e) { alert(e.message); } };
        if (u.id === me.id) { del.hidden = true; }
        row.append(info, reset, del); box.append(row);
      }
    };
    load();
    $('form', c).onsubmit = async (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      try { await api('/api/users', { name: fd.get('name'), login: fd.get('login'), password: fd.get('password'), role: fd.get('admin') ? 'admin' : 'staff' }); e.target.reset(); $('.yc-err', c).hidden = true; load(); }
      catch (err) { const el = $('.yc-err', c); el.hidden = false; el.textContent = err.message; }
    };
  }

  /* --- старт --- */
  api('/api/me').then((r) => (r.user ? startStaff(r.user) : connectGuest())).catch(() => connectGuest());
})();
