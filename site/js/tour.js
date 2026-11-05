/* Объекты — 3D-тур по квартире.
   Стены строятся автоматически из картинки планировки: тёмные толстые линии плана → стены нужной высоты,
   пол — сама планировка (видно комнаты, подписи, мебель). Режимы: «Сверху» и «Прогулка» от первого лица. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const CELL = 0.05;     // размер клетки сетки, м
  const EYE = 1.6;       // высота глаз, м
  const RADIUS = 0.22;   // «толщина» гостя для столкновений, м
  let T = null;          // текущий тур

  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function distToEdges(pt, poly) {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, t = Math.max(0, Math.min(1, ((pt[0] - ax) * (bx - ax) + (pt[1] - ay) * (by - ay)) / L2));
      best = Math.min(best, Math.hypot(pt[0] - ax - t * (bx - ax), pt[1] - ay - t * (by - ay)));
    }
    return best;
  }
  const polyArea = (p) => Math.abs(p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;

  /* ---------- Разбор планировки: где стены ---------- */
  function analyse(img, o, thr = 140) {
    const sx = img.naturalWidth / o.planW, sy = img.naturalHeight / o.planH;
    const polyPx = o.poly.map(([x, y]) => [x * sx, y * sy]);
    // масштаб: контур квартиры на плане включает стены, поэтому чистая площадь ≈ 88% площади контура
    const mpp = Math.sqrt(o.area / (polyArea(polyPx) * 0.88));
    const marg = 0.35 / mpp;
    const xs = polyPx.map((q) => q[0]), ys = polyPx.map((q) => q[1]);
    const X0 = Math.max(0, Math.floor(Math.min(...xs) - marg)), Y0 = Math.max(0, Math.floor(Math.min(...ys) - marg));
    const X1 = Math.min(img.naturalWidth, Math.ceil(Math.max(...xs) + marg)), Y1 = Math.min(img.naturalHeight, Math.ceil(Math.max(...ys) + marg));
    const w = X1 - X0, h = Y1 - Y0;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'); g.drawImage(img, X0, Y0, w, h, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    const fl = document.createElement('canvas'); fl.width = w; fl.height = h; const fg2 = fl.getContext('2d');
    fg2.fillStyle = '#cfae84'; fg2.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += Math.max(6, Math.round(0.12 / Math.max(0.01, Math.sqrt(o.area / 1e6))))) { fg2.fillStyle = 'rgba(120,80,40,.10)'; fg2.fillRect(0, y, w, 1); }
    fg2.globalCompositeOperation = 'multiply'; fg2.drawImage(cv, 0, 0);
    // тёмные серые пиксели — стены; цветные заливки комнат и тонкие линии мебели — нет
    let dark = new Uint8Array(w * h);
    for (let i = 0, k = 0; i < px.length; i += 4, k++) {
      const r = px[i], gg = px[i + 1], b = px[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      dark[k] = (0.3 * r + 0.59 * gg + 0.11 * b) < thr && mx - mn < (thr > 190 ? 9 : thr > 150 ? 40 : 60) ? 1 : 0;
    }
    // убираем тонкие штрихи (текст, размеры): сжатие и расширение 3×3
    const morph = (src, keep) => { const out = new Uint8Array(w * h); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += src[(y + dy) * w + x + dx]; out[y * w + x] = keep(c) ? 1 : 0; } return out; };
    dark = morph(morph(dark, (c) => c === 9), (c) => c > 0);
    if (thr > 190) dark = morph(morph(morph(morph(dark, (c) => c === 9), (c) => c === 9), (c) => c > 0), (c) => c > 0); // серая заливка стен: убираем ещё и линии мебели
    // сетка 5 см
    const cp = Math.max(1, Math.round(CELL / mpp)), cell = cp * mpp;
    const W = Math.floor(w / cp), H = Math.floor(h / cp);
    const polyM = polyPx.map(([x, y]) => [(x - X0) * mpp, (y - Y0) * mpp]);
    const wall = new Uint8Array(W * H), inner = new Uint8Array(W * H), edge = new Float32Array(W * H);
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      let c = 0;
      for (let y = cy * cp; y < (cy + 1) * cp; y++) for (let x = cx * cp; x < (cx + 1) * cp; x++) c += dark[y * w + x];
      const pt = [(cx + 0.5) * cell, (cy + 0.5) * cell], i = cy * W + cx;
      const ins = pointInPoly(pt, polyM), d = distToEdges(pt, polyM);
      edge[i] = ins ? d : -d;
      inner[i] = edge[i] > -0.3 ? 1 : 0; // внутри контура (с запасом 30 см на наружные стены)
      wall[i] = c / (cp * cp) >= 0.4 && inner[i] ? 1 : 0;
    }
    // убираем мелкие пятна (значки, подписи) меньше 0,06 м²
    const seen = new Uint8Array(W * H), minCells = 0.06 / (cell * cell);
    for (let i = 0; i < W * H; i++) {
      if (!wall[i] || seen[i]) continue;
      const comp = [i], st = [i]; seen[i] = 1;
      while (st.length) { const j = st.pop(), x = j % W, y = (j / W) | 0; for (const n of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1]) if (n >= 0 && wall[n] && !seen[n]) { seen[n] = 1; comp.push(n); st.push(n); } }
      if (comp.length < minCells) comp.forEach((j) => { wall[j] = 0; });
    }
    // проёмы в наружной стене (окна): свободная клетка у края контура, по обе стороны которой
    // вдоль той же линии стоит стена (разрыв в линии стены длиной до 2,4 м)
    const opening = new Uint8Array(W * H), span = Math.round(1.2 / cell);
    const isW = (x, y) => x >= 0 && y >= 0 && x < W && y < H && wall[y * W + x] === 1 && Math.abs(edge[y * W + x]) < 0.45;
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx; if (wall[i] || !inner[i] || Math.abs(edge[i]) > 0.35) continue;
      let l = false, r = false, u = false, d = false;
      for (let k = 1; k <= span; k++) { l = l || isW(cx - k, cy); r = r || isW(cx + k, cy); u = u || isW(cx, cy - k); d = d || isW(cx, cy + k); }
      if ((l && r) || (u && d)) opening[i] = 1;
    }
    let walls = 0; for (let i = 0; i < W * H; i++) walls += wall[i];
    return { wallM2: walls * cell * cell, cv: fl, W, H, cell, wall, inner, edge, opening, polyM, wm: w * mpp, hm: h * mpp, ok: walls * cell * cell > 2.5 };
  }

  /* ---------- Геометрия ---------- */
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
  function boxesGeometry(list) {
    const P = [], N = [], I = [];
    for (const [x0, z0, x1, z1, y0, y1] of list) {
      const F = [[[0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]], [[0, -1, 0], [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]]],
        [[1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]], [[-1, 0, 0], [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]]],
        [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]]];
      for (const [n, q] of F) { const k = P.length / 3; q.forEach((v) => { P.push(...v); N.push(...n); }); I.push(k, k + 1, k + 2, k, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I);
    return g;
  }
  function build(A, height) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfe3f5);
    scene.fog = new THREE.Fog(0xcfe3f5, 40, 160);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a948a, 0.75));
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const sun = new THREE.DirectionalLight(0xfff3e0, 0.45); sun.position.set(8, 20, 5); scene.add(sun);
    const c = A.cell, wallMat = new THREE.MeshLambertMaterial({ color: 0xf2f0eb, side: THREE.DoubleSide });
    const R = (grid) => rects(grid, A.W, A.H).map(([x, y, w, h]) => [x * c, y * c, (x + w) * c, (y + h) * c]);
    const walls = new THREE.Mesh(boxesGeometry(R(A.wall).map((r) => [...r, 0, height])), wallMat); scene.add(walls);
    // окна: подоконник 0,85 м и перемычка над окном, стекло
    const ops = R(A.opening);
    scene.add(new THREE.Mesh(boxesGeometry(ops.map((r) => [...r, 0, 0.85])), new THREE.MeshLambertMaterial({ color: 0xe6e2da })));
    scene.add(new THREE.Mesh(boxesGeometry(ops.map((r) => [...r, height - 0.45, height])), wallMat));
    const glass = new THREE.Mesh(boxesGeometry(ops.map(([x0, z0, x1, z1]) => { const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, wide = x1 - x0 > z1 - z0; return wide ? [x0, cz - 0.01, x1, cz + 0.01, 0.85, height - 0.45] : [cx - 0.01, z0, cx + 0.01, z1, 0.85, height - 0.45]; })),
      new THREE.MeshLambertMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.18, depthWrite: false }));
    scene.add(glass);
    // пол — сама планировка
    const shape = new THREE.Shape(A.polyM.map(([x, z]) => new THREE.Vector2(x, -z)));
    const fg = new THREE.ShapeGeometry(shape), pos = fg.attributes.position, uv = [];
    for (let i = 0; i < pos.count; i++) uv.push(pos.getX(i) / A.wm, 1 + pos.getY(i) / A.hm);
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const tex = new THREE.CanvasTexture(A.cv); tex.anisotropy = 8;
    const floor = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const ceil = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xf1efea, side: THREE.DoubleSide }));
    ceil.rotation.x = -Math.PI / 2; ceil.position.y = height; scene.add(ceil);
    // земля далеко внизу — вид в окно
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: 0x9cbf7d }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(A.wm / 2, -25, A.hm / 2); scene.add(ground);
    return { scene, floor, ceil, walls, tex, ground };
  }

  /* ---------- Интерфейс ---------- */
  function close() {
    if (!T) return;
    cancelAnimationFrame(T.raf); window.removeEventListener('keydown', T.kd); window.removeEventListener('keyup', T.ku); window.removeEventListener('resize', T.rs);
    if (T.renderer) T.renderer.dispose();
    if (T.scene) T.scene.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } });
    T.root.remove(); T = null;
  }
  function open(o) {
    close();
    const root = document.createElement('div'); root.className = 'tour';
    root.innerHTML = `<canvas></canvas>
      <div class="tour-top"><div><b>🏠 3D-тур по квартире</b><span>${o.title}</span></div>
        <div class="tour-modes"><button data-m="top" class="on">Сверху</button><button data-m="walk">🚶 Прогулка</button></div>
        <button class="tour-x" aria-label="Закрыть">✕</button></div>
      <div class="tour-help"></div>
      <div class="tour-joy" hidden><i></i></div>
      <div class="tour-msg">Строю 3D по планировке…</div>`;
    document.body.append(root);
    T = { root, mode: 'top', keys: {}, joy: [0, 0], target: null };
    $('.tour-x', root).onclick = close;
    const img = new Image();
    img.onload = () => { try { start(img, o); } catch (e) { $('.tour-msg', root).textContent = 'Не удалось построить 3D: ' + e.message; } };
    img.onerror = () => { $('.tour-msg', root).textContent = 'Не удалось загрузить планировку'; };
    img.src = o.img;
  }
  function start(img, o) {
    const root = T.root, H = o.height || 2.8;
    let A = analyse(img, o);
    // на разных планах стены нарисованы по-разному: тёмные, светлее, серая заливка с обводкой — берём вариант, где стен больше всего
    if (!A.ok || A.wallM2 < o.area * 0.12) for (const thr of [170, 215]) { const B2 = analyse(img, o, thr); if (B2.ok && B2.wallM2 > (A.ok ? A.wallM2 : 0) * 1.3) A = B2; }
    if (!A.ok) { $('.tour-msg', root).textContent = 'Для этой планировки 3D-тур пока недоступен — на плане не удалось найти стены.'; return; }
    $('.tour-msg', root).remove();
    const canvas = $('canvas', root);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    const B = build(A, H), scene = B.scene;
    const cam = new THREE.PerspectiveCamera(70, 1, 0.05, 500);
    Object.assign(T, { renderer, scene, A, H });
    const resize = () => { renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); };
    T.rs = resize; window.addEventListener('resize', resize); resize();

    // свободна ли точка (x, z) для прохода
    const free = (x, z) => {
      const r = Math.ceil(RADIUS / A.cell), cx = Math.floor(x / A.cell), cz = Math.floor(z / A.cell);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const X = cx + dx, Z = cz + dz;
        if (X < 0 || Z < 0 || X >= A.W || Z >= A.H) return false;
        const i = Z * A.W + X; if (A.wall[i] || A.opening[i] || A.edge[i] < 0.05) return false;
      }
      return true;
    };
    // старт: свободная точка ближе к центру, взгляд туда, где больше места
    const ctr = A.polyM.reduce((s, q) => [s[0] + q[0] / A.polyM.length, s[1] + q[1] / A.polyM.length], [0, 0]);
    let best = null;
    for (let z = 0; z < A.H; z += 3) for (let x = 0; x < A.W; x += 3) { const px = (x + 0.5) * A.cell, pz = (z + 0.5) * A.cell; if (!free(px, pz)) continue; const d = Math.hypot(px - ctr[0], pz - ctr[1]); if (!best || d < best.d) best = { d, x: px, z: pz }; }
    const walk = { x: best ? best.x : ctr[0], z: best ? best.z : ctr[1], yaw: 0, pitch: -0.05 };
    let far = -1;
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; let t = 0; while (t < 12 && free(walk.x + Math.sin(a) * t, walk.z - Math.cos(a) * t)) t += 0.1; if (t > far) { far = t; walk.yaw = a; } }
    const orbit = { yaw: 0.6, pitch: 1.0, r: Math.max(A.wm, A.hm) * 1.05 + 3, cx: ctr[0], cz: ctr[1] };

    const help = $('.tour-help', root), joy = $('.tour-joy', root), touch = matchMedia('(pointer: coarse)').matches;
    const setMode = (m) => {
      T.mode = m; T.target = null;
      root.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
      B.ceil.visible = m === 'walk'; B.ground.visible = m === 'walk';
      joy.hidden = !(m === 'walk' && touch);
      help.textContent = m === 'walk'
        ? (touch ? 'Джойстик слева — идти, проведите пальцем — осмотреться, коснитесь пола — перейти туда' : 'W A S D или стрелки — идти · тяните мышью — осмотреться · клик по полу — перейти туда')
        : 'Тяните — повернуть · колесо или два пальца — приблизить · нажмите на комнату — войти туда';
    };
    root.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => setMode(b.dataset.m));
    setMode('top');

    // управление мышью и пальцем
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let drag = null, pinch = null;
    const pts = new Map();
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); drag = { x: e.clientX, y: e.clientY, moved: 0 }; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); orbit.r = Math.max(4, Math.min(60, orbit.r * pinch / d)); pinch = d; drag.moved = 99; return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      if (T.mode === 'walk') { walk.yaw += dx * 0.005; walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - dy * 0.004)); }
      else { orbit.yaw += dx * 0.006; orbit.pitch = Math.max(0.25, Math.min(1.5, orbit.pitch + dy * 0.005)); }
    });
    const up = (e) => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (drag && drag.moved < 6 && pts.size === 0) { // клик по полу
        const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
        ray.setFromCamera(ndc, cam); const hit = ray.intersectObject(B.floor)[0];
        if (hit && free(hit.point.x, hit.point.z)) {
          if (T.mode === 'top') { walk.x = hit.point.x; walk.z = hit.point.z; walk.yaw = orbit.yaw + Math.PI; setMode('walk'); }
          else T.target = [hit.point.x, hit.point.z];
        }
      }
      if (pts.size === 0) drag = null;
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (T.mode === 'top') orbit.r = Math.max(4, Math.min(60, orbit.r * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
    T.kd = (e) => { T.keys[e.code] = true; if (e.code === 'Escape') close(); }; T.ku = (e) => { T.keys[e.code] = false; };
    window.addEventListener('keydown', T.kd); window.addEventListener('keyup', T.ku);
    // джойстик на телефоне
    const knob = $('i', joy); let jid = null;
    const jmove = (e) => { const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = e.clientX - cx, dy = e.clientY - cy; const L = Math.hypot(dx, dy), M = r.width / 2 - 14; if (L > M) { dx *= M / L; dy *= M / L; } knob.style.transform = `translate(${dx}px,${dy}px)`; T.joy = [dx / M, dy / M]; };
    joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); jmove(e); T.target = null; });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) jmove(e); });
    const jend = () => { jid = null; T.joy = [0, 0]; knob.style.transform = ''; };
    joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);

    let last = performance.now();
    const loop = (now) => {
      if (!T || T.renderer !== renderer) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (T.mode === 'walk') {
        const k = T.keys; let f = 0, s = 0;
        if (k.KeyW || k.ArrowUp) f += 1; if (k.KeyS || k.ArrowDown) f -= 1;
        if (k.KeyD) s += 1; if (k.KeyA) s -= 1;
        if (k.ArrowLeft) walk.yaw -= 1.8 * dt; if (k.ArrowRight) walk.yaw += 1.8 * dt;
        f -= T.joy[1]; s += T.joy[0];
        let mx = (Math.sin(walk.yaw) * f + Math.cos(walk.yaw) * s), mz = (-Math.cos(walk.yaw) * f + Math.sin(walk.yaw) * s);
        if (T.target && !f && !s) {
          const dx = T.target[0] - walk.x, dz = T.target[1] - walk.z, d = Math.hypot(dx, dz);
          if (d < 0.08) T.target = null; else { mx = dx / d; mz = dz / d; const ty = Math.atan2(dx, -dz); let dd = ty - walk.yaw; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); walk.yaw += dd * Math.min(1, dt * 4); }
        }
        const L = Math.hypot(mx, mz);
        if (L > 0) {
          const st = 1.5 * dt / Math.max(1, L);
          if (free(walk.x + mx * st, walk.z)) walk.x += mx * st; else if (T.target) T.target = null;
          if (free(walk.x, walk.z + mz * st)) walk.z += mz * st; else if (T.target) T.target = null;
        }
        cam.position.set(walk.x, Math.min(EYE, H - 0.3), walk.z);
        cam.lookAt(walk.x + Math.sin(walk.yaw) * Math.cos(walk.pitch), cam.position.y + Math.sin(walk.pitch), walk.z - Math.cos(walk.yaw) * Math.cos(walk.pitch));
      } else {
        cam.position.set(orbit.cx + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.r, Math.sin(orbit.pitch) * orbit.r, orbit.cz + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.r);
        cam.lookAt(orbit.cx, 0, orbit.cz);
      }
      renderer.render(scene, cam);
      T.raf = requestAnimationFrame(loop);
    };
    T.raf = requestAnimationFrame(loop);
    T.debug = { A, walk, orbit, setMode };
  }

  window.YurtaTour = { open, close, _analyse: analyse };
})();
