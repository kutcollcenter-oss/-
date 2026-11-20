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
    saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  }, 300);
}
function flush() { if (!saveTimer) return; clearTimeout(saveTimer); saveTimer = null; const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 1)); fs.renameSync(tmp, DB_FILE); }
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { flush(); } catch (e) {} process.exit(0); });

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

/* ---------- Застройщики: статусы квартир и брони ----------
   db.partners — учётки застройщиков (логин/пароль, свои ЖК, адрес для уведомлений);
   db.statuses[ЖК][ключ квартиры] = { st: free|booked|sold, at, by };  ключ квартиры — «блок-номер», например «Б-37».
   Бронь с сайта держится BOOK_HOURS часов: если застройщик не подтвердил продажу (и не продлил), снимается сама. */
const BOOK_HOURS = +process.env.BOOK_HOURS || 24, ST = ['free', 'booked', 'sold'], KEY_RE = /^[\p{L}\p{N}]{1,6}-\d{1,5}$/u;
for (const k of ['partners', 'bookings']) if (!Array.isArray(db[k])) db[k] = [];
for (const k of ['partnerTokens', 'statuses']) if (!db[k] || typeof db[k] !== 'object') db[k] = {};
// Каталог: читаем data.js в песочнице (там window.YURTA_PROJECTS) и считаем номера так же, как сайт:
// номер = (этаж − первый жилой) × квартир на этаже + номер на плане
const vm = require('vm');
let catalogCache = { mtime: 0, map: {} };
function catalog() {
  const file = path.join(ROOT, 'js', 'data.js');
  let st; try { st = fs.statSync(file); } catch (e) { return catalogCache.map; }
  if (st.mtimeMs === catalogCache.mtime) return catalogCache.map;
  const map = {};
  try {
    const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { timeout: 2000 });
    for (const p of ctx.window.YURTA_PROJECTS || []) {
      const apts = map[p.id] = new Map();
      for (const b of p.blocks || []) {
        const first = b.firstResidentialFloor != null ? b.firstResidentialFloor : p.firstResidentialFloor, list = (b.plan && b.plan.apts) || [];
        for (let fl = first; fl <= b.floors; fl++) for (const a of list) {
          const num = (fl - first) * list.length + a.n;
          apts.set(`${b.id}-${num}`, { block: b.id, floor: fl, number: num, rooms: a.rooms, area: a.area });
        }
      }
    }
  } catch (e) { console.log('catalog', e.message); return catalogCache.map; }
  catalogCache = { mtime: st.mtimeMs, map };
  return map;
}
const aptExists = (pid, key) => { const c = catalog()[pid]; return !!(c && c.has(key)); };
const managed = (pid) => db.partners.some((x) => x.projects.includes(pid));
const publicBooking = (x) => ({ id: x.id, project: x.project, key: x.key, name: x.name, phone: x.phone, info: x.info, state: x.state, createdAt: new Date(x.createdAt).toISOString(), expiresAt: new Date(x.expiresAt).toISOString() });
const publicPartner = (x) => ({ id: x.id, name: x.name, login: x.login, projects: x.projects, webhook: x.webhook || '', createdAt: x.createdAt });
function setStatus(pid, key, st, by) { (db.statuses[pid] = db.statuses[pid] || {})[key] = { st, at: Date.now(), by }; }
// Уведомление застройщику на его адрес (webhook): POST JSON, подпись HMAC-SHA256 в заголовке X-Objekty-Signature
function notifyPartners(pid, event, data) {
  for (const pt of db.partners) {
    if (!pt.webhook || !pt.projects.includes(pid)) continue;
    const payload = JSON.stringify({ event, project: pid, at: new Date().toISOString(), ...data });
    const sig = crypto.createHmac('sha256', pt.secret).update(payload).digest('hex');
    const attempt = (n) => fetch(pt.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Objekty-Signature': sig }, body: payload, signal: AbortSignal.timeout(8000) })
      .then((rr) => { if (!rr.ok) throw new Error('HTTP ' + rr.status); })
      .catch((e) => { console.log('webhook', pt.login, event, 'try', n, e.message); if (n < 3) setTimeout(() => attempt(n + 1), n * 60000); });
    attempt(1);
  }
}
// Каждые 5 минут: просроченные брони снимаем — квартира снова «свободна», застройщику уходит запрос/уведомление
setInterval(() => {
  let n = 0;
  for (const bk of db.bookings) {
    if (bk.state !== 'active' || bk.expiresAt > Date.now()) continue;
    bk.state = 'expired'; bk.closedAt = Date.now(); n++;
    const cur = (db.statuses[bk.project] || {})[bk.key];
    if (!cur || cur.st === 'booked') setStatus(bk.project, bk.key, 'free', 'авто: бронь не подтверждена за ' + BOOK_HOURS + ' ч');
    notifyPartners(bk.project, 'booking.expired', { booking: publicBooking(bk), status: 'free' });
    toStaff('booking', { booking: bk });
  }
  for (const [t, s] of Object.entries(db.partnerTokens)) if (s.exp < Date.now()) { delete db.partnerTokens[t]; n++; }
  const keep = db.bookings.filter((x) => x.state === 'active' || (x.closedAt || x.createdAt) > Date.now() - 180 * 864e5);
  if (keep.length !== db.bookings.length) { db.bookings = keep; n++; }
  if (n) save();
}, +process.env.SWEEP_MS || 5 * 60 * 1000);

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
  const b = m === 'POST' ? await body(req, p === '/api/media' ? 17e6 : p === '/api/partner/statuses' ? 1e6 : 20000) : {};
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

  /* --- статусы квартир и брони (публично) --- */
  if (p === '/api/statuses' && m === 'GET') {
    const pid = cleanText(url.searchParams.get('project'), 40);
    const map = Object.fromEntries(Object.entries(db.statuses[pid] || {}).map(([k, v]) => [k, v.st]));
    return json(res, 200, { live: managed(pid), statuses: map });
  }
  if (p === '/api/book' && m === 'POST') {
    // мобильные операторы выводят многих абонентов через один IP — лимит мягкий; главный — 2 активные брони на телефон
    if (limited('book:' + ip, +process.env.BOOK_PER_IP || 20, 60 * 60 * 1000)) return json(res, 429, { error: 'Слишком много заявок. Попробуйте позже или напишите в чат.' });
    const pid = cleanText(b.project, 40), key = cleanText(b.key, 24), name = cleanText(b.name, 60), phone = cleanText(b.phone, 30);
    if (!pid || !KEY_RE.test(key) || !name || phone.replace(/\D/g, '').length < 9) return json(res, 400, { error: 'Укажите имя и телефон' });
    if (!aptExists(pid, key)) return json(res, 400, { error: 'Такой квартиры нет' });
    // очередь на забронированную квартиру: статус не меняется, менеджер видит заявку
    if (b.queue) {
      const q = { id: crypto.randomUUID(), project: pid, key, name, phone, info: cleanText(b.info, 300), createdAt: Date.now(), expiresAt: Date.now(), state: 'queue' };
      db.bookings.push(q); save(); toStaff('booking', { booking: q });
      return json(res, 200, { queued: true });
    }
    const digits = phone.replace(/\D/g, '').slice(-9);
    if (db.bookings.filter((x) => x.state === 'active' && x.phone.replace(/\D/g, '').slice(-9) === digits).length >= 2) return json(res, 429, { error: 'На этот номер уже 2 активные брони. Менеджер свяжется с вами.' });
    const cur = (db.statuses[pid] || {})[key];
    if (cur && cur.st === 'sold') return json(res, 409, { error: 'Квартира уже продана' });
    if (cur && cur.st === 'booked') return json(res, 409, { error: 'Квартира уже забронирована. Оставьте заявку в чате — сообщим, если бронь снимут.' });
    const bk = { id: crypto.randomUUID(), project: pid, key, name, phone, info: cleanText(b.info, 300), createdAt: Date.now(), expiresAt: Date.now() + BOOK_HOURS * 3600e3, state: 'active' };
    db.bookings.push(bk); setStatus(pid, key, 'booked', 'сайт'); save();
    toStaff('booking', { booking: bk });
    notifyPartners(pid, 'booking.created', { booking: publicBooking(bk) });
    return json(res, 200, { booking: { id: bk.id, expiresAt: bk.expiresAt } });
  }

  /* --- API застройщика: вход по логину и паролю → токен на 24 часа --- */
  if (p.startsWith('/api/partner/')) {
    if (p === '/api/partner/token' && m === 'POST') {
      const fails = (hits.get('pfail:' + ip) || []).filter((t) => Date.now() - t < 10 * 60 * 1000);
      if (fails.length >= 10) return json(res, 429, { error: 'too many failed attempts, wait 10 minutes' });
      const pt = db.partners.find((x) => x.login === cleanText(b.login, 64).toLowerCase());
      if (!pt || !checkPassword(pt, b.password || '')) { limited('pfail:' + ip, 10, 10 * 60 * 1000); return json(res, 401, { error: 'invalid login or password' }); }
      // старые токены этого застройщика не копим: оставляем 5 последних
      const mine = Object.entries(db.partnerTokens).filter(([, v]) => v.pid === pt.id).sort((a, b2) => b2[1].exp - a[1].exp);
      for (const [t] of mine.slice(4)) delete db.partnerTokens[t];
      const t = crypto.randomBytes(32).toString('hex');
      db.partnerTokens[t] = { pid: pt.id, exp: Date.now() + 864e5 }; save();
      return json(res, 200, { token: t, expiresIn: 86400, projects: pt.projects });
    }
    const tk = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''), ses = db.partnerTokens[tk];
    const pt = ses && ses.exp > Date.now() && db.partners.find((x) => x.id === ses.pid);
    if (!pt) return json(res, 401, { error: 'token missing or expired: POST /api/partner/token' });
    const own = (pid) => pt.projects.includes(pid);
    if (p === '/api/partner/projects' && m === 'GET') return json(res, 200, { projects: pt.projects });
    if (p === '/api/partner/apartments' && m === 'GET') {
      const pid = cleanText(url.searchParams.get('project'), 40); if (!own(pid)) return json(res, 403, { error: 'no access to project' });
      const c = catalog()[pid]; if (!c) return json(res, 404, { error: 'project not found' });
      const sts = db.statuses[pid] || {};
      return json(res, 200, { project: pid, apartments: [...c].map(([key, a]) => ({ key, ...a, status: (sts[key] && sts[key].st) || 'free' })) });
    }
    if (p === '/api/partner/statuses' && m === 'GET') {
      const pid = cleanText(url.searchParams.get('project'), 40); if (!own(pid)) return json(res, 403, { error: 'no access to project' });
      return json(res, 200, { project: pid, statuses: db.statuses[pid] || {} });
    }
    if (p === '/api/partner/statuses' && m === 'POST') {
      const pid = cleanText(b.project, 40); if (!own(pid)) return json(res, 403, { error: 'no access to project' });
      const items = Array.isArray(b.items) ? b.items.slice(0, 5000) : [], bad = [];
      for (const it of items) {
        const key = cleanText(it && it.key, 24), st = it && it.status;
        if (!KEY_RE.test(key) || !ST.includes(st)) { bad.push({ ...it, reason: 'bad key or status' }); continue; }
        if (!aptExists(pid, key)) { bad.push({ ...it, reason: 'unknown apartment (see GET /api/partner/apartments)' }); continue; }
        setStatus(pid, key, st, pt.name);
        for (const bk of db.bookings) if (bk.state === 'active' && bk.project === pid && bk.key === key && st !== 'booked') { bk.state = st === 'sold' ? 'sold' : 'cancelled'; bk.closedAt = Date.now(); toStaff('booking', { booking: bk }); }
      }
      save(); toStaff('statuses', { project: pid });
      return json(res, 200, { updated: items.length - bad.length, rejected: bad });
    }
    if (p === '/api/partner/bookings' && m === 'GET') {
      const pid = cleanText(url.searchParams.get('project'), 40), state = cleanText(url.searchParams.get('state'), 12);
      const list = db.bookings.filter((x) => own(x.project) && (!pid || x.project === pid) && (!state || x.state === state)).slice(-500).map(publicBooking);
      return json(res, 200, { bookings: list });
    }
    const bm = p.match(/^\/api\/partner\/bookings\/([0-9a-f-]{36})$/);
    if (bm && m === 'POST') {
      const bk = db.bookings.find((x) => x.id === bm[1] && own(x.project)); if (!bk) return json(res, 404, { error: 'booking not found' });
      if (bk.state !== 'active') return json(res, 409, { error: 'booking is ' + bk.state });
      if (b.action === 'confirm') { bk.state = 'sold'; bk.closedAt = Date.now(); setStatus(bk.project, bk.key, 'sold', pt.name); }
      else if (b.action === 'extend') { bk.expiresAt += Math.max(1, Math.min(72, +b.hours || 24)) * 3600e3; }
      else if (b.action === 'cancel') { bk.state = 'cancelled'; bk.closedAt = Date.now(); setStatus(bk.project, bk.key, 'free', pt.name); }
      else return json(res, 400, { error: 'action: confirm | extend | cancel' });
      save(); toStaff('booking', { booking: bk });
      return json(res, 200, { booking: publicBooking(bk) });
    }
    return json(res, 404, { error: 'not found' });
  }

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

  /* --- брони для сотрудников --- */
  if (p === '/api/bookings' && m === 'GET') return json(res, 200, { bookings: db.bookings.slice(-300).reverse().map(publicBooking) });

  /* --- админ: застройщики (доступ к API) --- */
  if (p.startsWith('/api/partners')) {
    if (me.role !== 'admin') return json(res, 403, { error: 'Только для администратора' });
    const projList = (v) => (Array.isArray(v) ? v : []).map((x) => cleanText(x, 40)).filter(Boolean).slice(0, 50);
    const hook = (v) => { const s = cleanText(v, 300); return /^https:\/\/[^\s]+$/.test(s) || (process.env.ALLOW_HTTP_WEBHOOK && /^http:\/\/127\.0\.0\.1:\d+\//.test(s)) ? s : ''; }; // http — только в локальных тестах
    if (p === '/api/partners' && m === 'GET') return json(res, 200, { partners: db.partners.map(publicPartner) });
    if (p === '/api/partners' && m === 'POST') {
      const login = cleanText(b.login, 32).toLowerCase(), name = cleanText(b.name, 80), projects = projList(b.projects);
      if (!/^[a-z0-9._-]{3,32}$/.test(login)) return json(res, 400, { error: 'Логин: 3–32 латинских буквы/цифры' });
      if (!name || !projects.length) return json(res, 400, { error: 'Укажите название компании и хотя бы один ЖК' });
      if (db.partners.some((x) => x.login === login) || db.users.some((x) => x.login === login)) return json(res, 400, { error: 'Такой логин уже есть' });
      const pw = crypto.randomBytes(9).toString('base64url');
      const pt = { id: crypto.randomUUID(), name, login, projects, webhook: hook(b.webhook), secret: crypto.randomBytes(24).toString('hex'), createdAt: Date.now() };
      setPassword(pt, pw); db.partners.push(pt); save();
      return json(res, 200, { partner: publicPartner(pt), password: pw, secret: pt.secret }); // пароль и секрет показываются один раз
    }
    const pm = p.match(/^\/api\/partners\/([0-9a-f-]{36})(\/password)?$/);
    if (pm) {
      const pt = db.partners.find((x) => x.id === pm[1]); if (!pt) return json(res, 404, { error: 'нет такого' });
      const dropTokens = () => { for (const [t, s] of Object.entries(db.partnerTokens)) if (s.pid === pt.id) delete db.partnerTokens[t]; };
      if (pm[2] && m === 'POST') { const pw = crypto.randomBytes(9).toString('base64url'); setPassword(pt, pw); dropTokens(); save(); return json(res, 200, { password: pw }); }
      if (!pm[2] && m === 'POST') { if (b.projects) pt.projects = projList(b.projects); if (b.webhook != null) pt.webhook = hook(b.webhook); save(); return json(res, 200, { partner: publicPartner(pt) }); }
      if (m === 'DELETE') { db.partners = db.partners.filter((x) => x !== pt); dropTokens(); save(); return json(res, 200, { ok: true }); }
    }
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
