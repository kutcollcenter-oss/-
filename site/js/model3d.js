/* Юрта — реалистичные 3D-модели ЖК поверх карты (three.js как custom layer MapLibre) */
(function () {
  const BAY = 3.2;          // ширина одной оси окна, м
  const ATLAS_BAYS = 4, ATLAS_FLOORS = 8;

  /* ---------- Текстуры ---------- */
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  }
  function litGlass(g, x, y, w, h, r) {
    const gr = g.createLinearGradient(x, y, x, y + h);
    const warm = r() < 0.5;
    gr.addColorStop(0, warm ? '#fbe2b0' : '#f6efd8'); gr.addColorStop(1, warm ? '#cf8f4e' : '#c9a774');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
  }
  function darkGlass(g, x, y, w, h, r) {
    const k = r() * 22;
    const gr = g.createLinearGradient(x, y, x + w * 0.6, y + h);
    gr.addColorStop(0, `rgb(${96 + k},${112 + k},${130 + k})`);
    gr.addColorStop(0.45, `rgb(${58 + k / 2},${70 + k / 2},${86 + k / 2})`);
    gr.addColorStop(1, `rgb(${34},${41},${52})`);
    g.fillStyle = gr; g.fillRect(x, y, w, h);
  }
  // Altay Gold (как на рендерах V7): витражи в пол, белые вертикальные рамы, тёплый свет в части окон
  function texGold(seed) {
    return canvasTex(1024, 1024, (g, W, H) => {
      const r = rng(seed), bw = W / ATLAS_BAYS, fh = H / ATLAS_FLOORS;
      // небо в стекле: общий вертикальный градиент на весь атлас
      for (let f = 0; f < ATLAS_FLOORS; f++) for (let b = 0; b < ATLAS_BAYS; b++) {
        const x = b * bw, y = f * fh;
        const lit = r() < 0.2;
        if (lit) litGlass(g, x, y, bw, fh, r);
        else {
          const k = r() * 16, gr = g.createLinearGradient(x, y, x + bw, y + fh);
          gr.addColorStop(0, `rgb(${120 + k},${134 + k},${150 + k})`);
          gr.addColorStop(0.5, `rgb(${70 + k},${82 + k},${98 + k})`);
          gr.addColorStop(1, `rgb(${46},${54},${66})`);
          g.fillStyle = gr; g.fillRect(x, y, bw, fh);
        }
        if (lit) { g.fillStyle = 'rgba(90,60,30,.18)'; g.fillRect(x + bw * 0.15, y + fh * 0.55, bw * 0.3, fh * 0.35); }
        g.fillStyle = '#2b3037'; g.fillRect(x + bw * 0.5 - 3, y, 6, fh);                      // импост
        g.fillStyle = 'rgba(30,34,40,.55)'; g.fillRect(x, y + fh * 0.86, bw, fh * 0.06);        // ограждение
        g.fillStyle = '#4a515b'; g.fillRect(x, y + fh - 7, bw, 7);                             // перекрытие (тонко)
        g.fillStyle = '#f3f2ee'; g.fillRect(x, y, 34, fh);                                     // белая рама
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + 34, y, 5, fh);
      }
    });
  }
  // Altay Ordo: белая штукатурка, тёмные окна разной ширины, чёрные вставки
  function texOrdo(seed) {
    return canvasTex(1024, 1024, (g, W, H) => {
      const r = rng(seed), bw = W / ATLAS_BAYS, fh = H / ATLAS_FLOORS;
      g.fillStyle = '#efeeea'; g.fillRect(0, 0, W, H);
      for (let f = 0; f < ATLAS_FLOORS; f++) for (let b = 0; b < ATLAS_BAYS; b++) {
        const x = b * bw, y = f * fh, t = r();
        if (t < 0.16) { // чёрная вставка во всю ячейку
          g.fillStyle = '#26282c'; g.fillRect(x + 6, y, bw - 12, fh);
          if (r() < 0.6) { r() < 0.3 ? litGlass(g, x + bw * 0.3, y + fh * 0.16, bw * 0.4, fh * 0.66, r) : darkGlass(g, x + bw * 0.3, y + fh * 0.16, bw * 0.4, fh * 0.66, r); }
          continue;
        }
        const ww = t < 0.55 ? 0.42 : t < 0.85 ? 0.62 : 0.22;
        const wx = x + bw * (0.5 - ww / 2), wy = y + fh * 0.14, wh = fh * 0.7;
        g.fillStyle = '#d9d8d3'; g.fillRect(wx - 5, wy - 5, bw * ww + 10, wh + 10);
        if (r() < 0.14) litGlass(g, wx, wy, bw * ww, wh, r); else darkGlass(g, wx, wy, bw * ww, wh, r);
        g.fillStyle = '#1d2026'; g.fillRect(wx + bw * ww / 2 - 2, wy, 4, wh);
        g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(x, y + fh - 4, bw, 4);
      }
    });
  }
  // Витрины коммерции: высокое тёплое остекление с белыми поясами
  function texShop(seed) {
    return canvasTex(1024, 512, (g, W, H) => {
      const r = rng(seed), bw = W / 4, fh = H / 2;
      for (let f = 0; f < 2; f++) for (let b = 0; b < 4; b++) {
        const x = b * bw, y = f * fh;
        if (r() < 0.45) litGlass(g, x, y, bw, fh, r); else darkGlass(g, x, y, bw, fh, r);
        g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + bw * 0.08, y + fh * 0.3, bw * 0.2, fh * 0.6);
        g.fillStyle = '#23262b'; g.fillRect(x + bw / 3, y, 4, fh); g.fillRect(x + 2 * bw / 3, y, 4, fh);
        g.fillStyle = '#f4f3ef'; g.fillRect(x, y, bw, fh * 0.2);            // белый пояс-перекрытие
        g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(x, y + fh * 0.2, bw, 4);
        g.fillStyle = '#f4f3ef'; g.fillRect(x, y, 18, fh);                  // пилон
      }
    });
  }
  // Алтай Плюс: светло-серый керамогранит, узкие окна в белых рамах, тёмные вертикальные вставки
  function texPlus(seed) {
    return canvasTex(1024, 1024, (g, W, H) => {
      const r = rng(seed), bw = W / ATLAS_BAYS, fh = H / ATLAS_FLOORS;
      g.fillStyle = '#d9d9d6'; g.fillRect(0, 0, W, H);
      for (let f = 0; f < ATLAS_FLOORS; f++) for (let b = 0; b < ATLAS_BAYS; b++) {
        const x = b * bw, y = f * fh;
        if (b === 3) { g.fillStyle = '#4b4f55'; g.fillRect(x + bw * 0.1, y, bw * 0.8, fh); }
        for (const wx of [0.14, 0.56]) {
          const X = x + bw * wx, Y = y + fh * 0.1, w = bw * 0.3, h = fh * 0.78;
          g.fillStyle = '#fbfbf9'; g.fillRect(X - 6, Y - 6, w + 12, h + 12);
          if (r() < 0.15) litGlass(g, X, Y, w, h, r); else darkGlass(g, X, Y, w, h, r);
          g.fillStyle = '#e9e9e5'; g.fillRect(X, Y + h * 0.62, w, 5);
        }
        g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(x, y + fh - 3, bw, 3);
      }
    });
  }
  // Многоуровневая автостоянка: бетонные пояса и тёмные проёмы
  function texParkade() {
    return canvasTex(512, 512, (g, W, H) => {
      g.fillStyle = '#c9c7c2'; g.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += H / 2) {
        g.fillStyle = '#2b2e33'; g.fillRect(0, y + H * 0.12, W, H * 0.3);
        for (let x = 0; x < W; x += W / 4) { g.fillStyle = '#c9c7c2'; g.fillRect(x, y + H * 0.12, 14, H * 0.3); }
      }
    });
  }
  function texKinder(seed) {
    return canvasTex(1024, 512, (g, W, H) => {
      const r = rng(seed), bw = W / 4, fh = H / 2;
      g.fillStyle = '#f1efe9'; g.fillRect(0, 0, W, H);
      const accents = ['#e8a34a', '#7fb2e5', '#8cc56b', '#e57a6a'];
      for (let f = 0; f < 2; f++) for (let b = 0; b < 4; b++) {
        const x = b * bw, y = f * fh;
        g.fillStyle = accents[(b + f) % 4]; g.fillRect(x + 10, y + fh * 0.1, 20, fh * 0.8);
        darkGlass(g, x + bw * 0.25, y + fh * 0.18, bw * 0.6, fh * 0.62, r);
      }
    });
  }

  /* ---------- Геометрия ---------- */
  const signedArea = (pts) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  const ccw = (pts) => (signedArea(pts) < 0 ? pts.slice().reverse() : pts);
  function offsetPoly(pts, d) {
    pts = ccw(pts); const n = pts.length;
    return pts.map((p, i) => {
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]];
      const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
      const n1 = [e1[1] / l1, -e1[0] / l1], n2 = [e2[1] / l2, -e2[0] / l2];
      const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
      return [p[0] + d * (n1[0] + n2[0]) / k, p[1] + d * (n1[1] + n2[1]) / k];
    });
  }
  // Стены по контуру: UV привязаны к осям окон и этажам
  function wallGeometry(pts, z0, z1, uSize, vSize, vOrigin = z0, skip = null) {
    pts = ccw(pts);
    const pos = [], nor = [], uv = [], idx = [];
    let u0 = 0;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.01) return;
      if (skip && skip.has(i)) { u0 += len / uSize; return; }
      const nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len;
      const base = pos.length / 3;
      const ua = u0, ub = u0 + len / uSize;
      const va = (z0 - vOrigin) / vSize, vb = (z1 - vOrigin) / vSize;
      pos.push(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1, a[0], a[1], z1);
      for (let k = 0; k < 4; k++) nor.push(nx, ny, 0);
      uv.push(ua, va, ub, va, ub, vb, ua, vb);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      u0 = Math.round(ub * 4) / 4; // следующая грань начинается с целой оси
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  const shapeOf = (pts) => new THREE.Shape(ccw(pts).map(([x, y]) => new THREE.Vector2(x, y)));
  function flat(pts, z, mat) { const m = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(pts)), mat); m.position.z = z; return m; }
  function slab(pts, z0, z1, mat) { const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeOf(pts), { depth: z1 - z0, bevelEnabled: false }), mat); m.position.z = z0; return m; }
  function oval(c, rx, ry, z, mat) { const pts = Array.from({ length: 32 }, (_, k) => [c[0] + rx * Math.cos(k / 32 * Math.PI * 2), c[1] + ry * Math.sin(k / 32 * Math.PI * 2)]); return flat(pts, z, mat); }

  const lambert = (opts) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, ...opts });

  /* ---------- Детали: заезды в паркинг, навесы, парковки ---------- */
  function quad(a, b, c, d, uv = [0, 0, 1, 0, 1, 1, 0, 1]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]], 2));
    g.computeVertexNormals();
    return g;
  }
  function boxMesh(x0, y0, z0, x1, y1, z1, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return m;
  }
  // Тёмные вертикальные ламели (облицовка заезда в паркинг на рендерах Altay Gold)
  function texSlats() {
    return canvasTex(256, 256, (g, W, H) => {
      g.fillStyle = '#30353b'; g.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 16) { g.fillStyle = '#454b53'; g.fillRect(x, 0, 7, H); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 7, 0, 2, H); }
    });
  }
  // Портал въезда: белая стена, светящееся окно, секционные ворота
  function texGate() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#efeee9'; g.fillRect(0, 0, 512, 512);
    const lg = g.createLinearGradient(0, 120, 0, 210); lg.addColorStop(0, '#f7dba6'); lg.addColorStop(1, '#b98450');
    g.fillStyle = '#1e2126'; g.fillRect(60, 110, 392, 110); g.fillStyle = lg; g.fillRect(68, 118, 376, 94);
    for (let x = 68; x < 444; x += 47) { g.fillStyle = '#1e2126'; g.fillRect(x, 118, 4, 94); }
    g.fillStyle = '#1e2126'; g.fillRect(40, 270, 432, 242);
    g.fillStyle = '#c9ccd1'; g.fillRect(50, 280, 412, 232);
    for (let y = 280; y < 512; y += 29) { g.fillStyle = '#aeb2b8'; g.fillRect(50, y, 412, 3); }
    return new THREE.CanvasTexture(c);
  }
  function texSign(text, sub) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#1f5fbf'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#fff'; g.font = 'bold 92px Arial'; g.textBaseline = 'middle'; g.fillText(text, 18, 68);
    g.font = 'bold 34px Arial'; g.fillText(sub, 110, 68);
    return new THREE.CanvasTexture(c);
  }
  // Тёмный корпус вдоль южного фасада (по ГП): проезд под колоннадой; кровля высокая на западе
  // (примыкает к двору на кровле 3 этажа) и опускается к востоку; в самом восточном углу — ворота в паркинг.
  function buildRamp(root, r, pick, p) {
    const { x0, y0, x1, y1, hW, hE } = r;
    const h = (x) => hW + (hE - hW) * (x - x0) / (x1 - x0);
    const slat = lambert({ map: texSlats() }), dark = lambert({ color: 0x2c3036 }), col = lambert({ color: 0x3a3f46 });
    const tag = (m) => { m.userData = { pid: p.id, podium: true, label: r.name || 'Проезд и въезд в подземный паркинг' }; root.add(m); pick.push(m); return m; };
    const D = y1 - y0, gx0 = r.gate ? r.gate.px0 : x1;
    // торцы
    tag(new THREE.Mesh(quad([x0, y1, 0], [x0, y0, 0], [x0, y0, hW], [x0, y1, hW], [0, 0, D / 2, 0, D / 2, hW / 3, 0, hW / 3]), slat));
    tag(new THREE.Mesh(quad([x1, y0, 0], [x1, y1, 0], [x1, y1, hE], [x1, y0, hE], [0, 0, D / 2, 0, D / 2, hE / 3, 0, hE / 3]), slat));
    // задняя стена у стилобата и тень в глубине проезда
    tag(new THREE.Mesh(quad([x0, y1, 0], [x1, y1, 0], [x1, y1, hE], [x0, y1, hW]), dark));
    root.add(new THREE.Mesh(quad([x0, y0 + 2.4, 0], [gx0, y0 + 2.4, 0], [gx0, y0 + 2.4, h(gx0)], [x0, y0 + 2.4, hW]), lambert({ color: 0x1b1e22 })));
    // проезд: въезд с улицы на западе, к востоку уходит вниз к воротам
    root.add(new THREE.Mesh(quad([x0 + 0.5, y0 + 0.3, 0.06], [gx0, y0 + 0.3, 0.06], [gx0, y0 + D - 0.3, 0.06], [x0 + 0.5, y0 + D - 0.3, 0.06]), lambert({ color: 0x6f7377 })));
    // колоннада по улице (кроме пролёта ворот) и балка по низу кровли
    for (let x = x0 + 3.2; x < gx0 - 1.2; x += 3.2) root.add(boxMesh(x - 0.2, y0 - 0.2, 0, x + 0.2, y0 + 0.2, h(x) - 0.6, col));
    const beam = lambert({ color: 0x3f444b });
    root.add(new THREE.Mesh(quad([x0, y0 - 0.3, hW - 0.9], [x1, y0 - 0.3, hE - 0.9], [x1, y0 - 0.3, hE], [x0, y0 - 0.3, hW]), beam));
    // наклонная тёмная кровля с нависанием к улице
    const o = 0.9, roofMat = lambert({ color: 0x4a4f56 });
    tag(new THREE.Mesh(quad([x0 - 0.3, y0 - o, hW + 0.1], [x1 + 0.3, y0 - o, hE + 0.1], [x1 + 0.3, y1 + 0.2, hE + 0.1], [x0 - 0.3, y1 + 0.2, hW + 0.1]), roofMat));
    root.add(new THREE.Mesh(quad([x0, y1 - 0.2, hW + 0.1], [x1, y1 - 0.2, hE + 0.1], [x1, y1 - 0.2, hE + 1.0], [x0, y1 - 0.2, hW + 1.0]), dark)); // ограждение у двора
    if (r.gate) gatePortal(root, r.gate.px0, r.gate.px1, y0, r.gate.h, r.gate.sign, 'south');
  }
  // Портал с секционными воротами и светящимся козырьком. face: 'south' — смотрит на −y, 'north' — на +y
  function gatePortal(root, px0, px1, yf, hh, signText, face) {
    const s = face === 'north' ? -1 : 1; // направление «наружу» = −y*s
    const frame = lambert({ color: 0x2a2f35 }), wall = lambert({ color: 0xe9e7e2 });
    const Y = (d) => yf - d * s;
    const bx = (xa, da, za, xb, db, zb, m) => root.add(boxMesh(xa, Math.min(Y(da), Y(db)), za, xb, Math.max(Y(da), Y(db)), zb, m));
    bx(px0 - 0.9, -0.4, 0, px0, 1.4, hh + 1.0, frame);
    bx(px1, -0.4, 0, px1 + 0.9, 1.4, hh + 1.0, frame);
    bx(px0 - 0.9, -0.4, hh, px1 + 0.9, 1.4, hh + 1.0, frame);
    const gate = new THREE.Mesh(new THREE.PlaneGeometry(px1 - px0, hh), lambert({ map: texGate() }));
    gate.rotation.x = Math.PI / 2; if (s < 0) gate.rotation.y = Math.PI;
    gate.position.set((px0 + px1) / 2, Y(0.9), hh / 2); root.add(gate);
    bx(px0 - 0.3, -0.4, 0, px0, 0.9, hh, wall); bx(px1, -0.4, 0, px1 + 0.3, 0.9, hh, wall);
    const glow = new THREE.MeshBasicMaterial({ color: 0xfff3dc, side: THREE.DoubleSide });
    bx(px0 - 1.4, -0.4, hh + 1.0, px1 + 1.4, 3.0, hh + 1.2, glow);
    bx(px0 - 1.4, -0.4, hh + 1.2, px1 + 1.4, 3.0, hh + 1.5, frame);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: texSign('P', signText || '−2'), side: THREE.DoubleSide }));
    sign.rotation.x = Math.PI / 2; if (s < 0) sign.rotation.y = Math.PI;
    sign.position.set(px0 + 1.6, Y(1.45), hh + 0.5); root.add(sign);
  }
  // Пандус вниз в подземный паркинг с улицы: подпорные стенки, уклон, ворота у фасада
  function buildDownRamp(root, d) {
    const { x0, x1, yIn, yOut, depth } = d; // yIn — у здания, yOut — у улицы
    const wallM = lambert({ color: 0x9ea2a7 }), floorM = lambert({ color: 0x55585d }), white = lambert({ color: 0xf2f1ec });
    root.add(new THREE.Mesh(quad([x0, yOut, 0.1], [x1, yOut, 0.1], [x1, yIn, -depth], [x0, yIn, -depth]), floorM));
    for (const x of [x0, x1]) {
      root.add(new THREE.Mesh(quad([x, yOut, 0.1], [x, yIn, -depth], [x, yIn, 0.9], [x, yOut, 0.9]), wallM));
      root.add(boxMesh(x - 0.15, Math.min(yIn, yOut), 0.1, x + 0.15, Math.max(yIn, yOut), 1.0, white));
    }
    root.add(new THREE.Mesh(quad([x0, yIn, -depth], [x1, yIn, -depth], [x1, yIn, 0.9], [x0, yIn, 0.9]), lambert({ color: 0x1f2328 })));
    const g = new THREE.Group(); g.position.z = -depth; root.add(g); // ворота стоят на дне пандуса
    gatePortal(g, x0 + 0.3, x1 - 0.3, yIn, depth + 2.4, d.sign, yOut > yIn ? 'north' : 'south');
  }
  // Стеклянный арочный навес над въездом в подземный паркинг (ось — вдоль y)
  function buildVault(root, v) {
    const { cx, y0, y1, w, h } = v, r = w / 2, len = y1 - y0, cy = (y0 + y1) / 2;
    root.add(boxMesh(cx - r - 0.3, y0, 0, cx - r, y1, 0.7, lambert({ color: 0xe6e4df })));
    root.add(boxMesh(cx + r, y0, 0, cx + r + 0.3, y1, 0.7, lambert({ color: 0xe6e4df })));
    root.add(boxMesh(cx - r, y0, 0, cx + r, y1, 0.08, lambert({ color: 0x3b3f45 })));                 // пандус
    root.add(boxMesh(cx - r, y1 - 0.4, 0, cx + r, y1, h * 0.95, lambert({ color: 0x1f2328 })));        // вход в паркинг
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 28, 1, true, -Math.PI / 2, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x86d3c9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    glass.scale.z = h / r; glass.position.set(cx, cy, 0.7); root.add(glass);
    const ribMat = lambert({ color: 0xf2f2ee });
    for (let y = y0; y <= y1 + 0.01; y += 2.5) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 4, 20, Math.PI), ribMat);
      rib.rotation.x = Math.PI / 2; rib.scale.y = h / r; rib.position.set(cx, y, 0.7); root.add(rib);
    }
  }
  // Ряды парковочных мест: разметка + машины
  function buildParking(root, rows, seed) {
    if (!rows.length) return;
    const lines = [], cars = [], r = rng(seed + 77);
    const palette = [0xf2f2f2, 0xf2f2f2, 0xc5c8cc, 0x9aa0a6, 0x1d1f22, 0x1d1f22, 0x3a3f46, 0x8f1d1d, 0x1f3f7a, 0x7d6a55];
    for (const row of rows) {
      const [ax, ay] = row.a, [bx, by] = row.b;
      const L = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / L, dy = (by - ay) / L;
      const s = row.side || 1, nx = -dy * s, ny = dx * s, D = row.depth || 5.2, W = row.stall || 2.6, z = row.z || 0;
      const n = Math.floor(L / W), ang = Math.atan2(dy, dx);
      for (let i = 0; i <= n; i++) lines.push({ x: ax + dx * i * W + nx * D / 2, y: ay + dy * i * W + ny * D / 2, z: z + 0.2, sx: 0.12, sy: D, sz: 0.04, ang });
      for (let i = 0; i < n; i++) {
        if (r() > (row.fill ?? 0.55)) continue;
        const cxp = ax + dx * (i + 0.5) * W + nx * D * 0.5, cyp = ay + dy * (i + 0.5) * W + ny * D * 0.5;
        cars.push({ x: cxp, y: cyp, z, ang, col: palette[Math.floor(r() * palette.length)], nx, ny });
      }
    }
    const box = new THREE.BoxGeometry(1, 1, 1), o = new THREE.Object3D();
    const lm = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xf4f4f0 }), lines.length);
    lines.forEach((l, i) => { o.position.set(l.x, l.y, l.z); o.rotation.set(0, 0, l.ang); o.scale.set(l.sx, l.sy, l.sz); o.updateMatrix(); lm.setMatrixAt(i, o.matrix); });
    root.add(lm);
    if (!cars.length) return;
    const body = new THREE.InstancedMesh(box, lambert({ color: 0xffffff }), cars.length);
    const cab = new THREE.InstancedMesh(box, lambert({ color: 0x23282f }), cars.length);
    const col = new THREE.Color();
    cars.forEach((c, i) => {
      o.rotation.set(0, 0, c.ang);
      o.position.set(c.x, c.y, c.z + 0.62); o.scale.set(1.8, 4.5, 0.72); o.updateMatrix(); body.setMatrixAt(i, o.matrix);
      o.position.set(c.x - c.nx * 0.2, c.y - c.ny * 0.2, c.z + 1.25); o.scale.set(1.6, 2.3, 0.55); o.updateMatrix(); cab.setMatrixAt(i, o.matrix);
      body.setColorAt(i, col.setHex(c.col));
    });
    root.add(body, cab);
  }

  /* ---------- Сцена объекта ---------- */
  function buildScene(p, api) {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.rotation.z = (p.rotation || 0) * Math.PI / 180;
    scene.add(root);

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const hemi = new THREE.HemisphereLight(0xe4eefa, 0x8e8676, 0.4); hemi.position.set(0, 0, 1); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 0.7); sun.position.set(-70, -110, 120); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdbe6ff, 0.16); fill.position.set(90, 70, 40); scene.add(fill);

    const seed = [...p.id].reduce((s, c) => s * 31 + c.charCodeAt(0), 7);
    const facadeTex = p.style === 'gold' ? texGold(seed) : p.style === 'plus' ? texPlus(seed) : texOrdo(seed);
    const facadeMat = lambert({ map: facadeTex });
    const shopMat = lambert({ map: texShop(seed + 1) });
    const kinderMat = lambert({ map: texKinder(seed + 2) });
    const parkadeMat = lambert({ map: texParkade() });
    const white = lambert({ color: 0xf4f3ef });
    const roofMat = lambert({ color: 0x8f9397 });
    const darkMat = lambert({ color: 0x2a2f36 });
    const blankMat = lambert({ color: p.blankColor || 0xe9e8e3 });
    const pick = [];
    const labelNew = (from, label) => { for (const m of root.children.slice(from)) if (m.isMesh || m.isGroup) { m.traverse((x) => { if (x.isMesh) { x.userData = { pid: p.id, podium: true, label }; pick.push(x); } }); } };

    // Объёмы стилобата / коммерции / детсада
    for (const v of p.volumes || []) {
      const mat = v.tex === 'kinder' ? kinderMat : v.tex === 'parkade' ? parkadeMat : shopMat;
      const w = new THREE.Mesh(wallGeometry(v.pts, v.base, v.top, BAY * 2 * 4 / 2, v.floorH * 2, v.base), mat);
      const label = v.name || (v.tex === 'kinder' ? 'Детский сад' : v.tex === 'parkade' ? 'Многоуровневый паркинг' : 'Коммерческие помещения');
      w.userData = { pid: p.id, podium: true, label };
      root.add(w); pick.push(w);
      const roof = flat(v.pts, v.top, lambert({ color: v.roof || 0xbdb8ae })); roof.userData = { pid: p.id, podium: true, label: v.roofName || label };
      root.add(roof); pick.push(roof);
      root.add(new THREE.Mesh(wallGeometry(offsetPoly(v.pts, 0.15), v.top - 0.3, v.top + 0.9, 1, 1), white)); // парапет
    }
    for (const s of p.surfaces || []) root.add(flat(s.pts, s.z, lambert({ color: s.color })));
    for (const o of p.ovals || []) root.add(oval(o.c, o.rx, o.ry, o.z, lambert({ color: o.color })));
    for (const r of p.ramps || []) buildRamp(root, r, pick, p);
    for (const v of p.vaults || []) { const n = root.children.length; buildVault(root, v); labelNew(n, 'Въезд в подземный паркинг'); }
    for (const d of p.downRamps || []) { const n = root.children.length; buildDownRamp(root, d); labelNew(n, 'Въезд в подземный паркинг −1/−2'); }
    buildParking(root, p.parking || [], seed);

    // Жилые блоки
    const blockInfo = {};
    const box = new THREE.BoxGeometry(1, 1, 1), finMat = lambert({ color: 0xf6f5f1 });
    const instanced = (grp, list, mat) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(box, mat, list.length);
      const o = new THREE.Object3D();
      list.forEach((f, i) => { o.position.set(f.x, f.y, f.z); o.rotation.set(0, 0, f.ang); o.scale.set(f.sx, f.sy, f.sz); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
      grp.add(m);
    };
    for (const b of p.blocks) {
      const top = api.floorBase(p, b.floors + 1);
      const fp = ccw(b.fp);
      const bg = new THREE.Group(); root.add(bg);
      const fins = [], bands = [];
      // коммерческий этаж в пятне блока
      if (p.residentialBase > p.blockBase) {
        const w = new THREE.Mesh(wallGeometry(fp, p.blockBase, p.residentialBase, BAY * 8, (p.residentialBase - p.blockBase) * 2, p.blockBase), shopMat);
        w.userData = { pid: p.id, block: b.id, label: 'Коммерческие помещения' }; bg.add(w); pick.push(w);
      }
      // Фасад по кусочкам ~3 м: окна только там, где за стеной квартира (по плану этажа),
      // глухая стена — у лестниц/лифтов и на сторонах, которые на плане без окон (plan.blank)
      const walls = new THREE.Mesh(new THREE.BufferGeometry(), facadeMat);
      const blockPick = [walls], pieces = [];
      {
        const pos = [], uv = [], idx = [], bpos = [];
        const v0 = 0, v1 = (top - p.residentialBase) / (p.floorHeight * ATLAS_FLOORS), uSize = BAY * ATLAS_BAYS;
        let u0 = 0;
        fp.forEach((a, i) => {
          const c = fp[(i + 1) % fp.length];
          const len = Math.hypot(c[0] - a[0], c[1] - a[1]); if (len < 0.01) return;
          const dx = (c[0] - a[0]) / len, dy = (c[1] - a[1]) / len, n = [dy, -dx];
          const m = Math.max(1, Math.round(len / BAY)), pl = len / m;
          for (let k = 0; k < m; k++) {
            const A = [a[0] + dx * pl * k, a[1] + dy * pl * k], B = [a[0] + dx * pl * (k + 1), a[1] + dy * pl * (k + 1)];
            const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
            const win = api.isWindow ? api.isWindow(p, b, mid, n) : true;
            pieces.push({ c: mid, n, len: pl, win });
            const ua = u0 + pl * k / uSize, ub = u0 + pl * (k + 1) / uSize;
            const target = win ? pos : bpos, base = target.length / 3;
            target.push(A[0], A[1], p.residentialBase, B[0], B[1], p.residentialBase, B[0], B[1], top, A[0], A[1], top);
            if (win) { uv.push(ua, v0, ub, v0, ub, v1, ua, v1); idx.push(base, base + 1, base + 2, base, base + 2, base + 3); }
          }
          u0 = Math.round((u0 + len / uSize) * 4) / 4;
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx); g.computeVertexNormals();
        walls.geometry = g;
        if (bpos.length) {
          const bi = []; for (let q = 0; q < bpos.length / 3; q += 4) bi.push(q, q + 1, q + 2, q, q + 2, q + 3);
          const bg2 = new THREE.BufferGeometry();
          bg2.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3)); bg2.setIndex(bi); bg2.computeVertexNormals();
          const bw = new THREE.Mesh(bg2, blankMat); bw.userData = { pid: p.id, block: b.id };
          bg.add(bw); pick.push(bw); blockPick.push(bw);
        }
      }
      walls.userData = { pid: p.id, block: b.id };
      bg.add(walls); pick.push(walls);
      const roof = flat(fp, top, roofMat); roof.userData = { pid: p.id, block: b.id }; bg.add(roof); pick.push(roof);
      bg.add(slab(offsetPoly(fp, 0.12), p.residentialBase - 0.4, p.residentialBase + 0.1, white)); // цокольный пояс

      if (p.style === 'gold') {
        // парапет, белые ламели и «корона» с козырьком, как на рендерах
        bg.add(new THREE.Mesh(wallGeometry(fp, top, top + 1.4, 1, 1), white));
        // козырёк-рамка: кольцо по контуру, внутри видна тёмная кровля
        const outer = shapeOf(offsetPoly(fp, 1.4));
        outer.holes.push(new THREE.Path(ccw(offsetPoly(fp, -2.2)).map(([x, y]) => new THREE.Vector2(x, y))));
        const crown = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.7, bevelEnabled: false }), white);
        crown.position.z = top + 2.7; bg.add(crown);
        const under = new THREE.Mesh(new THREE.ShapeGeometry(outer), darkMat); under.position.z = top + 2.68; bg.add(under);
        fp.forEach((a, i) => {
          const c = fp[(i + 1) % fp.length];
          const len = Math.hypot(c[0] - a[0], c[1] - a[1]); if (len < 2.5) return;
          const nx = (c[1] - a[1]) / len, ny = -(c[0] - a[0]) / len, ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
          const n = Math.max(1, Math.round(len / 6.4));
          for (let k = 0; k <= n; k++) {
            const t = k / n, x = a[0] + (c[0] - a[0]) * t + nx * 0.3, y = a[1] + (c[1] - a[1]) * t + ny * 0.3;
            const wide = k === 0 || k === n;
            fins.push({ x: x + nx * 0.2, y: y + ny * 0.2, z: (p.residentialBase + top + 3.4) / 2, sx: wide ? 1.5 : 0.9, sy: 1.0, sz: top + 3.4 - p.residentialBase, ang });
          }
          for (let f = p.firstResidentialFloor + 5; f <= b.floors - 2; f += 6) {
            const z = api.floorBase(p, f);
            bands.push({ x: (a[0] + c[0]) / 2 + nx * 0.4, y: (a[1] + c[1]) / 2 + ny * 0.4, z, sx: len + 0.6, sy: 0.9, sz: 0.7, ang });
          }
        });
      } else {
        bg.add(new THREE.Mesh(wallGeometry(fp, top, top + 1.1, 1, 1), white));
        bg.add(slab(offsetPoly(fp, 0.15), top + 1.1, top + 1.3, darkMat));
      }
      instanced(bg, fins, finMat); instanced(bg, bands, finMat);
      blockInfo[b.id] = { fp, group: bg, pickMeshes: blockPick, pieces };
    }

    // Деревья
    const trees = p.trees || [];
    if (trees.length) {
      const crown = new THREE.IcosahedronGeometry(1, 1);
      const trunk = new THREE.CylinderGeometry(0.15, 0.22, 1, 6); trunk.rotateX(Math.PI / 2);
      const cm = new THREE.InstancedMesh(crown, lambert({ color: 0xffffff }), trees.length);
      const tm = new THREE.InstancedMesh(trunk, lambert({ color: 0x6b5340 }), trees.length);
      const o = new THREE.Object3D(), r = rng(seed + 9), col = new THREE.Color();
      trees.forEach(([x, y, z = 0], i) => {
        const s = 1.8 + r() * 1.4, h = 2.2 + r() * 1.2;
        o.position.set(x, y, z + h / 2); o.rotation.set(0, 0, 0); o.scale.set(1, 1, h); o.updateMatrix(); tm.setMatrixAt(i, o.matrix);
        o.position.set(x, y, z + h + s * 0.8); o.scale.set(s, s, s * 1.15); o.rotation.set(r(), r(), r()); o.updateMatrix(); cm.setMatrixAt(i, o.matrix);
        col.setHSL(0.24 + r() * 0.06, 0.35 + r() * 0.15, 0.32 + r() * 0.1); cm.setColorAt(i, col);
      });
      root.add(tm, cm);
    }

    // Подсветка этажей
    const hoverMat = new THREE.MeshBasicMaterial({ color: 0xe0a83a, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
    const selMat = new THREE.MeshBasicMaterial({ color: 0xd4572a, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide });
    const hoverMesh = new THREE.Mesh(new THREE.BufferGeometry(), hoverMat);
    const selMesh = new THREE.Mesh(new THREE.BufferGeometry(), selMat);
    hoverMesh.visible = selMesh.visible = false; hoverMesh.renderOrder = selMesh.renderOrder = 10;
    root.add(hoverMesh, selMesh);
    const geoCache = {};
    function placeHighlight(mesh, b, f) {
      if (!b || !f) { mesh.visible = false; return; }
      const key = b.id;
      if (!geoCache[key]) geoCache[key] = new THREE.ExtrudeGeometry(shapeOf(offsetPoly(blockInfo[b.id].fp, 0.35)), { depth: p.floorHeight - 0.15, bevelEnabled: false });
      mesh.geometry = geoCache[key];
      mesh.position.z = api.floorBase(p, f) + 0.05;
      mesh.visible = true;
    }
    // Мигающие окна выбранной квартиры: тёплое «светящееся» стекло поверх фасада
    const aptMat = new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const aptMesh = new THREE.Mesh(new THREE.BufferGeometry(), aptMat);
    aptMesh.visible = false; aptMesh.renderOrder = 12;
    root.add(aptMesh);
    function placeApt(localPoly, f) {
      if (!localPoly) { aptMesh.visible = false; selMat.opacity = 0.78; return; }
      aptMesh.geometry.dispose();
      aptMesh.geometry = new THREE.ExtrudeGeometry(shapeOf(offsetPoly(localPoly, 0.55)), { depth: p.floorHeight - 0.5, bevelEnabled: false });
      aptMesh.position.z = api.floorBase(p, f) + 0.25;
      aptMesh.visible = true; selMat.opacity = 0.35;
    }
    const ghostMat = new THREE.MeshLambertMaterial({ color: 0xe9ecf0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    const focus = { id: null, targets: [] };
    function setFocus(id, targets) { focus.id = id; focus.targets = targets || []; if (!id) applyGhost(new Set()); }
    function applyGhost(ids) {
      for (const [bid, info] of Object.entries(blockInfo)) {
        const ghost = ids.has(bid);
        info.group.traverse((m) => {
          if (!m.isMesh) return;
          if (!m.userData.mat) m.userData.mat = m.material;
          m.material = ghost ? ghostMat : m.userData.mat;
          m.userData.ghost = ghost;
        });
      }
    }
    return { scene, root, pick, placeHighlight, hoverMesh, selMesh, placeApt, aptMesh, aptMat, focus, setFocus, applyGhost, blockInfo };
  }

  /* ---------- Слой MapLibre ---------- */
  let renderer = null;
  function init(map, projects, api) {
    const layers = {}; const m_ = map;
    for (const p of projects) {
      const mc = maplibregl.MercatorCoordinate.fromLngLat(p.origin, 0);
      const s = mc.meterInMercatorCoordinateUnits();
      const camera = new THREE.Camera();
      const L = { p, camera, built: null };
      layers[p.id] = L;
      map.addLayer({
        id: 'y3d-' + p.id, type: 'custom', renderingMode: '3d',
        onAdd(m, gl) {
          if (!renderer) {
            renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
            renderer.autoClear = false;
          }
          L.built = buildScene(p, api);
        },
        render(gl, matrix) {
          const mm = new THREE.Matrix4().fromArray(matrix);
          const l = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z).scale(new THREE.Vector3(s, -s, s));
          camera.projectionMatrix = mm.multiply(l);
          L.inv = camera.projectionMatrix.clone().invert();
          if (L.built.aptMesh.visible) { // плавное «дыхание», один раз в 1,7 секунды
            const k = 0.5 - 0.5 * Math.cos(performance.now() / 1700 * Math.PI * 2); L.built.aptMat.opacity = 0.3 + 0.5 * k * k * (3 - 2 * k);
            m_.triggerRepaint();
          }
          renderer.resetState();
          renderer.render(L.built.scene, camera);
        },
      });
    }
    const raycaster = new THREE.Raycaster();
    function pick(point) {
      const canvas = map.getCanvas();
      const nx = (point.x / canvas.clientWidth) * 2 - 1, ny = 1 - (point.y / canvas.clientHeight) * 2;
      let best = null;
      for (const id in layers) {
        const L = layers[id]; if (!L.built || !L.inv) continue;
        const near = new THREE.Vector3(nx, ny, -1).applyMatrix4(L.inv);
        const far = new THREE.Vector3(nx, ny, 0.5).applyMatrix4(L.inv);
        raycaster.set(near, far.sub(near).normalize());
        const hit = raycaster.intersectObjects(L.built.pick.filter((o) => !o.userData.ghost), false)[0];
        if (!hit) continue;
        const d = hit.point.distanceTo(near);
        if (!best || d < best.d) best = { d, hit, L };
      }
      if (!best) return null;
      const { hit, L } = best, p = L.p, ud = hit.object.userData;
      if (ud.podium) return { project: p, podium: true, label: ud.label };
      const b = p.blocks.find((x) => x.id === ud.block);
      const z = L.built.root.worldToLocal(hit.point.clone()).z;
      if (z < p.residentialBase - 0.01) return { project: p, block: b, podium: true, label: ud.label || 'Коммерческие помещения' };
      const f = Math.min(b.floors, Math.max(p.firstResidentialFloor, p.firstResidentialFloor + Math.floor((z - p.residentialBase) / p.floorHeight)));
      return { project: p, block: b, floor: f };
    }
    function highlight(kind, p, b, f) {
      for (const id in layers) {
        const L = layers[id]; if (!L.built) continue;
        const mesh = kind === 'hover' ? L.built.hoverMesh : L.built.selMesh;
        if (p && p.id === id) L.built.placeHighlight(mesh, b, f); else mesh.visible = false;
      }
      map.triggerRepaint();
    }
    function highlightApt(p, b, f, localPoly) {
      for (const id in layers) { const L = layers[id]; if (L.built) L.built.placeApt(p && p.id === id ? localPoly : null, f); }
      map.triggerRepaint();
    }
    // Какие блоки стоят между камерой и выбранным блоком/квартирой — только они становятся прозрачными
    function updateOcclusion(L) {
      const B = L.built; if (!B) return;
      if (!B.focus.id || !L.inv) { B.applyGhost(new Set()); return; }
      B.root.updateMatrixWorld(true);
      const occ = new Set(), others = Object.entries(B.blockInfo).filter(([bid]) => bid !== B.focus.id);
      for (const t of B.focus.targets) {
        const T = B.root.localToWorld(new THREE.Vector3(t[0], t[1], t[2]));
        const ndc = T.clone().applyMatrix4(L.camera.projectionMatrix);
        if (Math.abs(ndc.x) > 1.3 || Math.abs(ndc.y) > 1.3) continue;
        const near = new THREE.Vector3(ndc.x, ndc.y, -1).applyMatrix4(L.inv);
        const dir = T.clone().sub(near), dist = dir.length();
        raycaster.set(near, dir.normalize()); raycaster.far = dist - 0.3;
        for (const [bid, info] of others) if (!occ.has(bid) && raycaster.intersectObjects(info.pickMeshes, false).length) occ.add(bid);
      }
      raycaster.far = Infinity;
      B.applyGhost(occ);
    }
    let occT = 0;
    const occAll = () => { for (const id in layers) updateOcclusion(layers[id]); map.triggerRepaint(); };
    map.on('move', () => { const n = performance.now(); if (n - occT > 200) { occT = n; occAll(); } });
    map.on('moveend', occAll);
    function focusBlock(p, b, targets) {
      for (const id in layers) { const L = layers[id]; if (L.built) L.built.setFocus(p && p.id === id && b ? b.id : null, targets); }
      requestAnimationFrame(occAll);
    }
    // Кусочки фасада блока (центр, нормаль, есть ли окна) — для камеры «со стороны окон»
    const facade = (p, b) => { const L = layers[p.id]; return L && L.built ? L.built.blockInfo[b.id].pieces : null; };
    return { pick, highlight, highlightApt, focusBlock, facade };
  }

  window.Yurta3D = { init };
})();
