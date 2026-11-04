# Извлекает контур этажа (силуэт стен) из картинки планировки -> прямоугольный многоугольник в координатах плана.
# Запуск: python tools/outline.py out.json — затем контуры вставляются в site/js/data.js (поле outline у планировки)
import sys, json, re
import numpy as np, pymupdf

IMG = 'C:/Users/arlen/юрта/site/'
DATA = open('C:/Users/arlen/юрта/site/js/data.js', encoding='utf-8').read()

def plan_block(name):
    i = DATA.index('const ' + name); blk = DATA[i:DATA.index('};', i)]
    img = re.search(r"img: '([^']+)'", blk).group(1)
    w, h = int(re.search(r'w: (\d+)', blk).group(1)), int(re.search(r'h: (\d+)', blk).group(1))
    polys = [json.loads(m) for m in re.findall(r'poly: (\[\[.*?\]\])', blk)]
    return img, w, h, polys

def gray(path):
    pix = pymupdf.Pixmap(path)
    if pix.n > 1: pix = pymupdf.Pixmap(pymupdf.csGRAY, pix)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).astype(np.float32)

def dilate(g, k=1):
    out = g.copy()
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            out |= np.roll(np.roll(g, dy, 0), dx, 1)
    return out
def erode(g, k=1): return ~dilate(~g, k)

def fill_holes(g):
    H, W = g.shape; outside = np.zeros_like(g); stack = [(y, x) for y in range(H) for x in (0, W - 1)] + [(y, x) for x in range(W) for y in (0, H - 1)]
    while stack:
        y, x = stack.pop()
        if 0 <= y < H and 0 <= x < W and not g[y, x] and not outside[y, x]:
            outside[y, x] = True; stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
    return ~outside

def largest(g):
    H, W = g.shape; lab = np.zeros(g.shape, int); best, bl, n = 0, 0, 0
    for y in range(H):
        for x in range(W):
            if g[y, x] and not lab[y, x]:
                n += 1; st = [(y, x)]; lab[y, x] = n; c = 0
                while st:
                    a, b = st.pop(); c += 1
                    for q in ((a + 1, b), (a - 1, b), (a, b + 1), (a, b - 1)):
                        if 0 <= q[0] < H and 0 <= q[1] < W and g[q] and not lab[q]: lab[q] = n; st.append(q)
                if c > best: best, bl = c, n
    return lab == bl

def trace(g):
    # обход внешней границы по рёбрам клеток (по часовой), углы клеток в индексах сетки
    H, W = g.shape; G = np.zeros((H + 2, W + 2), bool); G[1:-1, 1:-1] = g
    edges = {}
    for y in range(H + 2):
        for x in range(W + 2):
            if not G[y, x]: continue
            if not G[y - 1, x]: edges[(x, y)] = (x + 1, y)
            if not G[y, x + 1]: edges[(x + 1, y)] = (x + 1, y + 1)
            if not G[y + 1, x]: edges[(x + 1, y + 1)] = (x, y + 1)
            if not G[y, x - 1]: edges[(x, y + 1)] = (x, y)
    start = min(edges); pts = [start]; cur = edges[start]
    while cur != start: pts.append(cur); cur = edges[cur]
    # убираем точки на прямой
    out = []
    for i, p in enumerate(pts):
        a, c = pts[i - 1], pts[(i + 1) % len(pts)]
        if (a[0] == p[0] == c[0]) or (a[1] == p[1] == c[1]): continue
        out.append(p)
    return [(x - 1, y - 1) for x, y in out]

def simplify(pts, minlen):
    # убираем мелкие ступеньки короче minlen клеток (шум от балконов и текста)
    changed = True
    while changed and len(pts) > 4:
        changed = False
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            if abs(a[0] - b[0]) + abs(a[1] - b[1]) < minlen:
                c, d = pts[(i + 2) % len(pts)], pts[i - 1]
                # сдвигаем отрезок a-b на линию соседа: выравниваем
                if a[0] == b[0]:  # вертикальный короткий -> b берёт x соседа d? проще: удаляем ступеньку
                    nb = (d[0], c[1]) if d[1] == a[1] else (c[0], d[1])
                else:
                    nb = (d[0], c[1]) if d[0] == a[0] else (c[0], d[1])
                new = [p for j, p in enumerate(pts) if j not in (i, (i + 1) % len(pts))]
                k = new.index(c) if c in new else None
                if k is None: continue
                new.insert(k, nb)
                # чистим коллинеарные
                cl = []
                for j, p in enumerate(new):
                    q, r = new[j - 1], new[(j + 1) % len(new)]
                    if (q[0] == p[0] == r[0]) or (q[1] == p[1] == r[1]) or p == q: continue
                    cl.append(p)
                if len(cl) >= 4: pts = cl; changed = True; break
    return pts

def outline(name, length_m):
    img, w, h, polys = plan_block(name)
    a = gray(IMG + img); sc = a.shape[1] / w
    xs = [q[0] for pl in polys for q in pl]; ys = [q[1] for pl in polys for q in pl]
    bx0, bx1, by0, by1 = min(xs) * sc, max(xs) * sc, min(ys) * sc, max(ys) * sc
    pad = (bx1 - bx0) * 0.03
    X0, X1, Y0, Y1 = int(max(0, bx0 - pad)), int(min(a.shape[1], bx1 + pad)), int(max(0, by0 - pad)), int(min(a.shape[0], by1 + pad))
    m = a[Y0:Y1, X0:X1] < 200  # стены и закрашенные комнаты
    cell = (bx1 - bx0) / (length_m / 0.5)  # клетка ~0.5 м
    gh, gw = int(m.shape[0] / cell), int(m.shape[1] / cell)
    grid = np.zeros((gh, gw), bool)
    for y in range(gh):
        for x in range(gw):
            blk = m[int(y * cell):int((y + 1) * cell), int(x * cell):int((x + 1) * cell)]
            grid[y, x] = blk.mean() > 0.12
    grid = erode(dilate(grid, 2), 2)   # замыкаем двери/окна
    grid = largest(fill_holes(grid))
    grid = dilate(erode(grid, 1), 1)   # убираем тонкие выступы (подписи, вынос балконов)
    pts = simplify(trace(grid), 3)     # ступеньки < 1.5 м убираем
    out = [[round((X0 + x * cell) / sc, 1), round((Y0 + y * cell) / sc, 1)] for x, y in pts]
    return out

if __name__ == '__main__':
    res = {}
    for name, L in [('GOLD_PLAN_B', 46), ('GOLD_PLAN_VG', 46), ('ORDO_PLAN_1', 39.2), ('ORDO_PLAN_2', 34), ('PLUS_PLAN_1', 38.4), ('PLUS_PLAN_2', 24.8)]:
        res[name] = outline(name, L)
        print(name, len(res[name]), file=sys.stderr)
    json.dump(res, open(sys.argv[1], 'w'))
