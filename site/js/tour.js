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
    // длинные тонкие прямые линии (остекление, тонкие перегородки, полотна дверей) — преграды для замера комнат
    const lineAt = new Uint8Array(w * h), minRun = Math.round(0.7 / mpp);
    const isLine = (k) => { const i = k * 4, r = px[i], gg = px[i + 1], b = px[i + 2]; return (0.3 * r + 0.59 * gg + 0.11 * b) < 165 && Math.max(r, gg, b) - Math.min(r, gg, b) < 50; };
    const lm = new Uint8Array(w * h); for (let k = 0; k < w * h; k++) lm[k] = isLine(k) ? 1 : 0;
    // длина серии тёмных пикселей по горизонтали и вертикали; линия — длинная в одну сторону и тонкая в другую
    const hl = new Uint16Array(w * h), vl = new Uint16Array(w * h), thin = Math.max(2, Math.round(0.06 / mpp));
    for (let y = 0; y < h; y++) { let s0 = -1; for (let x = 0; x <= w; x++) { const on = x < w && lm[y * w + x]; if (on && s0 < 0) s0 = x; if (!on && s0 >= 0) { for (let q = s0; q < x; q++) hl[y * w + q] = x - s0; s0 = -1; } } }
    for (let x = 0; x < w; x++) { let s0 = -1; for (let y = 0; y <= h; y++) { const on = y < h && lm[y * w + x]; if (on && s0 < 0) s0 = y; if (!on && s0 >= 0) { for (let q = s0; q < y; q++) vl[q * w + x] = y - s0; s0 = -1; } } }
    for (let k = 0; k < w * h; k++) if ((hl[k] >= minRun && vl[k] <= thin) || (vl[k] >= minRun && hl[k] <= thin)) lineAt[k] = 1;
    if (thr > 190) dark = morph(morph(morph(morph(dark, (c) => c === 9), (c) => c === 9), (c) => c > 0), (c) => c > 0); // серая заливка стен: убираем ещё и линии мебели
    // сетка 5 см
    const cp = Math.max(1, Math.round(CELL / mpp)), cell = cp * mpp;
    const W = Math.floor(w / cp), H = Math.floor(h / cp);
    const polyM = polyPx.map(([x, y]) => [(x - X0) * mpp, (y - Y0) * mpp]);
    const wall = new Uint8Array(W * H), inner = new Uint8Array(W * H), edge = new Float32Array(W * H), lines = new Uint8Array(W * H);
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
    return { thr, k, mpp, toM, wallM2: walls * cell * cell, cv: fl, W, H, cell, wall, lines, inner, edge, opening, polyM, wm: w * mpp, hm: h * mpp, ok: walls * cell * cell > 2.5 };
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
  function seededRooms(A, seeds) {
    const { W, H, cell: c } = A, N = W * H;
    const blk = new Uint8Array(N);
    for (let i = 0; i < N; i++) blk[i] = A.wall[i] || A.opening[i] || A.lines[i] || A.edge[i] < 0.03 ? 1 : 0;
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
    const wallGrid = A.wall.map((v, i) => (v && !A.doorCells[i] ? 1 : 0));
    const walls = new THREE.Mesh(boxesGeometry(R(wallGrid).map((r) => [...r, 0, height])), wallMat); scene.add(walls);
    if (A.door) buildDoor(scene, A.door, height, wallMat);
    const dims = new THREE.Group(); scene.add(dims);
    for (const r of A.rooms || []) addDims(dims, r, height);
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
    return { scene, floor, ceil, walls, tex, ground, dims };
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
  function addDims(group, r, H) {
    const mk = (text, Lm, vertical) => new THREE.Mesh(vertical ? new THREE.PlaneGeometry(DIM_H, Lm) : new THREE.PlaneGeometry(Lm, DIM_H),
      new THREE.MeshBasicMaterial({ map: dimTexture(text, Lm, vertical), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const y = H - 0.2, gap = 0.012;
    // ширина — на верхней по плану стене, длина — на левой, высота — в углу нижней стены
    const a = mk(fmtM(r.w), r.w, false); a.position.set((r.x0 + r.x1) / 2, y, r.z0 + gap); group.add(a);
    const b = mk(fmtM(r.l), r.l, false); b.position.set(r.x0 + gap, y, (r.z0 + r.z1) / 2); b.rotation.y = Math.PI / 2; group.add(b);
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
        <button class="tour-dims on" title="Показать или скрыть размеры комнат">📏 Размеры</button>
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
    const dimBtn = $('.tour-dims', root);
    dimBtn.hidden = !A.rooms.length;
    dimBtn.onclick = () => { B.dims.visible = !B.dims.visible; dimBtn.classList.toggle('on', B.dims.visible); };
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

  window.YurtaTour = { open, close, _analyse: analyse, _dbg: () => T && T.debug };
})();
