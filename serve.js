// Юрта — сервер сайта: статика + API чатов, сотрудников и уведомлений.
// Запуск: node serve.js  →  http://localhost:5180   (без внешних библиотек)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'site');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS = path.join(DATA_DIR, 'uploads'); // фото стройки и вида из окна, загруженные сотрудниками
const PORT = process.env.PORT || 5180;
const SESSION_DAYS = 30;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.webp': 'image/webp' };

/* ---------- Хранилище (JSON-файл) ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { users: [], sessions: {}, chats: {}, media: [], progress: {}, offers: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch (e) {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  }, 300);
}

/* ---------- Пароли и сессии ---------- */
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
function setPassword(user, pw) { user.salt = crypto.randomBytes(16).toString('hex'); user.hash = hashPw(pw, user.salt); }
function checkPassword(user, pw) {
  const h = Buffer.from(hashPw(pw, user.salt), 'hex'), ref = Buffer.from(user.hash, 'hex');
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
}
const publicUser = (u) => u && { id: u.id, name: u.name, login: u.login, role: u.role, createdAt: u.createdAt };

// Первый запуск: создаём администратора, пароль кладём в файл data/admin-password.txt
if (!db.users.length) {
  const pw = crypto.randomBytes(6).toString('base64url');
  const admin = { id: crypto.randomUUID(), name: 'Администратор', login: 'admin', role: 'admin', createdAt: Date.now() };
  setPassword(admin, pw);
  db.users.push(admin);
  fs.writeFileSync(path.join(DATA_DIR, 'admin-password.txt'), `Логин: admin\nПароль: ${pw}\n\nСмените пароль после первого входа и удалите этот файл.\n`);
  save();
  console.log('Создан администратор. Логин и пароль — в файле data/admin-password.txt');
}

function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p[0])); }
function currentUser(req) {
  const t = cookies(req).ysid; const s = t && db.sessions[t];
  if (!s || s.exp < Date.now()) return null;
  return db.users.find((u) => u.id === s.uid) || null;
}

/* ---------- Онлайн-каналы (Server-Sent Events) ---------- */
const staffStreams = new Set();   // { res, user }
const guestStreams = new Map();   // gid -> Set(res)
function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
}
const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
function toStaff(event, data) { for (const s of staffStreams) send(s.res, event, data); }
function toGuest(gid, event, data) { for (const r of guestStreams.get(gid) || []) send(r, event, data); }
setInterval(() => { for (const s of staffStreams) s.res.write(': ping\n\n'); for (const set of guestStreams.values()) for (const r of set) r.write(': ping\n\n'); }, 25000);
const onlineStaff = () => [...new Map([...staffStreams].map((s) => [s.user.id, { id: s.user.id, name: s.user.name }])).values()];

/* ---------- Чаты ---------- */
const GID_RE = /^[a-zA-Z0-9-]{8,64}$/;
function chatOf(gid, create = true) {
  if (!db.chats[gid] && create) db.chats[gid] = { gid, createdAt: Date.now(), updatedAt: Date.now(), guestName: '', guestPhone: '', assignedTo: null, assignedName: '', lastView: null, views: [], messages: [], unreadStaff: 0, unreadGuest: 0 };
  return db.chats[gid];
}
function chatSummary(c) {
  const last = c.messages[c.messages.length - 1];
  return { gid: c.gid, guestName: c.guestName, guestPhone: c.guestPhone, assignedTo: c.assignedTo, assignedName: c.assignedName, lastView: c.lastView, views: c.views.slice(-5), last: last ? { text: last.text, from: last.from, at: last.at } : null, updatedAt: c.updatedAt, unreadStaff: c.unreadStaff, online: guestStreams.has(c.gid) && guestStreams.get(c.gid).size > 0, count: c.messages.length };
}
function addMessage(c, msg) {
  const m = { id: crypto.randomUUID(), at: Date.now(), ...msg, text: String(msg.text).slice(0, 2000) };
  c.messages.push(m); c.updatedAt = m.at;
  if (c.messages.length > 500) c.messages.splice(0, c.messages.length - 500);
  if (m.from === 'guest') c.unreadStaff++; else c.unreadGuest++;
  save();
  toGuest(c.gid, 'message', m);
  toStaff('message', { gid: c.gid, message: m, chat: chatSummary(c) });
  return m;
}
const cleanText = (v, n) => String(v || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);

/* ---------- Ограничение частоты ---------- */
const hits = new Map();
function limited(key, max, ms) {
  const now = Date.now(), arr = (hits.get(key) || []).filter((t) => now - t < ms);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}

/* ---------- HTTP ---------- */
function json(res, code, data, headers = {}) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(data)); }
function body(req, max = 20000) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > max) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}

async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  // за nginx настоящий адрес посетителя — в X-Forwarded-For (доверяем только локальному прокси)
  const sock = req.socket.remoteAddress || '';
  const fwd = (req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  const ip = /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(sock) && fwd ? fwd : sock;
  if (m === 'POST' && !(req.headers['content-type'] || '').includes('application/json')) return json(res, 415, { error: 'json only' });
  const b = m === 'POST' ? await body(req, p === '/api/media' ? 17e6 : 20000) : {};
  const me = currentUser(req);

  /* --- вход сотрудников --- */
  if (p === '/api/login' && m === 'POST') {
    if (limited('login:' + ip, 10, 10 * 60 * 1000)) return json(res, 429, { error: 'Слишком много попыток. Подождите 10 минут.' });
    const u = db.users.find((x) => x.login === cleanText(b.login, 64).toLowerCase());
    if (!u || !checkPassword(u, b.password || '')) return json(res, 401, { error: 'Неверный логин или пароль' });
    const t = crypto.randomBytes(32).toString('hex');
    db.sessions[t] = { uid: u.id, exp: Date.now() + SESSION_DAYS * 864e5 }; save();
    return json(res, 200, { user: publicUser(u) }, { 'Set-Cookie': `ysid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}` });
  }
  if (p === '/api/logout' && m === 'POST') {
    const t = cookies(req).ysid; if (t) { delete db.sessions[t]; save(); }
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'ysid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (p === '/api/me') return json(res, 200, { user: me ? publicUser(me) : null });

  /* --- гость --- */
  if (p.startsWith('/api/guest/')) {
    const gid = cleanText(url.searchParams.get('gid') || b.gid, 64);
    if (!GID_RE.test(gid)) return json(res, 400, { error: 'bad gid' });
    if (p === '/api/guest/stream') {
      sse(res);
      if (!guestStreams.has(gid)) guestStreams.set(gid, new Set());
      guestStreams.get(gid).add(res);
      const c = chatOf(gid, false);
      send(res, 'hello', { staffOnline: onlineStaff().length, assignedName: c ? c.assignedName : '' });
      if (c) toStaff('presence', { gid, online: true, chat: chatSummary(c) });
      req.on('close', () => {
        const set = guestStreams.get(gid); set.delete(res);
        if (!set.size) { guestStreams.delete(gid); const cc = chatOf(gid, false); if (cc) toStaff('presence', { gid, online: false, chat: chatSummary(cc) }); }
      });
      return;
    }
    if (p === '/api/guest/messages') {
      const c = chatOf(gid, false);
      if (c) { c.unreadGuest = 0; save(); }
      return json(res, 200, { messages: c ? c.messages : [], assignedName: c ? c.assignedName : '', staffOnline: onlineStaff().length });
    }
    if (p === '/api/guest/view' && m === 'POST') {
      if (limited('view:' + gid, 30, 60000)) return json(res, 429, { error: 'slow down' });
      const v = b.view || {};
      const view = { project: cleanText(v.project, 80), projectId: cleanText(v.projectId, 40), block: cleanText(v.block, 8), floor: +v.floor || null, apt: +v.apt || null, rooms: cleanText(v.rooms, 30), area: +v.area || null, price: +v.price || null, hash: cleanText(v.hash, 120), at: Date.now() };
      const c = chatOf(gid);
      const prev = c.views[c.views.length - 1];
      const same = prev && prev.hash === view.hash && Date.now() - prev.at < 60000;
      c.lastView = view;
      if (!same) { c.views.push(view); if (c.views.length > 30) c.views.shift(); }
      c.updatedAt = Date.now(); save();
      if (!same) toStaff('view', { gid, view, chat: chatSummary(c) });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/guest/message' && m === 'POST') {
      if (limited('msg:' + gid, 20, 60000) || limited('msgip:' + ip, 60, 60000)) return json(res, 429, { error: 'Слишком часто. Подождите минуту.' });
      const text = cleanText(b.text, 2000); if (!text) return json(res, 400, { error: 'empty' });
      const c = chatOf(gid);
      if (b.name) c.guestName = cleanText(b.name, 60);
      if (b.phone) c.guestPhone = cleanText(b.phone, 30);
      if (b.view && b.view.hash) c.lastView = { ...(c.lastView || {}), hash: cleanText(b.view.hash, 120) };
      return json(res, 200, { message: addMessage(c, { from: 'guest', text }) });
    }
    if (p === '/api/guest/contact' && m === 'POST') {
      const c = chatOf(gid);
      c.guestName = cleanText(b.name, 60) || c.guestName; c.guestPhone = cleanText(b.phone, 30) || c.guestPhone; save();
      toStaff('chat', { chat: chatSummary(c) });
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  /* --- сотрудники (нужен вход) --- */
  /* --- публичное: ход стройки, фото, расчёты --- */
  if (p === '/api/media' && m === 'GET') {
    const pid = cleanText(url.searchParams.get('pid'), 40);
    return json(res, 200, { media: db.media.filter((x) => !pid || x.pid === pid), progress: pid ? db.progress[pid] || null : db.progress });
  }
  if (p === '/api/offers' && m === 'POST') {
    if (limited('offer:' + ip, 30, 60 * 60 * 1000)) return json(res, 429, { error: 'Слишком много расчётов. Попробуйте позже.' });
    const o = b.offer || {};
    const num = (v) => (Number.isFinite(+v) ? +v : 0);
    const offer = {
      id: crypto.randomBytes(6).toString('base64url'), createdAt: Date.now(), by: me ? me.name : '',
      pid: cleanText(o.pid, 40), project: cleanText(o.project, 80), address: cleanText(o.address, 160), completion: cleanText(o.completion, 40),
      block: cleanText(o.block, 8), floor: num(o.floor), floors: num(o.floors), apt: num(o.apt), rooms: cleanText(o.rooms, 30), euro: !!o.euro,
      area: num(o.area), price: num(o.price), m2: num(o.m2), down: num(o.down), months: num(o.months),
      planImg: cleanText(o.planImg, 120), planW: num(o.planW), planH: num(o.planH), render: cleanText(o.render, 120),
      poly: Array.isArray(o.poly) ? o.poly.slice(0, 40).map((q) => [num(q[0]), num(q[1])]) : [],
    };
    db.offers[offer.id] = offer;
    const ids = Object.keys(db.offers); if (ids.length > 5000) delete db.offers[ids[0]];
    save();
    return json(res, 200, { id: offer.id });
  }
  let om = p.match(/^\/api\/offers\/([A-Za-z0-9_-]{4,20})$/);
  if (om && m === 'GET') return db.offers[om[1]] ? json(res, 200, { offer: db.offers[om[1]] }) : json(res, 404, { error: 'Расчёт не найден' });

  if (!me) return json(res, 401, { error: 'Нужно войти' });
  /* --- сотрудники: фото стройки / вида из окна, процент готовности --- */
  if (p === '/api/media' && m === 'POST') {
    const mt = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(b.image || ''));
    if (!mt) return json(res, 400, { error: 'Нужна фотография (JPG, PNG или WEBP)' });
    const buf = Buffer.from(mt[2], 'base64');
    if (buf.length > 12 * 1024 * 1024) return json(res, 400, { error: 'Файл больше 12 МБ' });
    const id = crypto.randomBytes(8).toString('hex'), ext = mt[1] === 'jpeg' ? 'jpg' : mt[1];
    fs.mkdirSync(UPLOADS, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS, `${id}.${ext}`), buf);
    const item = {
      id, url: `/uploads/${id}.${ext}`, type: b.type === 'view' ? 'view' : 'progress', pid: cleanText(b.pid, 40),
      date: cleanText(b.date, 10) || new Date().toISOString().slice(0, 10), caption: cleanText(b.caption, 200),
      block: cleanText(b.block, 8), floorFrom: +b.floorFrom || 0, floorTo: +b.floorTo || 0, side: ['N', 'E', 'S', 'W'].includes(b.side) ? b.side : '',
      by: me.name, at: Date.now(),
    };
    db.media.push(item); save();
    return json(res, 200, { item });
  }
  let mm2 = p.match(/^\/api\/media\/([0-9a-f]{16})$/);
  if (mm2 && m === 'DELETE') {
    const it = db.media.find((x) => x.id === mm2[1]); if (!it) return json(res, 404, { error: 'нет такого' });
    db.media = db.media.filter((x) => x !== it);
    try { fs.unlinkSync(path.join(UPLOADS, path.basename(it.url))); } catch (e) {}
    save(); return json(res, 200, { ok: true });
  }
  if (p === '/api/progress' && m === 'POST') {
    const pid = cleanText(b.pid, 40); if (!pid) return json(res, 400, { error: 'нет объекта' });
    db.progress[pid] = { percent: Math.max(0, Math.min(100, Math.round(+b.percent || 0))), stage: cleanText(b.stage, 120), updatedAt: Date.now(), by: me.name };
    save(); return json(res, 200, { progress: db.progress[pid] });
  }


  if (p === '/api/staff/stream') {
    sse(res);
    const entry = { res, user: me };
    staffStreams.add(entry);
    send(res, 'hello', { user: publicUser(me), staffOnline: onlineStaff() });
    toStaff('staff', { staffOnline: onlineStaff() });
    req.on('close', () => { staffStreams.delete(entry); toStaff('staff', { staffOnline: onlineStaff() }); });
    return;
  }
  if (p === '/api/staff/chats') {
    const list = Object.values(db.chats).filter((c) => c.messages.length || c.views.length).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200).map(chatSummary);
    return json(res, 200, { chats: list, staffOnline: onlineStaff() });
  }
  let mm = p.match(/^\/api\/staff\/chats\/([a-zA-Z0-9-]{8,64})(\/(message|take|read|close))?$/);
  if (mm) {
    const c = chatOf(mm[1], false); if (!c) return json(res, 404, { error: 'нет чата' });
    const action = mm[3];
    if (!action) return json(res, 200, { chat: chatSummary(c), messages: c.messages, views: c.views });
    if (action === 'take' && m === 'POST') {
      c.assignedTo = me.id; c.assignedName = me.name; save();
      toStaff('chat', { chat: chatSummary(c) }); toGuest(c.gid, 'assigned', { name: me.name });
      return json(res, 200, { chat: chatSummary(c) });
    }
    if (action === 'read' && m === 'POST') { c.unreadStaff = 0; save(); toStaff('chat', { chat: chatSummary(c) }); return json(res, 200, { ok: true }); }
    if (action === 'message' && m === 'POST') {
      const text = cleanText(b.text, 2000); if (!text) return json(res, 400, { error: 'empty' });
      if (!c.assignedTo) { c.assignedTo = me.id; c.assignedName = me.name; toGuest(c.gid, 'assigned', { name: me.name }); }
      c.unreadStaff = 0;
      return json(res, 200, { message: addMessage(c, { from: 'staff', staffId: me.id, staffName: me.name, text }) });
    }
  }
  if (p === '/api/me/password' && m === 'POST') {
    if (!checkPassword(me, b.old || '')) return json(res, 400, { error: 'Старый пароль неверный' });
    if (String(b.password || '').length < 6) return json(res, 400, { error: 'Пароль — минимум 6 символов' });
    setPassword(me, b.password); save();
    return json(res, 200, { ok: true });
  }

  /* --- админ: сотрудники --- */
  if (p.startsWith('/api/users')) {
    if (me.role !== 'admin') return json(res, 403, { error: 'Только для администратора' });
    if (p === '/api/users' && m === 'GET') return json(res, 200, { users: db.users.map(publicUser) });
    if (p === '/api/users' && m === 'POST') {
      const login = cleanText(b.login, 32).toLowerCase(), name = cleanText(b.name, 60), pw = String(b.password || '');
      if (!/^[a-z0-9._-]{3,32}$/.test(login)) return json(res, 400, { error: 'Логин: 3–32 латинских буквы/цифры' });
      if (!name) return json(res, 400, { error: 'Укажите имя' });
      if (pw.length < 6) return json(res, 400, { error: 'Пароль — минимум 6 символов' });
      if (db.users.some((u) => u.login === login)) return json(res, 400, { error: 'Такой логин уже есть' });
      const u = { id: crypto.randomUUID(), name, login, role: b.role === 'admin' ? 'admin' : 'staff', createdAt: Date.now() };
      setPassword(u, pw); db.users.push(u); save();
      return json(res, 200, { user: publicUser(u) });
    }
    mm = p.match(/^\/api\/users\/([0-9a-f-]{36})(\/password)?$/);
    if (mm) {
      const u = db.users.find((x) => x.id === mm[1]); if (!u) return json(res, 404, { error: 'нет такого' });
      if (mm[2] && m === 'POST') {
        if (String(b.password || '').length < 6) return json(res, 400, { error: 'Пароль — минимум 6 символов' });
        setPassword(u, b.password); for (const [t, s] of Object.entries(db.sessions)) if (s.uid === u.id) delete db.sessions[t];
        save(); return json(res, 200, { ok: true });
      }
      if (m === 'DELETE') {
        if (u.id === me.id) return json(res, 400, { error: 'Нельзя удалить себя' });
        db.users = db.users.filter((x) => x.id !== u.id);
        for (const [t, s] of Object.entries(db.sessions)) if (s.uid === u.id) delete db.sessions[t];
        save(); return json(res, 200, { ok: true });
      }
    }
  }
  return json(res, 404, { error: 'not found' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); } catch (e) { if (!res.headersSent) json(res, 400, { error: 'bad request' }); }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.startsWith('/uploads/')) {
    const f = path.join(UPLOADS, path.basename(p));
    return fs.readFile(f, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' }); res.end(data); });
  }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log('Объекты: http://localhost:' + PORT));
