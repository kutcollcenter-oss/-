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
  function analyse(img, o, thr = 140, k = 0.88) {
    // пикселей картинки на единицу координат плана (у чёткой версии из PDF — свои по осям)
    const sx = o.kx || img.naturalWidth / o.planW, sy = o.ky || img.naturalHeight / o.planH;
    const polyPx = o.poly.map(([x, y]) => [x * sx, y * sy]);
    // масштаб: контур квартиры на плане включает стены, поэтому чистая площадь — доля k площади контура
    // (сначала k = 0,88, потом уточняем по найденным стенам — см. start)
    // если масштаб планировки откалиброван (o.mpp, метров в пикселе) — берём его, он точнее
    const mpp = o.mpp || Math.sqrt(o.area / (polyArea(polyPx) * k));
    const marg = 0.35 / mpp;
    const xs = polyPx.map((q) => q[0]), ys = polyPx.map((q) => q[1]);
    const X0 = Math.max(0, Math.floor(Math.min(...xs) - marg)), Y0 = Math.max(0, Math.floor(Math.min(...ys) - marg));
    const X1 = Math.min(img.naturalWidth, Math.ceil(Math.max(...xs) + marg)), Y1 = Math.min(img.naturalHeight, Math.ceil(Math.max(...ys) + marg));
    const w = X1 - X0, h = Y1 - Y0;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'); g.drawImage(img, X0, Y0, w, h, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    const fl = document.createElement('canvas'); fl.width = w; fl.height = h; const fg2 = fl.getContext('2d');
    // пол — цементная стяжка (так квартира сдаётся), план едва просвечивает для ориентира
    fg2.fillStyle = '#9d9890'; fg2.fillRect(0, 0, w, h);
    for (let k = 0; k < w * h / 18; k++) { const v = Math.random(); fg2.fillStyle = v < 0.6 ? 'rgba(80,76,70,.12)' : 'rgba(255,255,255,.05)'; fg2.fillRect(Math.random() * w, Math.random() * h, 1 + v * 2, 1 + v * 2); }
    fg2.strokeStyle = 'rgba(255,255,255,.07)'; fg2.lineWidth = 3;
    for (let k = 0; k < w * h / 9000; k++) { fg2.beginPath(); fg2.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, Math.random() * 6, Math.random() * 6 + 1.5); fg2.stroke(); }
    fg2.globalCompositeOperation = 'multiply'; fg2.globalAlpha = 0.42; fg2.filter = 'grayscale(1)'; fg2.drawImage(cv, 0, 0); fg2.filter = 'none'; fg2.globalAlpha = 1;
    // тёмные серые пиксели — стены; цветные заливки комнат и тонкие линии мебели — нет
    let dark = new Uint8Array(w * h);
    for (let i = 0, k = 0; i < px.length; i += 4, k++) {
      const r = px[i], gg = px[i + 1], b = px[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      dark[k] = (0.3 * r + 0.59 * gg + 0.11 * b) < thr && mx - mn < (thr > 190 ? 9 : thr > 150 ? 40 : 60) ? 1 : 0;
    }
    // убираем тонкие штрихи (текст, размеры): сжатие и расширение 3×3
    const morph = (src, keep) => { const out = new Uint8Array(w * h); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += src[(y + dy) * w + x + dx]; out[y * w + x] = keep(c) ? 1 : 0; } return out; };
    dark = morph(morph(dark, (c) => c === 9), (c) => c > 0);
    // длинные тонкие прямые линии (остекление, тонкие перегородки, полотна дверей) — преграды для замера комнат
    const lineAt = new Uint8Array(w * h), minRun = Math.round(0.7 / mpp);
    const isLine = (k) => { const i = k * 4, r = px[i], gg = px[i + 1], b = px[i + 2]; return (0.3 * r + 0.59 * gg + 0.11 * b) < 165 && Math.max(r, gg, b) - Math.min(r, gg, b) < 50; };
    const lm = new Uint8Array(w * h); for (let k = 0; k < w * h; k++) lm[k] = isLine(k) ? 1 : 0;
    // длина серии тёмных пикселей по горизонтали и вертикали; линия — длинная в одну сторону и тонкая в другую
    const hl = new Uint16Array(w * h), vl = new Uint16Array(w * h), thin = Math.max(2, Math.round(0.06 / mpp));
    for (let y = 0; y < h; y++) { let s0 = -1; for (let x = 0; x <= w; x++) { const on = x < w && lm[y * w + x]; if (on && s0 < 0) s0 = x; if (!on && s0 >= 0) { for (let q = s0; q < x; q++) hl[y * w + q] = x - s0; s0 = -1; } } }
    for (let x = 0; x < w; x++) { let s0 = -1; for (let y = 0; y <= h; y++) { const on = y < h && lm[y * w + x]; if (on && s0 < 0) s0 = y; if (!on && s0 >= 0) { for (let q = s0; q < y; q++) vl[q * w + x] = y - s0; s0 = -1; } } }
    for (let k = 0; k < w * h; k++) if ((hl[k] >= minRun && vl[k] <= thin) || (vl[k] >= minRun && hl[k] <= thin)) lineAt[k] = 1;
    // остекление окон: на некоторых планах это однопиксельные светло-серые линии — ищем их отдельно (длиннее 0,4 м)
    const glzAt = new Uint8Array(w * h), gRun = Math.round(0.4 / mpp), gl = new Uint8Array(w * h);
    for (let k = 0; k < w * h; k++) { const i = k * 4, r = px[i], gg = px[i + 1], b = px[i + 2]; gl[k] = (0.3 * r + 0.59 * gg + 0.11 * b) < 222 && Math.max(r, gg, b) - Math.min(r, gg, b) < 26 ? 1 : 0; }
    hl.fill(0); vl.fill(0);
    for (let y = 0; y < h; y++) { let s0 = -1; for (let x = 0; x <= w; x++) { const on = x < w && gl[y * w + x]; if (on && s0 < 0) s0 = x; if (!on && s0 >= 0) { for (let q = s0; q < x; q++) hl[y * w + q] = x - s0; s0 = -1; } } }
    for (let x = 0; x < w; x++) { let s0 = -1; for (let y = 0; y <= h; y++) { const on = y < h && gl[y * w + x]; if (on && s0 < 0) s0 = y; if (!on && s0 >= 0) { for (let q = s0; q < y; q++) vl[q * w + x] = y - s0; s0 = -1; } } }
    for (let k = 0; k < w * h; k++) if ((hl[k] >= gRun && vl[k] <= thin) || (vl[k] >= gRun && hl[k] <= thin)) glzAt[k] = 1;
    if (thr > 190) dark = morph(morph(morph(morph(dark, (c) => c === 9), (c) => c === 9), (c) => c > 0), (c) => c > 0); // серая заливка стен: убираем ещё и линии мебели
    // сетка 5 см
    const cp = Math.max(1, Math.round(CELL / mpp)), cell = cp * mpp;
    const W = Math.floor(w / cp), H = Math.floor(h / cp);
    const polyM = polyPx.map(([x, y]) => [(x - X0) * mpp, (y - Y0) * mpp]);
    const wall = new Uint8Array(W * H), inner = new Uint8Array(W * H), edge = new Float32Array(W * H), lines = new Uint8Array(W * H), glz = new Uint8Array(W * H);
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      let c = 0;
      for (let y = cy * cp; y < (cy + 1) * cp; y++) for (let x = cx * cp; x < (cx + 1) * cp; x++) c += dark[y * w + x];
      const pt = [(cx + 0.5) * cell, (cy + 0.5) * cell], i = cy * W + cx;
      const ins = pointInPoly(pt, polyM), d = distToEdges(pt, polyM);
      edge[i] = ins ? d : -d;
      inner[i] = edge[i] > -0.3 ? 1 : 0; // внутри контура (с запасом 30 см на наружные стены)
      wall[i] = c / (cp * cp) >= 0.4 && inner[i] ? 1 : 0;
      let ln = 0; for (let y = cy * cp; y < (cy + 1) * cp; y++) for (let x = cx * cp; x < (cx + 1) * cp; x++) ln += lineAt[y * w + x];
      lines[i] = ln > 0 ? 1 : 0;
      let gz = 0; for (let y = cy * cp; y < (cy + 1) * cp; y++) for (let x = cx * cp; x < (cx + 1) * cp; x++) gz += glzAt[y * w + x];
      glz[i] = gz > 0 ? 1 : 0;
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
    const toM = ([x, y]) => [(x * sx - X0) * mpp, (y * sy - Y0) * mpp];
    return { thr, k, mpp, toM, wallM2: walls * cell * cell, cv: fl, planCv: cv, W, H, cell, wall, lines, glz, inner, edge, opening, polyM, wm: w * mpp, hm: h * mpp, ok: walls * cell * cell > 2.5 };
  }

  /* ---------- Что за проёмом: окно, вход из коридора или стык с соседней квартирой ---------- */
  function classify(A, o) {
    const { W, H, cell: c } = A;
    const others = (o.others || []).map((p) => p.map(A.toM));
    const inOther = (x, y) => others.some((p) => pointInPoly([x, y], p));
    const inAny = (x, y) => pointInPoly([x, y], A.polyM) || inOther(x, y);
    const seen = new Uint8Array(W * H), comps = [];
    for (let i = 0; i < W * H; i++) {
      if (!A.opening[i] || seen[i]) continue;
      const cells = [], st = [i]; seen[i] = 1;
      while (st.length) { const j = st.pop(); cells.push(j); const x = j % W; for (const n of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) if (n >= 0 && n < W * H && A.opening[n] && !seen[n]) { seen[n] = 1; st.push(n); } }
      let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      cells.forEach((j) => { const x = j % W, y = (j / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
      const horiz = x1 - x0 >= y1 - y0, cx = (x0 + x1 + 1) / 2 * c, cy = (y0 + y1 + 1) / 2 * c;
      // наружу — та сторона, где кончается квартира
      let n = horiz ? [0, 1] : [1, 0];
      if (pointInPoly([cx + n[0] * 0.6, cy + n[1] * 0.6], A.polyM)) n = [-n[0], -n[1]];
      const comp = { cells, x0, x1, y0, y1, horiz, n, len: (horiz ? x1 - x0 + 1 : y1 - y0 + 1) * c, kind: 'window', score: 0 };
      if (inOther(cx + n[0] * 0.5, cy + n[1] * 0.5)) comp.kind = 'party';
      else {
        // насколько место за проёмом окружено квартирами: коридор — со всех сторон, улица — только сзади
        const px = cx + n[0], py = cy + n[1];
        for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a); for (let t = 0.1; t < 10; t += 0.15) if (inAny(px + dx * t, py + dy * t)) { comp.score++; break; } }
        if (comp.score >= 13) comp.kind = 'inside';
      }
      comps.push(comp);
    }
    // входная дверь — самый «внутренний» проём подходящей ширины
    let door = comps.filter((q) => q.kind === 'inside' && q.len > 0.6 && q.len < 2.2).sort((a, b) => b.score - a.score || Math.abs(a.len - 1) - Math.abs(b.len - 1))[0];
    A.doorCells = new Uint8Array(W * H);
    if (!door) {
      // полного проёма нет (на плане его закрывает полотно или контуры квартир неточные) —
      // ставим дверь шириной 1 м по центру самого «коридорного» узкого проёма
      const q = comps.filter((z) => z.kind === 'inside').sort((a, b) => b.score - a.score || b.len - a.len)[0];
      if (q) {
        const half = Math.round(0.5 / c), mid = q.horiz ? (q.x0 + q.x1) >> 1 : (q.y0 + q.y1) >> 1;
        const d = { ...q, kind: 'inside', cells: [] };
        if (q.horiz) { d.x0 = Math.max(0, mid - half); d.x1 = Math.min(W - 1, mid + half); } else { d.y0 = Math.max(0, mid - half); d.y1 = Math.min(H - 1, mid + half); }
        for (let y = d.y0; y <= d.y1; y++) for (let x = d.x0; x <= d.x1; x++) d.cells.push(y * W + x);
        d.len = (q.horiz ? d.x1 - d.x0 + 1 : d.y1 - d.y0 + 1) * c;
        comps.push(d); door = d;
      }
    }
    for (const q of comps) {
      if (q.kind === 'window') continue;
      // всё, что не окно, — глухая стена; у двери — стена с дверным полотном
      q.cells.forEach((j) => { A.opening[j] = 0; A.wall[j] = 1; if (q === door) A.doorCells[j] = 1; });
    }
    if (door) A.door = { x0: door.x0 * c, x1: (door.x1 + 1) * c, z0: door.y0 * c, z1: (door.y1 + 1) * c, horiz: door.horiz, n: door.n };
    A.comps = comps;
  }

  /* ---------- Наружные стены: ровная стена одной толщины, а где на плане нет стены — окно ---------- */
  // На планах наружная стена у окон нарисована тонкими линиями остекления и распознаётся плохо,
  // поэтому вдоль сторон квартиры, выходящих на улицу, стену строим заново по разметке «стена / окно».
  function envelope(A, o) {
    const { W, H, cell: c } = A, N = W * H;
    const others = (o.others || []).map((p) => p.map(A.toM));
    const inOther = (x, y) => others.some((p) => pointInPoly([x, y], p));
    const inAny = (x, y) => pointInPoly([x, y], A.polyM) || inOther(x, y);
    const cellAt = (x, y) => { const cx = Math.floor(x / c), cy = Math.floor(y / c); return cx < 0 || cy < 0 || cx >= W || cy >= H ? -1 : cy * W + cx; };
    const isWall = (x, y) => { const i = cellAt(x, y); return i >= 0 && A.wall[i] === 1 && !A.doorCells[i]; };
    const enclosed = (x, y) => { let s = 0; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a); for (let r = 0.1; r < 10; r += 0.2) if (inAny(x + dx * r, y + dy * r)) { s++; break; } } return s; };
    A.env = new Uint8Array(N); A.envSpans = [];
    const P = A.polyM, STEP = 0.1;
    for (let e = 0; e < P.length; e++) {
      const a = P[e], b = P[(e + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.6) continue;
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      if (Math.abs(u[0]) > 0.02 && Math.abs(u[1]) > 0.02) continue; // только стороны вдоль осей плана
      let m = [-u[1], u[0]];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (!pointInPoly([mid[0] + m[0] * 0.2, mid[1] + m[1] * 0.2], P)) m = [-m[0], -m[1]]; // m смотрит внутрь квартиры
      // что за стороной: соседняя квартира, коридор или улица (считаем раз в 0,5 м)
      const n = Math.floor(L / STEP), kinds = [], depth = [], glaze = [];
      let lastS = -1, lastKind = 'ext';
      for (let k = 0; k <= n; k++) {
        const s = Math.min(L, k * STEP), px = a[0] + u[0] * s, py = a[1] + u[1] * s;
        if (lastS < 0 || s - lastS >= 0.5) {
          lastS = s;
          lastKind = inOther(px - m[0] * 0.5, py - m[1] * 0.5) ? 'party' : enclosed(px - m[0] * 1.0, py - m[1] * 1.0) >= 13 ? 'in' : 'ext';
        }
        let door = false;
        for (let d = -0.3; d <= 0.6 && !door; d += c) { const i = cellAt(px + m[0] * d, py + m[1] * d); if (i >= 0 && A.doorCells[i]) door = true; }
        kinds.push(door ? 'in' : lastKind);
        // толщина стены здесь: сплошные клетки стены, начиная у края, вглубь квартиры
        let d0 = null, d1 = null;
        for (let d = -0.25; d <= 0.7; d += c / 2) {
          if (isWall(px + m[0] * d, py + m[1] * d)) { if (d0 === null) { if (d > 0.3) break; d0 = d; } d1 = d; }
          else if (d0 !== null) break;
        }
        depth.push(d0 === null ? 0 : Math.max(0, d1 + c / 2));
        // остекление на чертеже: тонкие линии поперёк проёма
        let gl = false;
        for (let d = -0.15; d <= 0.45 && !gl; d += c / 2) { const i = cellAt(px + m[0] * d, py + m[1] * d); if (i >= 0 && (A.lines[i] || A.glz[i])) gl = true; }
        glaze.push(gl);
      }
      // толщина наружной стены этой стороны — медиана по местам, где стена есть
      const ds = depth.filter((d, k) => kinds[k] === 'ext' && d > 0.12).sort((p, q) => p - q);
      const T = Math.max(0.22, Math.min(0.45, ds.length ? ds[ds.length >> 1] : 0.3));
      // разметка: стена — где сплошная стена занимает больше половины толщины, иначе окно
      // окно — только где на чертеже нет стены и нарисовано остекление; иначе стена (лишних окон не добавляем)
      const solid = depth.map((d) => d >= T * 0.5);
      const type = kinds.map((k, i) => (k !== 'ext' ? null : solid[i] ? 'wall' : 'gap'));
      // разрыв в стене — окно, если на чертеже там остекление или это проём до 3,2 м между кусками стены
      for (let i = 0; i < type.length;) {
        if (type[i] !== 'gap') { i++; continue; }
        let j = i; while (j < type.length && type[j] === 'gap') j++;
        const len = (j - i) * STEP, gl = glaze.slice(i, j).filter(Boolean).length / (j - i);
        const bounded = i > 0 && j < type.length && type[i - 1] === 'wall' && type[j] === 'wall';
        const win = gl >= 0.3 || (bounded && len <= 3.2);
        for (let k = i; k < j; k++) type[k] = win ? 'win' : 'wall';
        i = j;
      }
      // со стороны коридора и соседей стену не трогаем, но если там пусто (на плане стена не распознана) —
      // закрываем дыру: линии остекления на плане → окно, иначе → глухая стена
      const has = (x, y, grids) => { const i = cellAt(x, y); return i >= 0 && grids.some((g) => g[i]); };
      for (let k = 0; k < type.length; k++) {
        if (type[k]) continue;
        const s = Math.min(L, k * STEP), px = a[0] + u[0] * s, py = a[1] + u[1] * s;
        let any = false, glazing = false;
        for (let d = -0.35; d <= 0.6 && !any; d += c / 2) if (has(px + m[0] * d, py + m[1] * d, [A.wall, A.opening, A.doorCells])) any = true;
        if (any) continue;
        for (let d = -0.15; d <= 0.45 && !glazing; d += c / 2) if (has(px + m[0] * d, py + m[1] * d, [A.lines, A.glz])) glazing = true;
        type[k] = glazing && kinds[k] !== 'party' ? 'win' : 'wall';
      }
      // окна уже 0,45 м превращаем в стену
      for (let i = 0; i < type.length;) { let j = i; while (j < type.length && type[j] === type[i]) j++; if (type[i] === 'win' && (j - i) * STEP < 0.45) for (let k = i; k < j; k++) type[k] = 'wall'; i = j; }
      for (let i = 0; i < type.length;) {
        let j = i; while (j < type.length && type[j] === type[i]) j++;
        if (type[i]) A.envSpans.push({ a, u, m, s0: Math.max(0, (i - 0.5) * STEP), s1: Math.min(L, (j - 0.5) * STEP), t: T, type: type[i] });
        i = j;
      }
      // на этих участках старую распознанную стену и проёмы заменяем новой стеной
      for (let k = 0; k < type.length; k++) {
        if (!type[k]) continue;
        const s = k * STEP;
        for (let w = -STEP / 2; w <= STEP / 2; w += c / 2) for (let d = -0.4; d <= T + 0.02; d += c / 2) {
          const i = cellAt(a[0] + u[0] * (s + w) + m[0] * d, a[1] + u[1] * (s + w) + m[1] * d);
          if (i >= 0 && !A.doorCells[i]) { A.wall[i] = 0; A.opening[i] = 0; A.env[i] = 1; }
        }
      }
    }
  }
  /* ---------- Балконы и лоджии: стена с балконной дверью, пожарные люки в полу ---------- */
  function balconies(A, o) {
    const c = A.cell, W = A.W, H = A.H;
    const cellAt = (x, y) => { const cx = Math.floor(x / c), cy = Math.floor(y / c); return cx < 0 || cy < 0 || cx >= W || cy >= H ? -1 : cy * W + cx; };
    const words = (o.balc || []).map(A.toM);
    const labs = (o.labels || []).filter(([, , v]) => v <= 6.5 && Math.abs(v - o.area) > 0.05).map(([x, y, v]) => [...A.toM([x, y]), v]).filter(([x, y]) => pointInPoly([x, y], A.polyM));
    // остекление между комнатой и балконом бывает светлыми линиями, а значок люка дробит балкон —
    // считаем оба варианта и берём тот, где площадь ближе к подписи на плане
    const ra = seededRooms(A, labs, true), rb = seededRooms(A, labs, false);
    const fit = (r) => (r ? Math.abs(r.w * r.l / r.label - 1) : 9);
    const rooms = labs.map(([lx, lz, v]) => {
      const p = ra.find((r) => r.label === v), q = rb.find((r) => r.label === v), best = fit(p) <= fit(q) ? p : q;
      const named = words.some(([x, y]) => Math.hypot(x - lx, y - lz) < 2.2);
      if (fit(best) <= 0.25 || (!named && v > 4.6)) return best;
      // граница балкона на чертеже не видна, но он подписан «Балкон»: ширина — между боковыми стенами у наружной стены,
      // глубина — площадь из подписи, делённая на ширину
      let side = null;
      for (const sp of A.envSpans) {
        const s = (lx - sp.a[0]) * sp.u[0] + (lz - sp.a[1]) * sp.u[1], d = (lx - sp.a[0]) * sp.m[0] + (lz - sp.a[1]) * sp.m[1];
        if (s >= sp.s0 - 0.05 && s <= sp.s1 + 0.05 && d > 0 && d < 3 && (!side || d < side.d)) side = { sp, s, d };
      }
      if (!side || (!named && side.d > 1.4)) return best;
      const { sp } = side, blocked = (s, d) => { const x = sp.a[0] + sp.u[0] * s + sp.m[0] * d, y = sp.a[1] + sp.u[1] * s + sp.m[1] * d, i = cellAt(x, y); return i < 0 || A.wall[i] === 1 || !pointInPoly([x, y], A.polyM); };
      const dd = sp.t + 0.3;
      let s0 = side.s, s1 = side.s; while (!blocked(s0 - c, dd) && s0 - side.s > -8) s0 -= c; while (!blocked(s1 + c, dd) && s1 - side.s < 8) s1 += c;
      const wd = s1 - s0; if (wd < 0.8) return best;
      const depth = v / wd; if (named ? depth < 0.6 || depth > 2.2 : depth < 0.7 || depth > 1.6) return best;
      const xs = [], zs = [];
      for (const s of [s0, s1]) for (const d of [sp.t, sp.t + depth]) { xs.push(sp.a[0] + sp.u[0] * s + sp.m[0] * d); zs.push(sp.a[1] + sp.u[1] * s + sp.m[1] * d); }
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      return { x0, x1, z0, z1, w: x1 - x0, l: z1 - z0, label: v, byArea: true };
    }).filter(Boolean);
    const others = (o.others || []).map((p) => p.map(A.toM));
    const inOther = (x, y) => others.some((p) => pointInPoly([x, y], p));
    // сторона прямоугольника касается наружной стены?
    const onEnv = (x, y) => { for (let d = -0.1; d <= 0.5; d += c) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const i = cellAt(x + dx * d, y + dy * d); if (i >= 0 && A.env[i]) return true; } return false; };
    A.balconies = [];
    for (const r of rooms) {
      if (window.__bd) (A.balcDbg = A.balcDbg || []).push(r.label + ":" + (r.w * r.l).toFixed(2));
      if (Math.abs(r.w * r.l / r.label - 1) > 0.25) continue;
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      const sides = [
        { k: 'N', horiz: true, line: r.z0, a: r.x0, b: r.x1, out: -1 }, { k: 'S', horiz: true, line: r.z1, a: r.x0, b: r.x1, out: 1 },
        { k: 'W', horiz: false, line: r.x0, a: r.z0, b: r.z1, out: -1 }, { k: 'E', horiz: false, line: r.x1, a: r.z0, b: r.z1, out: 1 },
      ];
      for (const s of sides) {
        const mid = (s.a + s.b) / 2, len = s.b - s.a;
        const p = (d) => (s.horiz ? [mid, s.line + s.out * d] : [s.line + s.out * d, mid]);
        s.len = len;
        // наружная: за ней новая наружная стена или квартира кончается — и это не соседняя квартира
        s.ext = [0.05, 0.15, 0.3, 0.5, 0.8].some((d) => { const q = p(d); return onEnv(q[0], q[1]) || (!pointInPoly(q, A.polyM) && !inOther(q[0], q[1])); });
        const q = p(0.45), i = cellAt(q[0], q[1]);
        s.room = !s.ext && pointInPoly(q, A.polyM) && i >= 0 && !A.wall[i];
      }
      const named = words.some(([x, y]) => Math.hypot(x - cx, y - cz) < 2.2);
      const longExt = sides.filter((s) => s.ext).some((s) => s.len >= Math.max(r.w, r.l) - 0.05);
      const isBalc = (named && sides.some((s) => s.ext)) || (Math.min(r.w, r.l) <= 1.45 && longExt);
      if (window.__bd) A.balcDbg.push("  " + r.label + " named=" + named + " ext=" + sides.filter((s) => s.ext).map((s) => s.k + s.len.toFixed(1)).join("") + " room=" + sides.filter((s) => s.room).map((s) => s.k).join("") + " " + r.w.toFixed(2) + "x" + r.l.toFixed(2));
      if (!isBalc) continue;
      // проём на стороне: самый длинный кусок без стены и без линий (на чертеже там дверь)
      const clearRun = (s, T) => {
        let best = null, run = null;
        for (let u = s.a; u <= s.b + 1e-6; u += 0.05) {
          let clear = true;
          for (let d = 0; d <= T && clear; d += c / 2) { const pt = s.horiz ? [u, s.line + s.out * d] : [s.line + s.out * d, u]; const i = cellAt(pt[0], pt[1]); if (i >= 0 && (A.wall[i] || A.lines[i])) clear = false; }
          if (clear) { if (!run) run = [u, u]; run[1] = u; if (!best || run[1] - run[0] > best[1] - best[0]) best = [...run]; } else run = null;
        }
        return best;
      };
      // стена с дверью — на той стороне, где на чертеже проём; при равенстве — на длинной
      const cand = sides.filter((s) => s.room).map((s) => { const br = clearRun(s, 0.15); return { s, run: br ? br[1] - br[0] : 0 }; });
      const pick = cand.filter((q) => q.run >= 0.5).sort((p, q) => q.s.len - p.s.len)[0] || cand.sort((p, q) => q.s.len - p.s.len)[0];
      const inner = pick && pick.s;
      if (!inner) continue;
      // толщина стены между комнатой и балконом: сплошная стена от края в сторону комнаты
      const ts = [];
      for (let u = inner.a + 0.1; u < inner.b - 0.1; u += 0.1) {
        let t = 0; for (let d = 0; d <= 0.45; d += c / 2) { const pt = inner.horiz ? [u, inner.line + inner.out * d] : [inner.line + inner.out * d, u]; const i = cellAt(pt[0], pt[1]); if (i >= 0 && A.wall[i]) t = d + c / 2; else if (t) break; }
        if (t) ts.push(t);
      }
      ts.sort((p, q) => p - q);
      const T = Math.max(0.12, Math.min(0.35, ts.length >= 3 ? ts[ts.length >> 1] : 0.12));
      // где дверь: самый длинный кусок без стены и без линий остекления
      const best = clearRun(inner, T);
      const dw = 0.8;
      let dc = best && best[1] - best[0] >= 0.5 ? (best[0] + best[1]) / 2 : (inner.a + inner.b) / 2;
      dc = Math.max(inner.a + dw / 2 + 0.1, Math.min(inner.b - dw / 2 - 0.1, dc));
      // клетки перегородки: стена непроходима, в проёме двери — проход
      for (let u = inner.a - 0.02; u <= inner.b + 0.02; u += c / 2) for (let d = -0.02; d <= T + 0.02; d += c / 2) {
        const pt = inner.horiz ? [u, inner.line + inner.out * d] : [inner.line + inner.out * d, u];
        const i = cellAt(pt[0], pt[1]); if (i < 0) continue;
        A.wall[i] = 0; A.opening[i] = 0;
        A.env[i] = Math.abs(u - dc) < dw / 2 ? 0 : 1;
      }
      // пожарные люки: небольшие «стенки» внутри балкона — это люки в полу, а не стены
      const hatches = [], seen = new Set();
      for (let z = r.z0 + c; z < r.z1 - c; z += c) for (let x = r.x0 + c; x < r.x1 - c; x += c) {
        const i0 = cellAt(x, z); if (i0 < 0 || !A.wall[i0] || seen.has(i0)) continue;
        const st = [i0], cells = []; seen.add(i0);
        while (st.length) { const j = st.pop(); cells.push(j); for (const nb of [j - 1, j + 1, j - W, j + W]) if (nb >= 0 && nb < W * H && A.wall[nb] && !seen.has(nb)) { seen.add(nb); st.push(nb); } }
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        cells.forEach((j) => { const xx = (j % W) * c, zz = ((j / W) | 0) * c; x0 = Math.min(x0, xx); x1 = Math.max(x1, xx + c); z0 = Math.min(z0, zz); z1 = Math.max(z1, zz + c); });
        if (x1 - x0 > 1.3 || z1 - z0 > 1.3) continue; // это настоящая стена
        cells.forEach((j) => { A.wall[j] = 0; });
        if (x1 - x0 > 0.3 && z1 - z0 > 0.3) hatches.push([x0, z0, x1, z1]);
      }
      A.balconies.push({ r, inner, T, dc, dw, hatches });
    }
  }
  function buildBalconies(scene, A, height, wallMat) {
    const frameMat = new THREE.MeshLambertMaterial({ color: 0xfbfbf9 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.18, depthWrite: false });
    const DH = 2.1;
    for (const b of A.balconies || []) {
      const s = b.inner, d0 = b.dc - b.dw / 2, d1 = b.dc + b.dw / 2;
      const box = (u0, u1, t0, t1, y0, y1) => { const v0 = s.line + s.out * t0, v1 = s.line + s.out * t1; return s.horiz ? [u0, Math.min(v0, v1), u1, Math.max(v0, v1), y0, y1] : [Math.min(v0, v1), u0, Math.max(v0, v1), u1, y0, y1]; };
      const walls = [];
      if (d0 - s.a > 0.02) walls.push(box(s.a, d0, 0, b.T, 0, height));
      if (s.b - d1 > 0.02) walls.push(box(d1, s.b, 0, b.T, 0, height));
      walls.push(box(d0, d1, 0, b.T, DH, height));
      scene.add(new THREE.Mesh(boxesGeometry(walls), wallMat));
      // коробка балконной двери ПВХ
      const tc = b.T / 2, F = 0.06;
      scene.add(new THREE.Mesh(boxesGeometry([box(d0, d0 + F, tc - 0.04, tc + 0.04, 0, DH), box(d1 - F, d1, tc - 0.04, tc + 0.04, 0, DH), box(d0, d1, tc - 0.04, tc + 0.04, DH - F, DH)]), frameMat));
      // створка приоткрыта в комнату (петли у края проёма)
      const leaf = new THREE.Group(), lw = b.dw - 2 * F, lh = DH - F - 0.02;
      const parts = [[lw, 0.07, 0, lh - 0.035], [lw, 0.07, 0, 0.035], [0.07, lh, -lw / 2 + 0.035, lh / 2], [0.07, lh, lw / 2 - 0.035, lh / 2], [lw, 0.05, 0, 0.9]];
      for (const [w, h, x, y] of parts) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), frameMat); m.position.set(x + lw / 2, y, 0); leaf.add(m); }
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.1, lh - 0.12), glassMat); gl.position.set(lw / 2, lh / 2, 0); leaf.add(gl);
      const hinge = s.horiz ? [d0 + F, s.line + s.out * (b.T + 0.03)] : [s.line + s.out * (b.T + 0.03), d0 + F];
      leaf.position.set(hinge[0], 0.01, hinge[1]);
      // направление вдоль стены → поворот створки на 70° в сторону комнаты
      const base = s.horiz ? 0 : -Math.PI / 2, swing = 70 * Math.PI / 180 * (s.horiz ? -s.out : s.out);
      leaf.rotation.y = base + swing;
      scene.add(leaf);
      // люки в полу балкона
      for (const [x0, z0, x1, z1] of b.hatches) {
        const hm = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.02, z1 - z0), new THREE.MeshLambertMaterial({ color: 0x6d7076 }));
        hm.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2); scene.add(hm);
        const rim = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.04, 0.012, z1 - z0 + 0.04), new THREE.MeshLambertMaterial({ color: 0xc9332b }));
        rim.position.set((x0 + x1) / 2, 0.006, (z0 + z1) / 2); scene.add(rim);
      }
    }
  }
  /* ---------- Таблички «что это» над трубами, газом, щитком ---------- */
  let TAGS = null; // группа табличек текущей сцены
  function tag(text, x, y, z, color = '#d4572a') {
    if (!TAGS) return;
    const S = 3, fs = 30 * S, pad = 14 * S, cv = document.createElement('canvas'), g = cv.getContext('2d');
    g.font = `700 ${fs}px Manrope, Segoe UI, sans-serif`;
    const w = Math.ceil(g.measureText(text).width) + pad * 2 + 26 * S, h = fs + pad * 1.4;
    cv.width = w; cv.height = h + 10 * S;
    g.font = `700 ${fs}px Manrope, Segoe UI, sans-serif`;
    g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); if (g.roundRect) g.roundRect(2, 2, w - 4, h - 4, h / 2); else g.rect(2, 2, w - 4, h - 4); g.fill();
    g.strokeStyle = color; g.lineWidth = 2 * S; g.stroke();
    g.fillStyle = color; g.beginPath(); g.arc(pad + 7 * S, h / 2, 7 * S, 0, 7); g.fill();
    g.fillStyle = '#14161a'; g.textBaseline = 'middle'; g.fillText(text, pad + 22 * S, h / 2 + S);
    // хвостик вниз — указывает на трубу
    g.fillStyle = color; g.beginPath(); g.moveTo(w / 2 - 8 * S, h - 3); g.lineTo(w / 2 + 8 * S, h - 3); g.lineTo(w / 2, h + 9 * S); g.fill();
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    const H = 0.075; sp.scale.set(H * cv.width / cv.height, H, 1);
    sp.center.set(0.5, 0); // низ таблички — на точке
    sp.position.set(x, y, z); sp.renderOrder = 5;
    TAGS.add(sp);
  }

  /* ---------- Кухня и санузел: стояки воды, канализация у пола, газ на кухне ---------- */
  // Места берём по подписям «Кухня», «Ванная», «С/У» на плане; если подписей нет (Ordo 1–3) —
  // санузел узнаём по форме: небольшое помещение 2,5–6,5 м² без наружной стены.
  function wetPoints(A, o) {
    const c = A.cell, W = A.W, H = A.H;
    const cellAt = (x, y) => { const cx = Math.floor(x / c), cy = Math.floor(y / c); return cx < 0 || cy < 0 || cx >= W || cy >= H ? -1 : cy * W + cx; };
    const solid = (x, y) => { const i = cellAt(x, y); return i < 0 || A.wall[i] === 1 || A.env[i] === 1 || A.opening[i] === 1; };
    const ext = (x, y) => { const i = cellAt(x, y); return i >= 0 && (A.env[i] === 1 || A.opening[i] === 1); };
    const inside = (x, y) => pointInPoly([x, y], A.polyM);
    let pts = (o.wet || []).map(([x, y, k]) => [...A.toM([x, y]), k]).filter(([x, y]) => inside(x, y));
    // санузлы по форме, если в квартире нет подписи санузла
    if (!pts.some((p) => p[2] === 'b')) {
      const labs = (o.labels || []).filter(([, , v]) => v >= 2.3 && v <= 6.5).map(([x, y, v]) => [...A.toM([x, y]), v]).filter(([x, y]) => inside(x, y));
      for (const r of seededRooms(A, labs)) {
        if (Math.abs(r.w * r.l / r.label - 1) > 0.2 || Math.min(r.w, r.l) < 1.1) continue;
        if ((A.balconies || []).some((b) => b.r.label === r.label)) continue;
        let touchesExt = false;
        for (let x = r.x0; x <= r.x1 && !touchesExt; x += 0.1) for (const z of [r.z0 - 0.15, r.z1 + 0.15]) if (ext(x, z)) touchesExt = true;
        for (let z = r.z0; z <= r.z1 && !touchesExt; z += 0.1) for (const x of [r.x0 - 0.15, r.x1 + 0.15]) if (ext(x, z)) touchesExt = true;
        if (!touchesExt) pts.push([(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 'b']);
      }
    }
    // одна подпись на помещение
    pts = pts.filter((p, i) => !pts.slice(0, i).some((q) => q[2] === p[2] && Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.2));
    // от подписи — к ближайшей внутренней стене (стояки не ставим на наружную стену и у окна)
    const out = [];
    for (const [px, pz, k] of pts) {
      let from = [px, pz];
      if (solid(px, pz)) { let f = null; for (let r = 0.05; r < 0.6 && !f; r += 0.05) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!f && !solid(px + dx * r, pz + dz * r)) f = [px + dx * r, pz + dz * r]; if (!f) continue; from = f; }
      let best = null;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let d = 0; while (d < 5 && !solid(from[0] + dx * d, from[1] + dz * d)) d += c / 2;
        if (d >= 5) continue;
        const isExt = ext(from[0] + dx * (d + c), from[1] + dz * (d + c));
        const score = d + (isExt ? 10 : 0);
        if (!best || score < best.score) best = { score, d, dx, dz };
      }
      if (!best) continue;
      // вдоль этой стены — в угол, ближайший к подписи
      const wall = [from[0] + best.dx * (best.d - 0.02), from[1] + best.dz * (best.d - 0.02)], ux = -best.dz, uz = best.dx;
      const slide = (s) => { let u = 0; while (u < 4) { const x = wall[0] + ux * s * (u + 0.05) - best.dx * 0.15, z = wall[1] + uz * s * (u + 0.05) - best.dz * 0.15; if (solid(x, z) || !solid(wall[0] + ux * s * u + best.dx * 0.06, wall[1] + uz * s * u + best.dz * 0.06)) break; u += 0.05; } return u; };
      const uP = slide(1), uN = slide(-1), s = uP <= uN ? 1 : -1, u = Math.min(uP, uN);
      const along = Math.max(0, u - (k === 'k' ? 0.55 : 0.35));
      out.push({ k, x: wall[0] + ux * s * along, z: wall[1] + uz * s * along, nx: -best.dx, nz: -best.dz, ux: -ux * s, uz: -uz * s });
    }
    A.wet = out;
  }
  function buildWet(scene, A, H) {
    const pp = new THREE.MeshLambertMaterial({ color: 0xf2f2ee }), blue = new THREE.MeshLambertMaterial({ color: 0x2a62c8 }), red = new THREE.MeshLambertMaterial({ color: 0xc8352a });
    const pvc = new THREE.MeshLambertMaterial({ color: 0x9a9fa6 }), cap = new THREE.MeshLambertMaterial({ color: 0x6f747b }), gas = new THREE.MeshLambertMaterial({ color: 0xf2c200 });
    const brass = new THREE.MeshLambertMaterial({ color: 0xd8b25a }), meter = new THREE.MeshLambertMaterial({ color: 0x3a77c9 });
    const vert = (x, z, r, y0, y1, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, y1 - y0, 14), mat); m.position.set(x, (y0 + y1) / 2, z); scene.add(m); return m; };
    const horiz = (x, z, nx, nz, r, len, y, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), mat); m.rotation.set(nz ? Math.PI / 2 : 0, 0, nx ? Math.PI / 2 : 0); m.position.set(x + nx * len / 2, y, z + nz * len / 2); scene.add(m); return m; };
    const box = (x, y, z, w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); scene.add(m); };
    for (const p of A.wet || []) {
      const at = (a, d) => [p.x + p.ux * a + p.nx * d, p.z + p.uz * a + p.nz * d];
      // стояки холодной (синяя метка) и горячей (красная) воды: кран, счётчик, вывод с заглушкой — точка разводки
      { const [tx, tz] = at(0.045, 0.1); tag(p.k === 'b' ? 'Холодная и горячая вода' : 'Вода: холодная и горячая', tx, 1.12, tz, '#2a62c8'); }
      [[0, blue], [0.09, red]].forEach(([a, mark]) => {
        const [x, z] = at(a, 0.06);
        vert(x, z, 0.016, 0, H, pp);
        vert(x, z, 0.018, 1.55, 1.6, mark);
        const [sx, sz] = at(a, 0.06);
        horiz(sx, sz, p.nx, p.nz, 0.012, 0.16, 0.95, pp);                    // отвод в комнату
        const [vx, vz] = at(a, 0.12); box(vx, 0.95, vz, 0.04, 0.04, 0.04, brass);   // шаровой кран
        const [lx, lz] = at(a, 0.12); box(lx, 0.99, lz, 0.012, 0.012, 0.07, mark); // ручка крана
        const [mx, mz] = at(a, 0.19); box(mx, 0.95, mz, 0.06, 0.07, 0.05, meter);  // счётчик
        const [cx, cz] = at(a, 0.24); box(cx, 0.95, cz, 0.03, 0.03, 0.03, cap);    // заглушка
      });
      if (p.k === 'b') {
        // канализационный стояк с отводом у пола и заглушкой (диаметр условный — раздела ВК нет)
        const [x, z] = at(0.32, 0.08);
        vert(x, z, 0.055, 0, H, pvc);
        vert(x, z, 0.06, 0.25, 0.4, pvc);
        horiz(x, z, p.nx, p.nz, 0.055, 0.16, 0.3, pvc);
        const [cx, cz] = at(0.32, 0.24); box(cx, 0.3, cz, 0.12, 0.12, 0.12, cap);
        { const [tx, tz] = at(0.32, 0.2); tag('Канализация', tx, 0.5, tz, '#6f747b'); }
      } else {
        // кухня: выход канализации из стены у пола с заглушкой (диаметр условный)
        const [x, z] = at(0.3, 0); horiz(x, z, p.nx, p.nz, 0.028, 0.14, 0.22, pvc);
        const [cx, cz] = at(0.3, 0.14); box(cx, 0.22, cz, 0.065, 0.065, 0.03, cap);
        { const [tx, tz] = at(0.3, 0.14); tag('Канализация', tx, 0.32, tz, '#6f747b'); }
        // газовый стояк с краном
        const [gx, gz] = at(-0.35, 0.05); vert(gx, gz, 0.016, 0, H, gas);
        const [kx, kz] = at(-0.35, 0.11); box(kx, 1.4, kz, 0.045, 0.045, 0.05, gas);
        const [hx, hz] = at(-0.35, 0.15); box(hx, 1.44, hz, 0.012, 0.012, 0.09, red);
        { const [tx, tz] = at(-0.35, 0.12); tag('Газ', tx, 1.62, tz, '#d9a800'); }
      }
    }
  }
  // коробка участка наружной стены: вдоль стороны s0..s1, поперёк d0..d1 (внутрь), по высоте y0..y1
  function spanBox(sp, s0, s1, d0, d1, y0, y1) {
    const xs = [], zs = [];
    for (const s of [s0, s1]) for (const d of [d0, d1]) { xs.push(sp.a[0] + sp.u[0] * s + sp.m[0] * d); zs.push(sp.a[1] + sp.u[1] * s + sp.m[1] * d); }
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), y0, y1];
  }

  /* ---------- Комнаты и их размеры ---------- */
  function rooms(A) {
    const { W, H, cell: c } = A, N = W * H;
    const blocked = new Uint8Array(N);
    for (let i = 0; i < N; i++) blocked[i] = A.wall[i] || A.opening[i] || A.edge[i] < 0.03 ? 1 : 0;
    // расстояние до ближайшей стены (в клетках) — двери шириной до ~0,9 м «закрываются», комнаты разделяются
    const dist = new Float32Array(N).fill(1e9);
    for (let i = 0; i < N; i++) if (blocked[i]) dist[i] = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (x) dist[i] = Math.min(dist[i], dist[i - 1] + 1); if (y) dist[i] = Math.min(dist[i], dist[i - W] + 1); if (x && y) dist[i] = Math.min(dist[i], dist[i - W - 1] + 1.414); if (y && x < W - 1) dist[i] = Math.min(dist[i], dist[i - W + 1] + 1.414); }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (x < W - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1); if (y < H - 1) dist[i] = Math.min(dist[i], dist[i + W] + 1); if (x < W - 1 && y < H - 1) dist[i] = Math.min(dist[i], dist[i + W + 1] + 1.414); if (y < H - 1 && x) dist[i] = Math.min(dist[i], dist[i + W - 1] + 1.414); }
    const R = 0.5 / c, lab = new Int32Array(N).fill(-1), out = [];
    for (let i = 0; i < N; i++) {
      if (dist[i] <= R || lab[i] >= 0) continue;
      const id = out.length, cells = [], st = [i]; lab[i] = id;
      while (st.length) { const j = st.pop(); cells.push(j); const x = j % W; for (const n of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) if (n >= 0 && n < N && dist[n] > R && lab[n] < 0) { lab[n] = id; st.push(n); } }
      if (cells.length * c * c < 0.15) continue;
      // для каждой строки и столбца ядра комнаты — отрезок свободного места от стены до стены
      const rows = new Map(), cols = new Map();
      for (const j of cells) { const x = j % W, y = (j / W) | 0; if (!rows.has(y)) rows.set(y, x); if (!cols.has(x)) cols.set(x, y); }
      const run = (x, y, dx, dy) => { let a = 0, b = 0; while (!blocked[(y - dy * (a + 1)) * W + x - dx * (a + 1)] && a < 400) a++; while (!blocked[(y + dy * (b + 1)) * W + x + dx * (b + 1)] && b < 400) b++; return [dx ? x - a : y - a, dx ? x + b : y + b]; };
      const mode = (list) => {
        const cnt = new Map(); list.forEach(([a, b]) => { const k = a + ',' + b; cnt.set(k, (cnt.get(k) || 0) + 1); });
        const [k] = [...cnt.entries()].sort((p, q) => q[1] - p[1])[0]; const [a, b] = k.split(',').map(Number);
        const share = list.filter(([p, q]) => Math.abs(p - a) <= 2 && Math.abs(q - b) <= 2).length / list.length;
        return { a, b, share };
      };
      const X = mode([...rows].map(([y, x]) => run(x, y, 1, 0))), Y = mode([...cols].map(([x, y]) => run(x, y, 0, 1)));
      const w = (X.b - X.a + 1) * c, l = (Y.b - Y.a + 1) * c;
      // размеры пишем только там, где комната — честный прямоугольник: стены ровные, размер однозначный
      // проверка: внутри прямоугольника почти всё — пол, а по всем четырём сторонам стоят стены
      let inFree = 0, inAll = 0;
      for (let y = Y.a; y <= Y.b; y++) for (let x = X.a; x <= X.b; x++) { inAll++; if (!blocked[y * W + x]) inFree++; }
      const side = (pts) => pts.filter(([x, y]) => x < 0 || y < 0 || x >= W || y >= H || blocked[y * W + x]).length / pts.length;
      const top = [], bot = [], lef = [], rig = [];
      for (let x = X.a; x <= X.b; x++) { top.push([x, Y.a - 1]); bot.push([x, Y.b + 1]); }
      for (let y = Y.a; y <= Y.b; y++) { lef.push([X.a - 1, y]); rig.push([X.b + 1, y]); }
      const sides = [top, bot, lef, rig].map(side);
      // размеры пишем только там, где комната — честный прямоугольник
      if (X.share < 0.3 || Y.share < 0.3 || w < 0.9 || l < 0.9 || inFree / inAll < 0.9 || Math.min(...sides) < 0.5) continue;
      const rr = { x0: X.a * c, x1: (X.b + 1) * c, z0: Y.a * c, z1: (Y.b + 1) * c, w, l };
      if (!out.some((q) => Math.abs(q.x0 - rr.x0) + Math.abs(q.x1 - rr.x1) + Math.abs(q.z0 - rr.z0) + Math.abs(q.z1 - rr.z1) < 0.3)) out.push(rr);
    }
    return out;
  }

  /* ---------- Комнаты от подписей площади на плане ---------- */
  // от подписи «22,77 м²» идём лучами влево-вправо и вверх-вниз до стен; берём самый частый отрезок
  function seededRooms(A, seeds, glazing) {
    const { W, H, cell: c } = A, N = W * H;
    const blk = new Uint8Array(N);
    for (let i = 0; i < N; i++) blk[i] = A.wall[i] || A.opening[i] || A.lines[i] || (glazing && A.glz[i]) || (A.env && A.env[i]) || A.edge[i] < 0.03 ? 1 : 0;
    const B = (x, y) => x < 0 || y < 0 || x >= W || y >= H || blk[y * W + x] === 1;
    const runX = (x, y) => { if (B(x, y)) return null; let a = x, b = x; while (!B(a - 1, y)) a--; while (!B(b + 1, y)) b++; return [a, b]; };
    const runY = (x, y) => { if (B(x, y)) return null; let a = y, b = y; while (!B(x, a - 1)) a--; while (!B(x, b + 1)) b++; return [a, b]; };
    const mode = (list) => {
      list = list.filter(Boolean); if (list.length < 3) return null;
      const cnt = new Map(); list.forEach(([a, b]) => { const k = a + ',' + b; cnt.set(k, (cnt.get(k) || 0) + 1); });
      const [k] = [...cnt.entries()].sort((p, q) => q[1] - p[1])[0]; const [a, b] = k.split(',').map(Number);
      return { a, b, share: list.filter(([p, q]) => Math.abs(p - a) <= 1 && Math.abs(q - b) <= 1).length / list.length };
    };
    const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
    const out = [];
    for (const [mx, my, v] of seeds) {
      let cx = Math.floor(mx / c), cy = Math.floor(my / c);
      if (B(cx, cy)) { let f = null; for (let r = 1; r < 12 && !f; r++) for (let dy = -r; dy <= r && !f; dy++) for (let dx = -r; dx <= r && !f; dx++) if (!B(cx + dx, cy + dy)) f = [cx + dx, cy + dy]; if (!f) continue; [cx, cy] = f; }
      const sp = Math.round(0.9 / c);
      let X = mode(range(cy - sp, cy + sp).map((y) => runX(cx, y))), Y = mode(range(cx - sp, cx + sp).map((x) => runY(x, cy)));
      if (!X || !Y) continue;
      const mx2 = (X.a + X.b) >> 1, my2 = (Y.a + Y.b) >> 1;
      X = mode(range(Y.a, Y.b).map((y) => runX(mx2, y))); Y = mode(range(X ? X.a : 0, X ? X.b : -1).map((x) => runY(x, my2)));
      if (!X || !Y || X.share < 0.3 || Y.share < 0.3) continue;
      const w = (X.b - X.a + 1) * c, l = (Y.b - Y.a + 1) * c;
      if (w < 0.8 || l < 0.8) continue;
      out.push({ x0: X.a * c, x1: (X.b + 1) * c, z0: Y.a * c, z1: (Y.b + 1) * c, w, l, label: v });
    }
    return out;
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
  // фактуры черновой отделки: шпаклёвка на стенах, бетон на потолке
  function roughTexture(base, dots, blotch) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < blotch; k++) { const x = Math.random() * 256, y = Math.random() * 256, r = 20 + Math.random() * 50, gr = g.createRadialGradient(x, y, 0, x, y, r); const w = Math.random() < 0.5; gr.addColorStop(0, w ? 'rgba(255,255,255,.06)' : 'rgba(120,115,105,.04)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let k = 0; k < dots; k++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(90,85,78,.12)' : 'rgba(255,255,255,.18)'; g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  function boxesGeometry(list) {
    const P = [], N = [], I = [], UV = [];
    for (const [x0, z0, x1, z1, y0, y1] of list) {
      const F = [[[0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]], [[0, -1, 0], [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]]],
        [[1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]], [[-1, 0, 0], [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]]],
        [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]]];
      for (const [n, q] of F) {
        const k = P.length / 3;
        q.forEach((v) => { P.push(...v); N.push(...n); UV.push(n[1] ? v[0] / 1.5 : n[0] ? v[2] / 1.5 : v[0] / 1.5, n[1] ? v[2] / 1.5 : v[1] / 1.5); });
        I.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I);
    return g;
  }
  function build(A, height) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfe3f5);
    scene.fog = new THREE.Fog(0xcfe3f5, 40, 160);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a948a, 0.75));
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const sun = new THREE.DirectionalLight(0xfff3e0, 0.45); sun.position.set(8, 20, 5); scene.add(sun);
    TAGS = new THREE.Group(); scene.add(TAGS);
    const c = A.cell, wallMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: roughTexture('#e9e6e0', 5000, 40), side: THREE.DoubleSide }); // штукатурка под шпаклёвку
    const R = (grid) => rects(grid, A.W, A.H).map(([x, y, w, h]) => [x * c, y * c, (x + w) * c, (y + h) * c]);
    const wallGrid = A.wall.map((v, i) => (v && !A.doorCells[i] ? 1 : 0));
    const walls = new THREE.Mesh(boxesGeometry(R(wallGrid).map((r) => [...r, 0, height])), wallMat); scene.add(walls);
    if (A.door) { buildDoor(scene, A.door, height, wallMat); buildPanel(scene, A, A.door); }
    buildBalconies(scene, A, height, wallMat);
    buildWet(scene, A, height);
    const dims = new THREE.Group(); scene.add(dims); dims.add(TAGS); const tags = TAGS;
    addWallDims(dims, A, height);
    for (const r of A.rooms || []) addDims(dims, r, height);
    // окна высотой 1,80 м: подоконник 0,80 м, над окном перемычка
    const y0 = 0.8, y1 = Math.min(height - 0.15, y0 + 1.8);
    const ops = R(A.opening);
    scene.add(new THREE.Mesh(boxesGeometry(ops.map((r) => [...r, 0, y0])), wallMat));
    scene.add(new THREE.Mesh(boxesGeometry(ops.map((r) => [...r, y1, height])), wallMat));
    const glass = new THREE.Mesh(boxesGeometry(ops.map(([x0, z0, x1, z1]) => { const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, wide = x1 - x0 > z1 - z0; return wide ? [x0, cz - 0.01, x1, cz + 0.01, y0, y1] : [cx - 0.01, z0, cx + 0.01, z1, y0, y1]; })),
      new THREE.MeshLambertMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.1, depthWrite: false }));
    scene.add(glass);
    // рамы ПВХ: коробка по контуру, импосты между створками, подоконник внутри
    const frames = [], sills = [];
    for (const q of A.comps || []) {
      if (q.kind !== 'window' || q.len < 0.35 || !q.cells.some((j) => A.opening[j])) continue;
      const s0 = (q.horiz ? q.x0 : q.y0) * c, s1 = ((q.horiz ? q.x1 : q.y1) + 1) * c;
      const t0 = (q.horiz ? q.y0 : q.x0) * c, t1 = ((q.horiz ? q.y1 : q.x1) + 1) * c, tc = (t0 + t1) / 2;
      const nIn = -(q.horiz ? q.n[1] : q.n[0]); // направление внутрь квартиры поперёк стены
      const box = (u0, u1, v0, v1, a, b) => (q.horiz ? [u0, Math.min(v0, v1), u1, Math.max(v0, v1), a, b] : [Math.min(v0, v1), u0, Math.max(v0, v1), u1, a, b]);
      const F = 0.06, D = 0.035;
      frames.push(box(s0, s0 + F, tc - D, tc + D, y0, y1), box(s1 - F, s1, tc - D, tc + D, y0, y1),
        box(s0, s1, tc - D, tc + D, y0, y0 + F), box(s0, s1, tc - D, tc + D, y1 - F, y1));
      const sashes = Math.max(1, Math.round((s1 - s0) / 0.8));
      for (let k = 1; k < sashes; k++) { const u = s0 + (s1 - s0) * k / sashes; frames.push(box(u - 0.035, u + 0.035, tc - D, tc + D, y0, y1)); }
      if (y1 - y0 > 1.6) frames.push(box(s0, s1, tc - D, tc + D, y1 - 0.5, y1 - 0.45)); // фрамуга сверху
      const inner = nIn > 0 ? Math.max(t0, t1) : Math.min(t0, t1);
      sills.push(box(s0 - 0.05, s1 + 0.05, tc, inner + nIn * 0.22, y0 - 0.04, y0));
    }
    // наружные стены и окна в них: подоконная часть, перемычка, рама с импостами, стекло, подоконник, отлив
    const envWalls = [], glassB = [];
    for (const sp of A.envSpans || []) {
      const { s0, s1, t: T } = sp, tc = T / 2;
      if (sp.type === 'wall') { envWalls.push(spanBox(sp, s0, s1, 0, T, 0, height)); continue; }
      envWalls.push(spanBox(sp, s0, s1, 0, T, 0, y0), spanBox(sp, s0, s1, 0, T, y1, height));
      const FW = 0.065, D = 0.04;
      frames.push(spanBox(sp, s0, s0 + FW, tc - D, tc + D, y0, y1), spanBox(sp, s1 - FW, s1, tc - D, tc + D, y0, y1),
        spanBox(sp, s0, s1, tc - D, tc + D, y0, y0 + FW), spanBox(sp, s0, s1, tc - D, tc + D, y1 - FW, y1));
      const sashes = Math.max(1, Math.round((s1 - s0) / 0.9));
      for (let k = 1; k < sashes; k++) { const v = s0 + (s1 - s0) * k / sashes; frames.push(spanBox(sp, v - 0.035, v + 0.035, tc - D, tc + D, y0, y1)); }
      if (y1 - y0 > 1.6) frames.push(spanBox(sp, s0, s1, tc - D, tc + D, y1 - 0.5, y1 - 0.44)); // фрамуга
      glassB.push(spanBox(sp, s0, s1, tc - 0.01, tc + 0.01, y0, y1));
      sills.push(spanBox(sp, s0 - 0.04, s1 + 0.04, tc, T + 0.2, y0 - 0.04, y0)); // подоконник в комнату
      sills.push(spanBox(sp, s0, s1, -0.08, tc, y0 - 0.06, y0 - 0.03)); // отлив снаружи
    }
    if (envWalls.length) scene.add(new THREE.Mesh(boxesGeometry(envWalls), wallMat));
    // отопление разведено, радиаторов нет: под окном из пола выходят подача и обратка с заглушками
    const pipeMat = new THREE.MeshLambertMaterial({ color: 0xeeeeea }), capR = new THREE.MeshLambertMaterial({ color: 0xc8352a }), capB = new THREE.MeshLambertMaterial({ color: 0x2a62c8 });
    for (const sp of A.envSpans || []) {
      if (sp.type !== 'win' || sp.s1 - sp.s0 < 0.6) continue;
      [0, 1].forEach((k) => {
        const s = sp.s0 + 0.22 + k * 0.09, x = sp.a[0] + sp.u[0] * s + sp.m[0] * (sp.t + 0.07), z = sp.a[1] + sp.u[1] * s + sp.m[1] * (sp.t + 0.07);
        if ((A.balconies || []).some(({ r }) => x > r.x0 - 0.4 && x < r.x1 + 0.4 && z > r.z0 - 0.4 && z < r.z1 + 0.4)) return; // на балконе отопления нет
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 10), pipeMat); p.position.set(x, 0.16, z); scene.add(p);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.035, 10), k ? capB : capR); cap.position.set(x, 0.335, z); scene.add(cap);
        if (k) tag('Отопление · радиатор ставит покупатель', x - sp.u[0] * 0.045, 0.42, z - sp.u[1] * 0.045, '#c8352a');
      });
    }
    if (glassB.length) scene.add(new THREE.Mesh(boxesGeometry(glassB), glass.material));
    if (frames.length) scene.add(new THREE.Mesh(boxesGeometry(frames), new THREE.MeshLambertMaterial({ color: 0xfbfbf9 })));
    if (sills.length) scene.add(new THREE.Mesh(boxesGeometry(sills), new THREE.MeshLambertMaterial({ color: 0xffffff })));
    // пол — сама планировка
    // пол и потолок — по контуру квартиры плюс под всеми стенами: стена на чертеже бывает чуть за контуром,
    // и без этого у пола и потолка оставалась щель
    const cover = new Uint8Array(A.W * A.H);
    for (let i = 0; i < A.W * A.H; i++) cover[i] = A.edge[i] > -0.45 ? 1 : 0; // вся полоса до стены, даже если стена чуть за контуром
    const quads = rects(cover, A.W, A.H).map(([x, y, w, h]) => [x * c, y * c, (x + w) * c, (y + h) * c]);
    const slabGeom = () => {
      const P = [], UV = [], I = [];
      for (const [x0, z0, x1, z1] of quads) {
        const k = P.length / 3;
        for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) { P.push(x, -z, 0); UV.push(x / A.wm, 1 - z / A.hm); }
        I.push(k, k + 2, k + 1, k, k + 3, k + 2);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); g.computeVertexNormals(); return g;
    };
    const fg = slabGeom();
    const tex = new THREE.CanvasTexture(A.cv); tex.anisotropy = 8;
    const floor = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: tex, color: 0xb4b0a8, side: THREE.DoubleSide })); // стяжка — серее
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const ctex = roughTexture('#cfccc6', 7000, 60);
    const cg = slabGeom(); { const uv = cg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, cg.attributes.position.getX(i) / 2, cg.attributes.position.getY(i) / 2); }
    const ceil = new THREE.Mesh(cg, new THREE.MeshLambertMaterial({ color: 0xffffff, map: ctex, side: THREE.DoubleSide, emissive: 0x3a3936 })); // бетонная плита
    ceil.rotation.x = -Math.PI / 2; ceil.position.y = height; scene.add(ceil);
    // земля далеко внизу — вид в окно
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: 0x9cbf7d }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(A.wm / 2, -25, A.hm / 2); scene.add(ground);
    const pano = new THREE.Group(); scene.add(pano);
    return { scene, floor, ceil, walls, tex, ground, dims, pano, tags };
  }

  /* ---------- Вид из окон: снимки карты с высоты квартиры на кольце вокруг ---------- */
  // Снимок карты — это перспектива из точки у окна. Ставим его плоским экраном на расстоянии R
  // в том же направлении и с тем же наклоном: тогда из квартиры дома стоят ровно, без завала.
  function panoSetup(B, A, v) {
    if (B.panoReady) return;
    B.panoReady = true;
    B.panoCtr = A.polyM.reduce((s, q) => [s[0] + q[0] / A.polyM.length, s[1] + q[1] / A.polyM.length], [0, 0]);
    B.ground.position.y = -1e4; // землю и небо теперь рисует купол панорамы
    // небесный купол: голубой зенит, светлый горизонт, земля снизу — едет вместе с глазами
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256; const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#6fa3d8'); gr.addColorStop(0.42, '#bcd6ee'); gr.addColorStop(0.5, '#e9eef2'); gr.addColorStop(0.53, '#e6e1d8'); gr.addColorStop(1, '#d9d4cb');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(80, 24, 16), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false }));
    dome.renderOrder = -5; B.pano.add(dome);
  }
  function addShot(B, A, v, s) {
    panoSetup(B, A, v);
    const R = 90, w = 2 * R * Math.tan(s.hfov * Math.PI / 360), h = 2 * R * Math.tan(s.vfov * Math.PI / 360);
    const tex = new THREE.TextureLoader().load(s.url);
    const holder = new THREE.Object3D();
    holder.rotation.order = 'YXZ';
    holder.rotation.y = -s.yaw * Math.PI / 180;   // поворот по горизонту
    holder.rotation.x = s.elev * Math.PI / 180;   // наклон вниз
    holder.position.set(0, 0, 0); // панорама «бесконечно далеко» — едет вместе с глазами, как небо
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    m.position.z = -R;
    // горизонт поверх нижних рядов; центральный кадр стороны поверх боковых
    m.renderOrder = -2 + (3 - s.row) * 0.01 + (s.center ? 0.005 : 0);
    holder.add(m); B.pano.add(holder);
  }

  /* ---------- Бронированная входная дверь ---------- */
  function doorTexture() {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
    const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 256, 0); grd.addColorStop(0, '#3a2f2a'); grd.addColorStop(0.5, '#4a3c34'); grd.addColorStop(1, '#33291f');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 512);
    // фрезеровка панели МДФ
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 5; g.strokeRect(34, 34, 188, 444);
    g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = 2; g.strokeRect(38, 38, 180, 436);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3;
    for (const y of [150, 256, 362]) { g.beginPath(); g.moveTo(60, y); g.lineTo(196, y); g.stroke(); }
    g.beginPath(); g.moveTo(128, 60); g.lineTo(128, 140); g.moveTo(128, 372); g.lineTo(128, 452); g.stroke();
    // глазок и замки
    g.fillStyle = '#c9c4bb'; g.beginPath(); g.arc(128, 150, 6, 0, 7); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(128, 150, 3, 0, 7); g.fill();
    g.fillStyle = '#b8b2a7'; g.fillRect(204, 250, 14, 22); g.fillRect(204, 300, 14, 22);
    g.fillStyle = '#222'; g.fillRect(209, 256, 4, 10); g.fillRect(209, 306, 4, 10);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
  }
  // щит квартиры у входа, рядом выведены кабели интернета и домофона
  function buildPanel(scene, A, d) {
    const c = A.cell;
    const cellOf = (x, z) => { const cx = Math.floor(x / c), cz = Math.floor(z / c); return cx >= 0 && cz >= 0 && cx < A.W && cz < A.H ? cz * A.W + cx : -1; };
    const isWall = (x, z) => { const i = cellOf(x, z); return i >= 0 && A.wall[i] && !A.doorCells[i]; };
    const freeAt = (x, z) => { const i = cellOf(x, z); return i >= 0 && !A.wall[i] && !(A.env && A.env[i]) && A.edge[i] > 0.05; };
    const clearLine = (p, q) => { const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (c / 2))); for (let k = 0; k <= n; k++) if (!freeAt(p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n)) return false; return true; };
    // оси двери: U — вдоль стены с дверью, N — внутрь квартиры
    const inn = d.horiz ? -d.n[1] : -d.n[0];
    const U = d.horiz ? [1, 0] : [0, 1], N = d.horiz ? [0, inn] : [inn, 0];
    const face = d.horiz ? (inn > 0 ? d.z1 : d.z0) : (inn > 0 ? d.x1 : d.x0);
    const a0 = d.horiz ? d.x0 : d.z0, a1 = d.horiz ? d.x1 : d.z1, mid = (a0 + a1) / 2, wallMid = (d.horiz ? (d.z0 + d.z1) : (d.x0 + d.x1)) / 2;
    const P = (u, dpt) => { const v = face + inn * dpt; return d.horiz ? [u, v] : [v, u]; };
    const doorIn = P(mid, 0.45);
    // санузел — это где стояки в том же помещении, без стены между ними и щитом
    const inBath = (q) => (A.wet || []).some((p) => p.k === 'b' && Math.hypot(p.x - q[0], p.z - q[1]) < 2.6 && clearLine(q, [p.x + p.nx * 0.15, p.z + p.nz * 0.15]));
    const ok = (front) => freeAt(front[0], front[1]) && clearLine(doorIn, front) && !inBath(front);
    // щит — в прихожей у входа: за ним стена, от двери до него не мешает стена, рядом нет санузла
    let mount = null;
    for (const u of [a1 + 0.3, a0 - 0.3, a1 + 0.55, a0 - 0.55, a1 + 0.85, a0 - 0.85, a1 + 1.2, a0 - 1.2, a1 + 1.6, a0 - 1.6]) {
      const w = d.horiz ? [u, wallMid] : [wallMid, u];
      if (isWall(w[0], w[1]) && ok(P(u, 0.35))) { const f = P(u, 0); mount = { f, n: N, t: U, s: u > a1 ? 1 : -1 }; break; }
    }
    // иначе — на боковую стену прихожей (тамбура) рядом с дверью
    for (const dpt of [0.6, 0.9, 1.2, 1.6, 2.0]) for (const s of [1, -1]) {
      if (mount) break;
      const st = P(mid, dpt); let k = 0;
      while (k < 2.2 && freeAt(st[0] + U[0] * s * k, st[1] + U[1] * s * k)) k += c / 2;
      if (k >= 2.2 || k < 0.3) continue;
      const f = [st[0] + U[0] * s * k, st[1] + U[1] * s * k], n = [-U[0] * s, -U[1] * s];
      if (ok([f[0] + n[0] * 0.35, f[1] + n[1] * 0.35])) mount = { f, n, t: N, s: 1 };
    }
    A.panel = !!mount;
    if (!mount) return;
    const { f, n, t: tv } = mount, rotY = Math.atan2(n[0], n[1]);
    const at = (a, dd) => [f[0] + tv[0] * a + n[0] * dd, f[1] + tv[1] * a + n[1] * dd];
    const put = (m, a, y, dd) => { const [x, z] = at(a, dd); m.position.set(x, y, z); m.rotation.y = rotY; scene.add(m); };
    put(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.09), new THREE.MeshLambertMaterial({ color: 0xd9dbde })), 0, 1.75, 0.045);
    put(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.01), new THREE.MeshLambertMaterial({ color: 0xc4c7cc })), 0, 1.75, 0.095);
    put(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.005), new THREE.MeshBasicMaterial({ color: 0xf2c200 })), 0, 1.86, 0.1);
    { const [x, z] = at(0, 0.12); tag('Щит квартиры', x, 2.0, z, '#6f747b'); }
    // кабели: интернет (чёрный) и домофон (белый) выходят из стены и висят петлёй
    const off = 0.24 * mount.s;
    [[0x202020, 0], [0xf4f4f4, 0.05]].forEach(([col, dx]) => put(new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.005, 6, 20), new THREE.MeshLambertMaterial({ color: col })), off + dx, 2.08, 0.03));
    { const [x, z] = at(off + 0.025, 0.1); tag('Интернет · домофон', x, 2.2, z, '#14161a'); }
  }
  function buildDoor(scene, d, H, wallMat) {
    const DW = 0.96, DH = 2.05, T = 0.07; // полотно 960 × 2050 мм
    const len = d.horiz ? d.x1 - d.x0 : d.z1 - d.z0, mid = d.horiz ? (d.x0 + d.x1) / 2 : (d.z0 + d.z1) / 2;
    const w = Math.min(DW, len - 0.1), a = mid - w / 2, b = mid + w / 2;
    const thick0 = d.horiz ? d.z0 : d.x0, thick1 = d.horiz ? d.z1 : d.x1, tc = (thick0 + thick1) / 2;
    // перевод «вдоль проёма / поперёк» в мировые координаты
    const box = (u0, u1, v0, v1, y0, y1) => (d.horiz ? [u0, v0, u1, v1, y0, y1] : [v0, u0, v1, u1, y0, y1]);
    const fill = [], frame = [];
    const s0 = d.horiz ? d.x0 : d.z0, s1 = d.horiz ? d.x1 : d.z1;
    if (a - 0.06 > s0) fill.push(box(s0, a - 0.06, thick0, thick1, 0, H));
    if (b + 0.06 < s1) fill.push(box(b + 0.06, s1, thick0, thick1, 0, H));
    fill.push(box(a - 0.06, b + 0.06, thick0, thick1, DH + 0.06, H));
    // металлическая коробка
    frame.push(box(a - 0.06, a, thick0 - 0.01, thick1 + 0.01, 0, DH + 0.06), box(b, b + 0.06, thick0 - 0.01, thick1 + 0.01, 0, DH + 0.06), box(a - 0.06, b + 0.06, thick0 - 0.01, thick1 + 0.01, DH, DH + 0.06));
    scene.add(new THREE.Mesh(boxesGeometry(fill), wallMat));
    scene.add(new THREE.Mesh(boxesGeometry(frame), new THREE.MeshLambertMaterial({ color: 0x2a2522 })));
    // полотно с текстурой с обеих сторон
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, DH, T), [0, 1, 2, 3, 4, 5].map((k) => (k >= 4 ? new THREE.MeshLambertMaterial({ map: doorTexture() }) : new THREE.MeshLambertMaterial({ color: 0x2b231e }))));
    leaf.position.set(d.horiz ? mid : tc, DH / 2, d.horiz ? tc : mid);
    if (!d.horiz) leaf.rotation.y = Math.PI / 2;
    scene.add(leaf);
    // ручки с обеих сторон
    const steel = new THREE.MeshLambertMaterial({ color: 0xd8d6d0 }), off = w / 2 - 0.09;
    for (const sd of [-1, 1]) {
      const hnd = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.025), steel);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.012), steel);
      const z = sd * (T / 2 + 0.04), zp = sd * (T / 2 + 0.006), u = off - 0.05;
      const place = (m, uu, y, zz) => { m.position.set(d.horiz ? mid + uu : tc + zz, y, d.horiz ? tc + zz : mid + uu); if (!d.horiz) m.rotation.y = Math.PI / 2; scene.add(m); };
      place(hnd, u, 1.0, z); place(plate, off, 1.0, zp);
    }
  }

  /* ---------- Размеры на стенах ---------- */
  const fmtM = (v) => v.toFixed(2).replace('.', ',') + ' м';
  const DIM_H = 0.26; // высота полоски с размером, м
  function dimTexture(text, Lm, vertical) {
    const T = 96, L = Math.min(2048, Math.round(T * Lm / DIM_H));
    const cv = document.createElement('canvas'); cv.width = vertical ? T : L; cv.height = vertical ? L : T;
    const g = cv.getContext('2d');
    if (vertical) { g.translate(T, 0); g.rotate(Math.PI / 2); }
    const M = T / 2;
    g.strokeStyle = '#d4572a'; g.fillStyle = '#d4572a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(4, M); g.lineTo(L - 4, M); g.stroke();
    for (const x of [4, L - 4]) { g.beginPath(); g.moveTo(x, M - 24); g.lineTo(x, M + 24); g.stroke(); }
    for (const [x, s] of [[4, 1], [L - 4, -1]]) { g.beginPath(); g.moveTo(x, M); g.lineTo(x + s * 26, M - 11); g.lineTo(x + s * 26, M + 11); g.fill(); }
    g.font = '800 44px Manrope, Segoe UI, sans-serif'; const tw = g.measureText(text).width + 34;
    g.fillStyle = '#fff'; g.beginPath(); if (g.roundRect) g.roundRect(L / 2 - tw / 2, M - 30, tw, 60, 30); else g.rect(L / 2 - tw / 2, M - 30, tw, 60); g.fill();
    g.strokeStyle = '#d4572a'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#14161a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, L / 2, M + 2);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
  }
  // длина каждой стены: ищем на сетке ровные участки «стена — пол» длиннее 0,7 м и подписываем их посередине
  function addWallDims(group, A, H) {
    const { W, H: GH, cell: c } = A;
    const blocked = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= GH) return true; const i = y * W + x; return !!(A.wall[i] || A.opening[i] || A.doorCells[i] || (A.env && A.env[i]) || A.edge[i] < 0.03); };
    const free = (x, y) => !blocked(x, y);
    const y = H / 2 + 0.35, gap = 0.012, runs = [];
    // горизонтальные стены (вдоль x): стена сверху (z меньше) или снизу от пола
    for (const dir of [-1, 1]) for (let gy = 0; gy < GH; gy++) {
      let s0 = -1;
      for (let gx = 0; gx <= W; gx++) {
        const on = gx < W && free(gx, gy) && blocked(gx, gy + dir);
        if (on && s0 < 0) s0 = gx;
        if (!on && s0 >= 0) { runs.push({ horiz: true, a: s0 * c, b: gx * c, line: (dir < 0 ? gy : gy + 1) * c, dir }); s0 = -1; }
      }
    }
    for (const dir of [-1, 1]) for (let gx = 0; gx < W; gx++) {
      let s0 = -1;
      for (let gy = 0; gy <= GH; gy++) {
        const on = gy < GH && free(gx, gy) && blocked(gx + dir, gy);
        if (on && s0 < 0) s0 = gy;
        if (!on && s0 >= 0) { runs.push({ horiz: false, a: s0 * c, b: gy * c, line: (dir < 0 ? gx : gx + 1) * c, dir }); s0 = -1; }
      }
    }
    for (const r of runs) {
      const L = r.b - r.a; if (L < 0.7) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(L, DIM_H), new THREE.MeshBasicMaterial({ map: dimTexture(fmtM(L), L, false), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      const mid = (r.a + r.b) / 2, off = -r.dir * gap; // чуть в сторону комнаты
      if (r.horiz) { m.position.set(mid, y, r.line + off); m.rotation.y = r.dir < 0 ? 0 : Math.PI; }
      else { m.position.set(r.line + off, y, mid); m.rotation.y = r.dir < 0 ? Math.PI / 2 : -Math.PI / 2; }
      group.add(m);
    }
  }
  // высота потолка — вертикальной линией в углу комнаты
  function addDims(group, r, H) {
    const mk = (text, Lm, vertical) => new THREE.Mesh(vertical ? new THREE.PlaneGeometry(DIM_H, Lm) : new THREE.PlaneGeometry(Lm, DIM_H),
      new THREE.MeshBasicMaterial({ map: dimTexture(text, Lm, vertical), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    // размер — по центру каждой из четырёх стен, на уровне глаз; высота — вертикально в углу
    const y = H / 2 + 0.35, gap = 0.012, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const v = mk('h ' + fmtM(H), H, true); v.position.set(r.x0 + 0.2, H / 2, r.z1 - gap); v.rotation.y = Math.PI; group.add(v);
  }

  /* ---------- Интерфейс ---------- */
  function close() {
    if (!T) return;
    cancelAnimationFrame(T.raf); window.removeEventListener('keydown', T.kd); window.removeEventListener('keyup', T.ku); window.removeEventListener('resize', T.rs);
    if (T.renderer) T.renderer.dispose();
    if (T.scene) T.scene.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) [].concat(m.material).forEach((mt) => { if (mt.map) mt.map.dispose(); mt.dispose(); }); });
    T.root.remove(); T = null;
  }
  function open(o) {
    close();
    const root = document.createElement('div'); root.className = 'tour';
    root.innerHTML = `<canvas></canvas>
      <div class="tour-top"><div><b>🏠 3D-тур по квартире</b><span>${o.title}</span></div>
        <div class="tour-modes"><button data-m="top" class="on">Сверху</button><button data-m="walk">🚶 Прогулка</button></div>
        <button class="tour-dims on" title="Показать или скрыть размеры и подписи">📏 Подписи</button>
        <button class="tour-hand" title="Что входит в квартиру при сдаче">🧱 Как сдаётся</button>
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
    // уточняем масштаб: доля свободного пола внутри контура должна дать площадь квартиры
    let ins = 0, fr = 0;
    for (let i = 0; i < A.W * A.H; i++) if (A.edge[i] > 0) { ins++; if (!A.wall[i] && !A.opening[i]) fr++; }
    const k = Math.max(0.72, Math.min(0.95, fr / ins));
    if (!o.mpp && Math.abs(k - A.k) > 0.01) { const A2 = analyse(img, o, A.thr, k); if (A2.ok) A = A2; }
    const labs = (o.labels || []).filter(([, , v]) => Math.abs(v - o.area) > 0.05);
    const findRooms = (X) => {
      if (!labs.length) return rooms(X);
      const seeds = labs.map(([x, y, v]) => [...X.toM([x, y]), v]).filter(([x, y]) => pointInPoly([x, y], X.polyM));
      return seededRooms(X, seeds);
    };
    classify(A, o);
    A.rooms = findRooms(A);
    // сверка с площадями комнат, подписанными на плане: по ним уточняем масштаб,
    // и размеры показываем только у комнат, чья найденная площадь совпала с подписью
    const match = (X) => {
      const L = labs.map(([x, y, v]) => [...X.toM([x, y]), v]);
      return X.rooms.map((r) => { if (r.label) return r.label / (r.w * r.l); const ins = L.filter(([x, y]) => x > r.x0 && x < r.x1 && y > r.z0 && y < r.z1); return ins.length === 1 ? ins[0][2] / (r.w * r.l) : 0; });
    };
    const ratios = match(A).filter((q) => q > 0.85 && q < 1.18).sort((a, b) => a - b);
    // масштаб уточняем, только если хотя бы две комнаты согласны между собой
    if (!o.mpp && ratios.length >= 2 && ratios[ratios.length - 1] / ratios[0] < 1.1) {
      const f = ratios[ratios.length >> 1];
      if (Math.abs(f - 1) > 0.008) { const A2 = analyse(img, o, A.thr, A.k / f); if (A2.ok) { classify(A2, o); A2.rooms = findRooms(A2); A = A2; } }
    }
    const fin = match(A);
    A.cand = A.rooms.map((r, i) => ({ label: r.label, q: fin[i], mpp: A.mpp }));
    A.rooms = A.rooms.map((r, i) => [r, fin[i]]).filter(([, q]) => q && Math.abs(q - 1) < 0.06)
      .map(([r, q]) => Object.assign(r, { w: r.w * Math.sqrt(q), l: r.l * Math.sqrt(q), area: r.w * r.l * q }));
    $('.tour-msg', root).remove();
    const canvas = $('canvas', root);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    envelope(A, o);
    balconies(A, o);
    wetPoints(A, o);
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
        const i = Z * A.W + X; if (A.wall[i] || A.opening[i] || (A.env && A.env[i]) || A.edge[i] < 0.05) return false;
      }
      return true;
    };
    // путь в обход стен: поиск в ширину по свободным клеткам, точки маршрута через каждые ~40 см
    let walkable = null;
    const goTo = (x, z) => {
      const W = A.W, N = A.W * A.H, c = A.cell, ci = (px, pz) => Math.floor(pz / c) * W + Math.floor(px / c);
      if (!walkable) { walkable = new Uint8Array(N); for (let i = 0; i < N; i++) walkable[i] = free((i % W + 0.5) * c, ((i / W | 0) + 0.5) * c) ? 1 : 0; }
      const s = ci(walk.x, walk.z), g = ci(x, z);
      if (g < 0 || g >= N || !walkable[g]) return false;
      const prev = new Int32Array(N).fill(-1); prev[s] = s; const q = [s];
      for (let h = 0; h < q.length && prev[g] < 0; h++) { const j = q[h], cx = j % W; for (const n of [cx > 0 ? j - 1 : -1, cx < W - 1 ? j + 1 : -1, j - W, j + W]) if (n >= 0 && n < N && walkable[n] && prev[n] < 0) { prev[n] = j; q.push(n); } }
      if (prev[g] < 0) return false; // туда не пройти
      T.goal = [x, z];
      const cells = []; for (let j = g; j !== s; j = prev[j]) cells.push(j); cells.reverse();
      const pts = cells.filter((_, k) => k % 8 === 7 || k === cells.length - 1).map((j) => [(j % W + 0.5) * c, ((j / W | 0) + 0.5) * c]);
      T.target = pts.shift() || null; T.path = pts; return true;
    };
    const stopWalk = () => { T.target = null; T.path = null; T.goal = null; };
    // старт: свободная точка ближе к центру, взгляд туда, где больше места
    const ctr = A.polyM.reduce((s, q) => [s[0] + q[0] / A.polyM.length, s[1] + q[1] / A.polyM.length], [0, 0]);
    let best = null;
    for (let z = 0; z < A.H; z += 3) for (let x = 0; x < A.W; x += 3) { const px = (x + 0.5) * A.cell, pz = (z + 0.5) * A.cell; if (!free(px, pz)) continue; const d = Math.hypot(px - ctr[0], pz - ctr[1]); if (!best || d < best.d) best = { d, x: px, z: pz }; }
    const walk = { x: best ? best.x : ctr[0], z: best ? best.z : ctr[1], yaw: 0, pitch: -0.05 };
    let far = -1;
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; let t = 0; while (t < 12 && free(walk.x + Math.sin(a) * t, walk.z - Math.cos(a) * t)) t += 0.1; if (t > far) { far = t; walk.yaw = a; } }
    const orbit = { yaw: 0.6, pitch: 1.0, r: Math.max(A.wm, A.hm) * 1.05 + 3, cx: ctr[0], cz: ctr[1] };

    const help = $('.tour-help', root), joy = $('.tour-joy', root), touch = matchMedia('(pointer: coarse)').matches;

    // мини-карта: планировка квартиры, точка — где вы стоите, конус — куда смотрите; клик — пойти туда
    const mini = document.createElement('div'); mini.className = 'tour-mini'; mini.hidden = true;
    const mc = document.createElement('canvas'); mini.append(mc); root.append(mini);
    const MS = touch ? 170 : 240, msc = MS / Math.max(A.wm, A.hm), dpr = Math.min(2, devicePixelRatio || 1);
    const mw = Math.round(A.wm * msc), mh = Math.round(A.hm * msc);
    mc.width = mw * dpr; mc.height = mh * dpr; mc.style.width = mw + 'px'; mc.style.height = mh + 'px';
    const mg = mc.getContext('2d'); mg.scale(dpr, dpr);
    const base = document.createElement('canvas'); base.width = mw * dpr; base.height = mh * dpr;
    { // подложка рисуется один раз: план внутри контура квартиры, снаружи — затемнение
      const g = base.getContext('2d'); g.scale(dpr, dpr);
      g.fillStyle = 'rgba(20,22,26,.35)'; g.fillRect(0, 0, mw, mh);
      g.save(); g.beginPath(); A.polyM.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](x * msc, z * msc)); g.closePath(); g.clip();
      g.drawImage(A.planCv, 0, 0, mw, mh); g.restore();
      g.strokeStyle = '#d4572a'; g.lineWidth = 1.5; g.beginPath(); A.polyM.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](x * msc, z * msc)); g.closePath(); g.stroke();
    }
    let lastMini = '';
    const drawMini = () => {
      const key = walk.x.toFixed(2) + walk.z.toFixed(2) + walk.yaw.toFixed(2) + (T.goal ? T.goal.join() : '');
      if (key === lastMini || mini.hidden) return; lastMini = key;
      mg.clearRect(0, 0, mw, mh); mg.drawImage(base, 0, 0, mw, mh);
      const px = walk.x * msc, pz = walk.z * msc, fov = 0.6, L = 42;
      if (T.goal) { mg.fillStyle = 'rgba(212,87,42,.35)'; mg.beginPath(); mg.arc(T.goal[0] * msc, T.goal[1] * msc, 7, 0, 7); mg.fill(); }
      const cone = mg.createRadialGradient(px, pz, 2, px, pz, L); cone.addColorStop(0, 'rgba(212,87,42,.85)'); cone.addColorStop(1, 'rgba(212,87,42,.05)');
      mg.fillStyle = cone; mg.beginPath(); mg.moveTo(px, pz);
      mg.arc(px, pz, L, walk.yaw - Math.PI / 2 - fov, walk.yaw - Math.PI / 2 + fov); mg.closePath(); mg.fill();
      mg.fillStyle = '#fff'; mg.beginPath(); mg.arc(px, pz, 6.5, 0, 7); mg.fill();
      mg.fillStyle = '#d4572a'; mg.beginPath(); mg.arc(px, pz, 4.5, 0, 7); mg.fill();
    };
    mini.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const r = mc.getBoundingClientRect(), x = (e.clientX - r.left) / msc, z = (e.clientY - r.top) / msc;
      goTo(x, z);
    });
    const setMode = (m) => {
      T.mode = m; stopWalk();
      root.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
      B.ceil.visible = m === 'walk'; B.ground.visible = m === 'walk'; B.pano.visible = m === 'walk'; B.scene.background = new THREE.Color(0xcfe3f5);
      joy.hidden = !(m === 'walk' && touch);
      mini.hidden = m !== 'walk';
      help.textContent = m === 'walk'
        ? (touch ? 'Джойстик — идти, ведите пальцем — осмотреться, нажмите на пол или мини-карту — пойти туда' : 'W A S D или стрелки — идти · тяните мышью — осмотреться · клик по полу или мини-карте — пойти туда')
        : 'Тяните — повернуть · колесо или два пальца — приблизить · нажмите на комнату — войти туда';
    };
    root.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => setMode(b.dataset.m));
    // что входит в квартиру при сдаче — по договору застройщика
    const handBtn = $('.tour-hand', root);
    if (!o.handover) handBtn.hidden = true;
    else handBtn.onclick = () => {
      let box = $('.tour-handbox', root);
      if (box) { box.remove(); handBtn.classList.remove('on'); return; }
      box = document.createElement('div'); box.className = 'tour-handbox';
      box.innerHTML = '<b>🧱 ' + o.handover.title + ' — так квартира выглядит при сдаче</b><ul>' + o.handover.included.map((x) => '<li>' + x + '</li>').join('') + '</ul><p>Не входит: ' + o.handover.notIncluded + '.</p>';
      root.append(box); handBtn.classList.add('on');
    };
    const dimBtn = $('.tour-dims', root);
    dimBtn.hidden = !B.dims.children.length;
    dimBtn.onclick = () => { B.dims.visible = !B.dims.visible; dimBtn.classList.toggle('on', B.dims.visible); };
    setMode('top');
    if (o.view) {
      const note = document.createElement('div'); note.className = 'tour-note'; note.textContent = '🌇 Загружаю вид из окон…'; root.append(note);
      const v = o.view;
      v.shots.forEach((s) => addShot(B, A, v, s));
      v.on((s) => { if (T && T.renderer === renderer) addShot(B, A, v, s); });
      v.done.then(() => {
        if (!T || T.renderer !== renderer) return;
        if (v.shots.length) { note.textContent = '🌇 За окнами — вид с вашего этажа'; setTimeout(() => note.remove(), 3500); }
        else note.remove();
      });
    }

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
      // в прогулке «тянем картинку»: мышь вправо — вид поворачивается влево, как в панорамах
      if (T.mode === 'walk') { walk.yaw -= dx * 0.005; walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch + dy * 0.004)); }
      else { orbit.yaw += dx * 0.006; orbit.pitch = Math.max(0.25, Math.min(1.5, orbit.pitch + dy * 0.005)); }
    });
    const up = (e) => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (drag && drag.moved < 6 && pts.size === 0) { // клик по полу
        const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
        ray.setFromCamera(ndc, cam); const hit = ray.intersectObject(B.floor)[0];
        if (hit && free(hit.point.x, hit.point.z)) {
          if (T.mode === 'top') { walk.x = hit.point.x; walk.z = hit.point.z; walk.yaw = orbit.yaw + Math.PI; setMode('walk'); }
          else goTo(hit.point.x, hit.point.z);
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
    joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); jmove(e); stopWalk(); });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) jmove(e); });
    const jend = () => { jid = null; T.joy = [0, 0]; knob.style.transform = ''; };
    joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);

    const tagRay = new THREE.Raycaster();
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
        if ((f || s) && T.target) stopWalk(); // своё управление отменяет маршрут
        if (T.target && !f && !s) {
          const dx = T.target[0] - walk.x, dz = T.target[1] - walk.z, d = Math.hypot(dx, dz);
          if (d < (T.path && T.path.length ? 0.2 : 0.08)) { T.target = T.path && T.path.length ? T.path.shift() : null; if (!T.target) stopWalk(); } else { mx = dx / d; mz = dz / d; const ty = Math.atan2(dx, -dz); let dd = ty - walk.yaw; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); walk.yaw += dd * Math.min(1, dt * 4); }
        }
        const L = Math.hypot(mx, mz);
        if (L > 0) {
          const st = 1.5 * dt / Math.max(1, L);
          const okx = free(walk.x + mx * st, walk.z); if (okx) walk.x += mx * st;
          const okz = free(walk.x, walk.z + mz * st); if (okz) walk.z += mz * st;
          // на углу упёрлись обеими осями — точка маршрута свободна и рядом (≤ 40 см), встаём на неё
          if (!okx && !okz && T.target) { walk.x = T.target[0]; walk.z = T.target[1]; }
        }
        cam.position.set(walk.x, Math.min(EYE, H - 0.3), walk.z);
        cam.lookAt(walk.x + Math.sin(walk.yaw) * Math.cos(walk.pitch), cam.position.y + Math.sin(walk.pitch), walk.z - Math.cos(walk.yaw) * Math.cos(walk.pitch));
      } else {
        cam.position.set(orbit.cx + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.r, Math.sin(orbit.pitch) * orbit.r, orbit.cz + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.r);
        cam.lookAt(orbit.cx, 0, orbit.cz);
      }
      if (B.pano.visible) B.pano.position.copy(cam.position);
      // таблички поверх всего, но если между вами и табличкой стена — прячем
      if (T.mode === 'walk' && B.dims.visible && (T.tagTick = (T.tagTick || 0) + 1) % 6 === 0) {
        if (!T.blockers) T.blockers = scene.children.filter((o) => o.isMesh && o !== B.floor && o !== B.ceil && o !== B.ground && (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere.radius > 1));
        for (const s of B.tags.children) {
          const to = s.position.clone().setY(s.position.y + 0.04).sub(cam.position), dist = to.length();
          tagRay.set(cam.position, to.normalize()); tagRay.far = dist - 0.05;
          s.visible = dist < 7 && !tagRay.intersectObjects(T.blockers, false).length;
        }
      }
      if (T.mode !== 'walk') B.tags.children.forEach((s) => { s.visible = true; });
      renderer.render(scene, cam);
      if (T.mode === 'walk') drawMini();
      T.raf = requestAnimationFrame(loop);
    };
    T.raf = requestAnimationFrame(loop);
    T.debug = { A, walk, orbit, setMode, cam, B };
  }

  window.YurtaTour = { open, close, _analyse: analyse, _dbg: () => T && T.debug && Object.assign(T.debug, { target: T.target, path: T.path, goal: T.goal }) };
})();
