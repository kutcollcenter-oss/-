/* Объекты — прогулка по этажам целиком: подземный паркинг, коммерция, подъезды.
   Источник — рабочий проект (АР), листы в масштабе 1:150: стены и колонны взяты из векторов чертежа
   (маска 5 см/пиксель), пол — сам чертёж. Размеры точные, без подгонки. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const EYE = 1.6, RADIUS = 0.25;
  let F = null;

  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('не загрузилось: ' + src)); i.src = src; });

  // маска → сетка стен
  function readMask(img) {
    const W = img.naturalWidth, H = img.naturalHeight, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data, wall = new Uint8Array(W * H);
    for (let i = 0, k = 0; k < W * H; i += 4, k++) wall[k] = d[i] < 140 ? 1 : 0;
    return { W, H, wall };
  }
  // склеиваем клетки стен в прямоугольники
  function rects(grid, W, H) {
    const used = new Uint8Array(W * H), out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!grid[i] || used[i]) continue;
      let w = 1; while (x + w < W && grid[i + w] && !used[i + w]) w++;
      let h = 1;
      outer: while (y + h < H) { for (let k = 0; k < w; k++) { const j = (y + h) * W + x + k; if (!grid[j] || used[j]) break outer; } h++; }
      for (let yy = 0; yy < h; yy++) for (let k = 0; k < w; k++) used[(y + yy) * W + x + k] = 1;
      out.push([x, y, w, h]);
    }
    return out;
  }
  function boxes(list) {
    const P = [], N = [], I = [];
    for (const [x0, z0, x1, z1, y0, y1] of list) {
      const Fc = [[[0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]],
        [[1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]], [[-1, 0, 0], [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]]],
        [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]]];
      for (const [n, q] of Fc) { const k = P.length / 3; q.forEach((v) => { P.push(...v); N.push(...n); }); I.push(k, k + 1, k + 2, k, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I);
    return g;
  }

  function close() {
    if (!F) return;
    cancelAnimationFrame(F.raf);
    ['keydown', 'keyup', 'resize'].forEach((ev) => window.removeEventListener(ev, F['on' + ev]));
    if (F.scene) F.scene.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) [].concat(m.material).forEach((mt) => { if (mt.map) mt.map.dispose(); mt.dispose(); }); });
    if (F.renderer) F.renderer.dispose();
    F.root.remove(); F = null;
  }

  // o: { title, levels: [{ id, name, img, mask, w, h, height }], level }
  function open(o) {
    close();
    const root = document.createElement('div'); root.className = 'tour ftour';
    root.innerHTML = `<canvas></canvas>
      <div class="tour-top"><div><b>🏢 ${o.title}</b><span>по рабочему проекту (АР), масштаб 1:150</span></div>
        <div class="tour-modes"><button data-m="top">Сверху</button><button data-m="walk" class="on">🚶 Прогулка</button></div>
        <button class="tour-x" aria-label="Закрыть">✕</button></div>
      <div class="ft-levels">${o.levels.map((l) => `<button data-l="${l.id}">${l.name}</button>`).join('')}</div>
      <div class="tour-help"></div>
      <div class="tour-joy" hidden><i></i></div>
      <div class="tour-mini" hidden><canvas></canvas></div>
      <div class="tour-msg">Загружаю чертёж…</div>`;
    document.body.append(root);
    const canvas = $('canvas', root);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    const cam = new THREE.PerspectiveCamera(70, 1, 0.05, 900);
    F = { root, renderer, cam, keys: {}, joy: [0, 0], mode: 'walk', o };
    $('.tour-x', root).onclick = close;
    F.onresize = () => { renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); };
    F.onkeydown = (e) => { F.keys[e.code] = true; if (e.code === 'Escape') close(); };
    F.onkeyup = (e) => { F.keys[e.code] = false; };
    ['keydown', 'keyup', 'resize'].forEach((ev) => window.addEventListener(ev, F['on' + ev]));
    F.onresize();
    root.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => loadLevel(b.dataset.l));
    root.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => setMode(b.dataset.m));
    setupControls();
    loadLevel(o.level || o.levels[0].id);
    const loop = (now) => { if (!F || F.renderer !== renderer) return; step(now); F.raf = requestAnimationFrame(loop); };
    F.last = performance.now(); F.raf = requestAnimationFrame(loop);
  }

  async function loadLevel(id) {
    const L = F.o.levels.find((l) => l.id === id); if (!L) return;
    const msg = $('.tour-msg', F.root) || F.root.appendChild(Object.assign(document.createElement('div'), { className: 'tour-msg' }));
    msg.textContent = `Загружаю: ${L.name}…`; msg.hidden = false;
    F.root.querySelectorAll('[data-l]').forEach((b) => b.classList.toggle('on', b.dataset.l === id));
    const me = F;
    let plan, maskImg;
    try { [plan, maskImg] = await Promise.all([loadImg(L.img), loadImg(L.mask)]); } catch (e) { msg.textContent = e.message; return; }
    if (F !== me) return;
    const M = readMask(maskImg), cell = L.w / M.W, H = L.height;
    // старая сцена — прочь
    if (F.scene) F.scene.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) [].concat(m.material).forEach((mt) => { if (mt.map) mt.map.dispose(); mt.dispose(); }); });
    const scene = new THREE.Scene();
    const under = L.id.startsWith('p');
    scene.background = new THREE.Color(under ? 0x1d2024 : 0xcfe3f5);
    F.fog = new THREE.Fog(scene.background, 25, under ? 70 : 140);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a857c, under ? 0.65 : 0.75));
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sun = new THREE.DirectionalLight(0xffffff, 0.45); sun.position.set(60, 40, 25); scene.add(sun); // свет сбоку — грани стен различимы
    const fill = new THREE.DirectionalLight(0xffffff, 0.18); fill.position.set(-30, 30, -50); scene.add(fill);
    // стены и колонны
    const list = rects(M.wall, M.W, M.H).map(([x, y, w, h]) => [x * cell, y * cell, (x + w) * cell, (y + h) * cell, 0, H]);
    const walls = new THREE.Mesh(boxes(list), new THREE.MeshLambertMaterial({ color: under ? 0xa9a7a2 : 0xd8d3ca }));
    scene.add(walls);
    // пол — чертёж; потолок — бетонная плита
    const tex = new THREE.Texture(plan); tex.needsUpdate = true; tex.anisotropy = F.renderer.capabilities.getMaxAnisotropy();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L.w, L.h), new THREE.MeshLambertMaterial({ map: tex, color: under ? 0x9c9a95 : 0xf2efe9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(L.w / 2, 0, L.h / 2); scene.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(L.w, L.h), new THREE.MeshLambertMaterial({ color: under ? 0x6d6d6b : 0xd9d6d0, side: THREE.DoubleSide }));
    ceil.rotation.x = -Math.PI / 2; ceil.position.set(L.w / 2, H, L.h / 2); scene.add(ceil);
    // светильники в паркинге — полосы света на потолке
    if (under) {
      const lamp = new THREE.MeshBasicMaterial({ color: 0xf4f7ff }), lamps = [];
      for (let z = 4; z < L.h; z += 7) for (let x = 4; x < L.w; x += 6) { const i = Math.floor(z / cell) * M.W + Math.floor(x / cell); if (!M.wall[i]) lamps.push([x - 0.6, z - 0.06, x + 0.6, z + 0.06, H - 0.06, H - 0.02]); }
      scene.add(new THREE.Mesh(boxes(lamps), lamp));
    }
    // проходимость: стена плюс радиус человека
    const r = Math.ceil(RADIUS / cell), block = new Uint8Array(M.W * M.H);
    for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) if (M.wall[y * M.W + x])
      for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= M.H) continue; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < M.W && dx * dx + dy * dy <= r * r) block[yy * M.W + xx] = 1; } }
    Object.assign(F, { scene, L, M, cell, H, block, floor, ceil, target: null, path: null, under });
    // что внутри здания: заливаем снаружи по сетке, где стены «утолщены» на 1,5 м (так закрываются входы и ворота)
    const s = 4, GW = Math.ceil(M.W / s), GH = Math.ceil(M.H / s), coarse = new Uint8Array(GW * GH);
    for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) if (M.wall[y * M.W + x]) coarse[Math.floor(y / s) * GW + Math.floor(x / s)] = 1;
    const rr = Math.ceil(1.5 / (cell * s)), thick = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (coarse[y * GW + x]) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < GH && xx >= 0 && xx < GW) thick[yy * GW + xx] = 1; }
    const outside = new Uint8Array(GW * GH), q = [];
    for (let x = 0; x < GW; x++) for (const y of [0, GH - 1]) if (!thick[y * GW + x]) { outside[y * GW + x] = 1; q.push(y * GW + x); }
    for (let y = 0; y < GH; y++) for (const x of [0, GW - 1]) if (!thick[y * GW + x] && !outside[y * GW + x]) { outside[y * GW + x] = 1; q.push(y * GW + x); }
    for (let h = 0; h < q.length; h++) { const j = q[h], x = j % GW; for (const n of [x > 0 ? j - 1 : -1, x < GW - 1 ? j + 1 : -1, j - GW, j + GW]) if (n >= 0 && n < GW * GH && !thick[n] && !outside[n]) { outside[n] = 1; q.push(n); } }
    const inside = (x, z) => { const cx = Math.floor(x / (cell * s)), cz = Math.floor(z / (cell * s)); return cx >= 0 && cz >= 0 && cx < GW && cz < GH && !outside[cz * GW + cx]; };
    F.free = (x, z) => { const cx = Math.floor(x / cell), cz = Math.floor(z / cell); return cx >= 0 && cz >= 0 && cx < M.W && cz < M.H && !block[cz * M.W + cx]; };
    // старт: свободная точка, где больше всего места вокруг, ближе к центру
    let best = null;
    for (let z = 2; z < L.h - 2; z += 1.5) for (let x = 2; x < L.w - 2; x += 1.5) {
      if (!F.free(x, z) || !inside(x, z)) continue;
      let open = 0; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; let t = 0; while (t < 12 && F.free(x + Math.sin(a) * t, z - Math.cos(a) * t)) t += 0.5; open += t; }
      const sc = open - Math.hypot(x - L.w / 2, z - L.h / 2) * 0.6;
      if (!best || sc > best.sc) best = { sc, x, z };
    }
    F.walk = { x: best ? best.x : L.w / 2, z: best ? best.z : L.h / 2, yaw: 0, pitch: -0.05 };
    if (L.start) { // старт по чертежу: ближайшая свободная точка к заданной
      const [sx, sz, sy] = L.start; let bs = null;
      for (let r = 0; r < 4 && !bs; r += 0.25) for (let a = 0; a < 6.28 && !bs; a += 0.4) if (F.free(sx + Math.cos(a) * r, sz + Math.sin(a) * r)) bs = [sx + Math.cos(a) * r, sz + Math.sin(a) * r];
      if (bs) Object.assign(F.walk, { x: bs[0], z: bs[1], yaw: sy });
    }
    F.orbit = { yaw: 0, pitch: 1.2, r: Math.max(L.w, L.h) * 0.85, cx: L.w / 2, cz: L.h / 2 };
    buildMini(plan);
    msg.hidden = true;
    setMode(F.mode);
  }

  function setMode(m) {
    F.mode = m; F.target = null; F.path = null;
    F.root.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    if (F.ceil) F.ceil.visible = m === 'walk';
    if (F.scene) { F.scene.fog = m === 'walk' ? F.fog : null; F.scene.background = new THREE.Color(m === 'walk' ? (F.under ? 0x1d2024 : 0xcfe3f5) : 0xe9e6e1); }
    const touch = matchMedia('(pointer: coarse)').matches;
    $('.tour-joy', F.root).hidden = !(m === 'walk' && touch);
    $('.tour-mini', F.root).hidden = m !== 'walk';
    $('.tour-help', F.root).textContent = m === 'walk'
      ? (touch ? 'Джойстик — идти, ведите пальцем — осмотреться, нажмите на пол или мини-карту — пойти туда' : 'W A S D или стрелки — идти · тяните мышью — осмотреться · клик по полу или мини-карте — пойти туда')
      : 'Тяните — повернуть · колесо или два пальца — приблизить · нажмите на место — войти туда';
  }

  // мини-карта этажа
  function buildMini(plan) {
    const box = $('.tour-mini', F.root), mc = $('canvas', box), L = F.L, touch = matchMedia('(pointer: coarse)').matches;
    const MS = touch ? 190 : 280, sc = MS / Math.max(L.w, L.h), dpr = Math.min(2, devicePixelRatio || 1);
    const mw = Math.round(L.w * sc), mh = Math.round(L.h * sc);
    mc.width = mw * dpr; mc.height = mh * dpr; mc.style.width = mw + 'px'; mc.style.height = mh + 'px';
    const g = mc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    F.mini = { g, mw, mh, sc, plan, key: '' };
    mc.onpointerdown = (e) => { e.stopPropagation(); const r = mc.getBoundingClientRect(); goTo((e.clientX - r.left) / sc, (e.clientY - r.top) / sc); };
  }
  function drawMini() {
    const m = F.mini, w = F.walk; if (!m) return;
    const key = w.x.toFixed(1) + w.z.toFixed(1) + w.yaw.toFixed(2); if (key === m.key) return; m.key = key;
    const { g, mw, mh, sc } = m;
    g.clearRect(0, 0, mw, mh); g.drawImage(m.plan, 0, 0, mw, mh);
    const px = w.x * sc, pz = w.z * sc;
    const cone = g.createRadialGradient(px, pz, 2, px, pz, 40); cone.addColorStop(0, 'rgba(212,87,42,.85)'); cone.addColorStop(1, 'rgba(212,87,42,.05)');
    g.fillStyle = cone; g.beginPath(); g.moveTo(px, pz); g.arc(px, pz, 40, w.yaw - Math.PI / 2 - 0.6, w.yaw - Math.PI / 2 + 0.6); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(px, pz, 6, 0, 7); g.fill(); g.fillStyle = '#d4572a'; g.beginPath(); g.arc(px, pz, 4, 0, 7); g.fill();
  }

  // путь в обход стен по сетке 25 см
  function goTo(x, z) {
    const s = 5, W = Math.ceil(F.M.W / s), H = Math.ceil(F.M.H / s), c = F.cell * s;
    const ok = (i) => F.free((i % W + 0.5) * c, (Math.floor(i / W) + 0.5) * c);
    const si = Math.floor(F.walk.z / c) * W + Math.floor(F.walk.x / c), gi = Math.floor(z / c) * W + Math.floor(x / c);
    if (gi < 0 || gi >= W * H || !ok(gi)) return;
    const prev = new Int32Array(W * H).fill(-1); prev[si] = si; const q = [si];
    for (let h = 0; h < q.length && prev[gi] < 0; h++) { const j = q[h], cx = j % W; for (const n of [cx > 0 ? j - 1 : -1, cx < W - 1 ? j + 1 : -1, j - W, j + W]) if (n >= 0 && n < W * H && prev[n] < 0 && ok(n)) { prev[n] = j; q.push(n); } }
    if (prev[gi] < 0) return;
    const cells = []; for (let j = gi; j !== si; j = prev[j]) cells.push(j); cells.reverse();
    F.path = cells.filter((_, k) => k % 3 === 2 || k === cells.length - 1).map((j) => [(j % W + 0.5) * c, (Math.floor(j / W) + 0.5) * c]);
    F.target = F.path.shift() || null;
  }

  function setupControls() {
    const canvas = $('canvas', F.root), ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), pts = new Map();
    let drag = null, pinch = null;
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); drag = { x: e.clientX, y: e.clientY, moved: 0 }; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || !pts.has(e.pointerId) || !F.walk) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); F.orbit.r = Math.max(8, Math.min(220, F.orbit.r * pinch / d)); pinch = d; drag.moved = 99; return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      if (F.mode === 'walk') { F.walk.yaw -= dx * 0.005; F.walk.pitch = Math.max(-1.2, Math.min(1.2, F.walk.pitch + dy * 0.004)); }
      else { F.orbit.yaw += dx * 0.006; F.orbit.pitch = Math.max(0.3, Math.min(1.5, F.orbit.pitch + dy * 0.005)); }
    });
    const up = (e) => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (drag && drag.moved < 6 && pts.size === 0 && F.floor) {
        const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
        ray.setFromCamera(ndc, F.cam); const hit = ray.intersectObject(F.floor)[0];
        if (hit && F.free(hit.point.x, hit.point.z)) {
          if (F.mode === 'top') { F.walk.x = hit.point.x; F.walk.z = hit.point.z; F.walk.yaw = -F.orbit.yaw; setMode('walk'); }
          else goTo(hit.point.x, hit.point.z);
        }
      }
      if (pts.size === 0) drag = null;
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (F.mode === 'top') F.orbit.r = Math.max(8, Math.min(220, F.orbit.r * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
    const joy = $('.tour-joy', F.root), knob = $('i', joy); let jid = null;
    const jmove = (e) => { const r = joy.getBoundingClientRect(); let dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2; const L = Math.hypot(dx, dy), M = r.width / 2 - 14; if (L > M) { dx *= M / L; dy *= M / L; } knob.style.transform = `translate(${dx}px,${dy}px)`; F.joy = [dx / M, dy / M]; };
    joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); jmove(e); F.target = null; F.path = null; });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) jmove(e); });
    const jend = () => { jid = null; F.joy = [0, 0]; knob.style.transform = ''; };
    joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);
  }

  function step(now) {
    const dt = Math.min(0.05, (now - F.last) / 1000); F.last = now;
    if (!F.scene || !F.walk) return;
    const w = F.walk, cam = F.cam;
    if (F.mode === 'walk') {
      const k = F.keys; let f = 0, s = 0;
      if (k.KeyW || k.ArrowUp) f += 1; if (k.KeyS || k.ArrowDown) f -= 1; if (k.KeyD) s += 1; if (k.KeyA) s -= 1;
      if (k.ArrowLeft) w.yaw -= 1.8 * dt; if (k.ArrowRight) w.yaw += 1.8 * dt;
      f -= F.joy[1]; s += F.joy[0];
      if ((f || s) && F.target) { F.target = null; F.path = null; }
      let mx = Math.sin(w.yaw) * f + Math.cos(w.yaw) * s, mz = -Math.cos(w.yaw) * f + Math.sin(w.yaw) * s;
      if (F.target) {
        const dx = F.target[0] - w.x, dz = F.target[1] - w.z, d = Math.hypot(dx, dz);
        if (d < 0.2) { F.target = F.path && F.path.length ? F.path.shift() : null; }
        else { mx = dx / d; mz = dz / d; let dd = Math.atan2(dx, -dz) - w.yaw; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); w.yaw += dd * Math.min(1, dt * 4); }
      }
      const L = Math.hypot(mx, mz);
      if (L > 0) {
        const st = 2.2 * dt / Math.max(1, L);
        const okx = F.free(w.x + mx * st, w.z); if (okx) w.x += mx * st;
        const okz = F.free(w.x, w.z + mz * st); if (okz) w.z += mz * st;
        if (!okx && !okz && F.target) { w.x = F.target[0]; w.z = F.target[1]; }
      }
      cam.position.set(w.x, Math.min(EYE, F.H - 0.3), w.z);
      cam.lookAt(w.x + Math.sin(w.yaw) * Math.cos(w.pitch), cam.position.y + Math.sin(w.pitch), w.z - Math.cos(w.yaw) * Math.cos(w.pitch));
      drawMini();
    } else {
      const o = F.orbit;
      cam.position.set(o.cx + Math.sin(o.yaw) * Math.cos(o.pitch) * o.r, Math.sin(o.pitch) * o.r, o.cz + Math.cos(o.yaw) * Math.cos(o.pitch) * o.r);
      cam.lookAt(o.cx, 0, o.cz);
    }
    F.renderer.render(F.scene, cam);
  }

  window.YurtaFloorTour = { open, close, _dbg: () => F };
})();
