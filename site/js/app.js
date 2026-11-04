/* Юрта — карта новостроек Бишкека с 3D-моделями и рассрочкой */
(() => {
  const CFG = window.YURTA_CONFIG;
  const PROJECTS = window.YURTA_PROJECTS;
  const $ = (s, el = document) => el.querySelector(s);
  const panelBody = $('#panelBody');
  const panel = $('#panel');
  const tooltip = $('#tooltip');

  const ST_LABEL = { free: 'Свободна', booked: 'Бронь', sold: 'Продана' };
  const som = (v) => Math.round(v).toLocaleString('ru-RU') + ' ' + CFG.currency;
  const somShort = (v) => v >= 1e6 ? (v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' млн ' + CFG.currency : som(v);
  const area = (v) => v.toFixed(2).replace('.', ',') + ' м²';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const roomsLabel = (a) => `${a.rooms}-комнатная`;
  const roomsShort = (a) => `${a.rooms}-комн.`;
  // «Евро» — только пояснение: кухня объединена с гостиной
  const euroNote = (a) => a.euro ? 'евро-планировка: кухня-гостиная' : '';
  const euroTag = (a) => a.euro ? ' <span class="euro">евро</span>' : '';
  const monthsLabel = (m) => `${m} мес.`;
  const blockName = (p, b) => `Блок ${b.id}`;

  /* ---------- Геометрия ---------- */
  const M_LAT = 111132;
  function toLngLat(p, [x, y]) {
    const r = (p.rotation || 0) * Math.PI / 180;
    const xr = x * Math.cos(r) - y * Math.sin(r), yr = x * Math.sin(r) + y * Math.cos(r);
    const mLng = M_LAT * Math.cos(p.origin[1] * Math.PI / 180);
    return [p.origin[0] + xr / mLng, p.origin[1] + yr / M_LAT];
  }
  const centroid = (pts) => [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
  const floorBase = (p, f) => p.residentialBase + (f - p.firstResidentialFloor) * p.floorHeight;

  /* ---------- Квартиры, цены, статусы ---------- */
  function hash(str) {
    let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  const aptNumber = (p, b, f, a) => (f - p.firstResidentialFloor) * b.plan.apts.length + a.n;
  function status(p, b, f, a) {
    const key = `${b.id}-${aptNumber(p, b, f, a)}`;
    if (p.soldApts[key]) return p.soldApts[key];
    if (!p.demoStatuses) return 'free';
    const r = hash(p.id + key);
    return r < 0.16 ? 'sold' : r < 0.24 ? 'booked' : 'free';
  }
  const priceM2 = (p, b) => b.pricePerM2 || p.pricePerM2;
  const aptPrice = (p, b, a) => Math.round(a.area * priceM2(p, b));
  const floorsOf = (p, b) => Array.from({ length: b.floors - p.firstResidentialFloor + 1 }, (_, i) => p.firstResidentialFloor + i);
  const freeCount = (p, b, f) => b.plan.apts.filter((a) => status(p, b, f, a) === 'free').length;
  const blockFree = (p, b) => floorsOf(p, b).reduce((s, f) => s + freeCount(p, b, f), 0);
  const projectFree = (p) => p.blocks.reduce((s, b) => s + blockFree(p, b), 0);
  const monthly = (p, price, down, months) => Math.max(0, price - down) / months;
  function priceRange(p) {
    let min = Infinity, max = 0;
    for (const b of p.blocks) for (const a of b.plan.apts) { const v = aptPrice(p, b, a); min = Math.min(min, v); max = Math.max(max, v); }
    return [min, max];
  }
  const m2Range = (p) => { const v = [...new Set(p.blocks.map((b) => priceM2(p, b)))].sort((a, b) => a - b); return v; };

  /* ---------- Карта ---------- */
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: CFG.city.center, zoom: CFG.city.zoom, pitch: 45, bearing: -12, maxPitch: 75,
    attributionControl: { compact: true },
    antialias: true,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  window.yurtaMap = map; // для отладки из консоли

  const state = { district: 'all', project: null, block: null, floor: null, apt: null, hoverKey: null };
  const markers = [];
  let engine = null;

  map.on('load', () => {
    try { map.setSky({ 'sky-color': '#a9c7e8', 'horizon-color': '#eef2f6', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-color': '#eef2f6', 'fog-ground-blend': 0.2 }); } catch (e) {}
    // участки — светлая подложка под моделью
    map.addSource('y-plots', { type: 'geojson', data: { type: 'FeatureCollection', features: PROJECTS.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(p, p.plot)] } })) } });
    map.addLayer({ id: 'y-plots', type: 'fill', source: 'y-plots', paint: { 'fill-color': '#d9d4ca', 'fill-opacity': 0.9 } });
    engine = window.Yurta3D.init(map, PROJECTS, { floorBase });
    hideOsmBuildings();
    map.on('sourcedata', (e) => { if (e.sourceId === 'openmaptiles' && e.isSourceLoaded) hideOsmBuildings(); });
    addMarkers();
    setupInteractions();
    route();
  });
  function ring(p, pts) { const r = pts.map((q) => toLngLat(p, q)); r.push(r[0]); return r; }

  // Прячем старые здания OSM в пятне участка, чтобы не торчали сквозь модель
  const hiddenIds = new Set(), origFilters = {};
  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function hideOsmBuildings() {
    if (!map.getSource('openmaptiles')) return;
    const plots = PROJECTS.map((p) => ring(p, p.plot));
    let changed = false;
    for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' })) {
      if (f.id == null || hiddenIds.has(f.id)) continue;
      const g = f.geometry;
      const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((c) => c[0]) : [];
      if (rings.some((r) => plots.some((pl) => pointInPoly(centroid(r), pl) || r.some((pt) => pointInPoly(pt, pl))))) { hiddenIds.add(f.id); changed = true; }
    }
    if (!changed) return;
    const notHidden = ['!', ['in', ['id'], ['literal', [...hiddenIds]]]];
    for (const l of map.getStyle().layers) {
      if (l['source-layer'] !== 'building') continue;
      if (!(l.id in origFilters)) origFilters[l.id] = map.getFilter(l.id) || null;
      const orig = origFilters[l.id];
      try { map.setFilter(l.id, orig ? ['all', orig, notHidden] : notHidden); } catch (e) {}
    }
  }

  function addMarkers() {
    markers.forEach((m) => m.remove()); markers.length = 0;
    for (const p of visibleProjects()) {
      const el = document.createElement('div');
      el.className = 'pmarker' + (budgetDone() && !budgetMatch(p, state.budget.down, state.budget.monthly).ok ? ' dim' : '');
      el.innerHTML = `<div class="pill"><img src="${p.renders[0]}" alt=""><div>${esc(p.name)}<small>от ${somShort(m2Range(p)[0])}/м²</small></div></div><div class="stem"></div><div class="dot"></div>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); go(`#/${p.id}`); });
      const mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(p.marker).addTo(map);
      mk._project = p; markers.push(mk);
    }
    updateMarkerVisibility();
  }
  function updateMarkerVisibility() {
    const z = map.getZoom();
    markers.forEach((m) => { m.getElement().style.display = (z > 15.5 && state.project && state.project.id === m._project.id) ? 'none' : ''; });
  }
  map.on('zoom', updateMarkerVisibility);

  function setupInteractions() {
    let raf = 0, last = null;
    map.on('mousemove', (e) => {
      last = e; if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; onHover(last); });
    });
    map.getCanvas().addEventListener('mouseleave', () => { setHover(null); hideTip(); });
    map.on('click', (e) => {
      const hit = engine && engine.pick(e.point);
      if (!hit) return;
      const p = hit.project;
      if (hit.floor) go(`#/${p.id}/${hit.block.id}/${hit.floor}`);
      else if (hit.block) go(`#/${p.id}/${hit.block.id}`);
      else if (!state.project || state.project.id !== p.id) go(`#/${p.id}`);
    });
  }
  function onHover(e) {
    const hit = engine && engine.pick(e.point);
    if (!hit) { setHover(null); hideTip(); map.getCanvas().style.cursor = ''; return; }
    map.getCanvas().style.cursor = 'pointer';
    const p = hit.project;
    if (hit.floor) {
      setHover(p, hit.block, hit.floor);
      showTip(e.originalEvent, `<b>${esc(p.name)} · ${blockName(p, hit.block)}</b><br>${hit.floor} этаж · свободно ${freeCount(p, hit.block, hit.floor)} из ${hit.block.plan.apts.length}`);
    } else {
      setHover(null);
      showTip(e.originalEvent, `<b>${esc(p.name)}</b><br>${hit.block ? blockName(p, hit.block) + ' · ' : ''}коммерция и сервисы`);
    }
  }
  function setHover(p, b, f) {
    const key = p ? `${p.id}|${b.id}|${f}` : null;
    if (key === state.hoverKey) return;
    state.hoverKey = key;
    engine && engine.highlight('hover', p, b, f);
  }
  function showTip(ev, html) {
    tooltip.innerHTML = html; tooltip.hidden = false;
    const x = Math.min(ev.clientX + 14, innerWidth - tooltip.offsetWidth - 8);
    tooltip.style.left = x + 'px'; tooltip.style.top = (ev.clientY + 14) + 'px';
  }
  function hideTip() { tooltip.hidden = true; }
  const selectFloor3D = (p, b, f) => engine && engine.highlight('sel', p, b, f);

  /* ---------- Камера ---------- */
  const isMobile = () => innerWidth <= 760;
  const camPad = () => isMobile() ? { top: 40, bottom: innerHeight * 0.5, left: 0, right: 0 } : { left: 420 + 32, top: 40, right: 40, bottom: 40 };
  function flyProject(p) {
    const v = p.view;
    map.flyTo({ center: toLngLat(p, centroid(p.plot)), zoom: v.zoom - (isMobile() ? 0.7 : 0), pitch: v.pitch, bearing: v.bearing, duration: 2200, padding: camPad(), essential: true });
  }
  /* Камера смотрит на блок снаружи комплекса, а на квартиру — со стороны её окон.
     Направления — «азимуты» в метрах участка: 0° = север (+y), 90° = восток (+x). */
  const DEG = 180 / Math.PI;
  const azim = (dx, dy) => (Math.atan2(dx, dy) * DEG + 360) % 360;
  const toMapBearing = (p, localAz) => localAz - (p.rotation || 0); // поворот модели против часовой
  function blockFacing(p, b) {
    const cs = p.blocks.map((x) => centroid(x.fp));
    const pc = [cs.reduce((s, c) => s + c[0], 0) / cs.length, cs.reduce((s, c) => s + c[1], 0) / cs.length];
    const bc = centroid(b.fp);
    let vx = bc[0] - pc[0], vy = bc[1] - pc[1];
    if (Math.hypot(vx, vy) < 1) vy = -1; // центральный блок — смотрим с юга
    // привязываем к ближайшему фасаду (оси x/y участка)
    return Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 90 : 270) : (vy > 0 ? 0 : 180);
  }
  // Куда смотрят окна квартиры: по положению квартиры на плане этажа
  function planUp(p, b) {
    if (b.planUp != null) return b.planUp;
    const xs = b.fp.map((q) => q[0]), ys = b.fp.map((q) => q[1]);
    const vertical = Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs);
    const widePlan = b.plan.w > b.plan.h * 1.15;
    return vertical && widePlan ? 270 : 0; // план «лёжа» на вытянутом с севера на юг блоке
  }
  // Контур квартиры в метрах участка: план этажа «накладывается» на пятно блока с учётом поворота planUp
  function aptLocalPoly(p, b, a) {
    const all = b.plan.apts.flatMap((x) => x.poly);
    const px0 = Math.min(...all.map((q) => q[0])), px1 = Math.max(...all.map((q) => q[0]));
    const py0 = Math.min(...all.map((q) => q[1])), py1 = Math.max(...all.map((q) => q[1]));
    const xs = b.fp.map((q) => q[0]), ys = b.fp.map((q) => q[1]);
    const W = Math.max(...xs) - Math.min(...xs), H = Math.max(...ys) - Math.min(...ys);
    const C = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
    const th = planUp(p, b) / DEG, Rv = [Math.cos(th), -Math.sin(th)], Uv = [Math.sin(th), Math.cos(th)];
    const hR = (Math.abs(Rv[0]) * W + Math.abs(Rv[1]) * H) / 2, hU = (Math.abs(Uv[0]) * W + Math.abs(Uv[1]) * H) / 2;
    return a.poly.map(([x, y]) => {
      const u = (x - px0) / (px1 - px0) - 0.5, t = 0.5 - (y - py0) / (py1 - py0);
      return [C[0] + 2 * hR * u * Rv[0] + 2 * hU * t * Uv[0], C[1] + 2 * hR * u * Rv[1] + 2 * hU * t * Uv[1]];
    });
  }
  function aptFacing(p, b, a) {
    const c = centroid(aptLocalPoly(p, b, a)), bc = centroid(b.fp);
    return azim(c[0] - bc[0], c[1] - bc[1]);
  }

  function flyAt(p, b, localAz, extra = {}) {
    // камера стоит со стороны localAz и смотрит на блок
    const bearing = toMapBearing(p, localAz + 180 + 18);
    const top = floorBase(p, b.floors + 1);
    map.flyTo({ center: toLngLat(p, centroid(b.fp)), zoom: 18.6 - top / 70 - (isMobile() ? 0.6 : 0), pitch: 60, bearing, duration: 1600, padding: camPad(), essential: true, ...extra });
  }
  const flyBlock = (p, b) => flyAt(p, b, blockFacing(p, b));
  const flyApt = (p, b, a) => flyAt(p, b, aptFacing(p, b, a), { duration: 1300 });
  function flyCity() { map.flyTo({ center: CFG.city.center, zoom: CFG.city.zoom, pitch: 45, bearing: -12, duration: 1800, padding: camPad() }); }

  /* ---------- Роутинг ---------- */
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  window.addEventListener('hashchange', route);
  $('#logoLink').addEventListener('click', (e) => { e.preventDefault(); go('#/'); });

  function route() {
    const parts = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
    const p = PROJECTS.find((x) => x.id === parts[0]);
    const b = p && p.blocks.find((x) => x.id === parts[1]);
    const f = b && parseInt(parts[2], 10);
    const a = b && f && b.plan.apts.find((x) => x.n === parseInt(parts[3], 10));
    const prevProject = state.project, prevBlock = state.block, prevApt = state.apt;
    state.project = p || null; state.block = b || null;
    state.floor = (b && f >= p.firstResidentialFloor && f <= b.floors) ? f : null;
    state.apt = state.floor ? a || null : null;
    selectFloor3D(state.project, state.block, state.floor);
    if (engine) engine.focusBlock(state.block ? p : null, b); // остальные блоки — полупрозрачные, чтобы не закрывали вид
    if (engine) engine.highlightApt(state.apt ? p : null, b, state.floor, state.apt ? aptLocalPoly(p, b, state.apt) : null);
    updateMarkerVisibility();
    document.documentElement.style.setProperty('--brand', p ? p.brandColor : '#14161a');

    if (!p) { renderList(); if (prevProject) flyCity(); }
    else if (!b) { renderProject(p); flyProject(p); }
    else if (!state.floor) { renderBlock(p, b); flyBlock(p, b); }
    else if (!state.apt) { renderFloor(p, b, state.floor); if (prevBlock !== b || prevApt) flyBlock(p, b); }
    else { renderApt(p, b, state.floor, state.apt); if (prevApt !== state.apt) flyApt(p, b, state.apt); }
    panelBody.scrollTop = 0;
    if (isMobile() && p) setSheet('');
    // сообщаем чату, что смотрит гость
    const ctx = { hash: location.hash, project: p ? p.name : null, projectId: p ? p.id : null, block: b ? b.id : null, floor: state.floor };
    if (state.apt) {
      const a = state.apt;
      Object.assign(ctx, { apt: aptNumber(p, b, state.floor, a), rooms: roomsLabel(a), area: a.area, price: aptPrice(p, b, a), status: status(p, b, state.floor, a) });
    }
    window.dispatchEvent(new CustomEvent('yurta:route', { detail: ctx }));
  }
  window.YurtaApp = { som, go: (h) => go(h) };

  /* ---------- Панель ---------- */
  const backBtn = (href) => `<button class="back" data-go="${href}" aria-label="Назад"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>`;
  panelBody.addEventListener('click', (e) => { const t = e.target.closest('[data-go]'); if (t) go(t.dataset.go); });
  const visibleProjects = () => PROJECTS.filter((p) => state.district === 'all' || p.district === state.district);
  const districtName = (id) => (CFG.districts.find((d) => d.id === id) || {}).name || '';

  /* ---------- Подбор по бюджету: взнос → платёж в месяц → подходящие квартиры ---------- */
  const DOWN_PRESETS = [900000, 1400000, 2000000, 3000000, 5000000];
  const MONTHLY_PRESETS = [30000, 50000, 70000, 100000, 150000];
  const short = (v) => v >= 1e6 ? (v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн' : Math.round(v / 1000) + ' тыс';
  state.budget = { down: null, monthly: null };
  try { const b = JSON.parse(localStorage.getItem('yurta_budget') || 'null'); if (b && b.down) state.budget = b; } catch (e) {}
  const saveBudget = () => { try { localStorage.setItem('yurta_budget', JSON.stringify(state.budget)); } catch (e) {} };

  // Все свободные варианты в ЖК, которые укладываются во взнос D и платёж M
  function budgetMatch(p, D, M) {
    const inst = p.installment;
    if (D < inst.downPayment) return { ok: false, reason: `взнос от ${somShort(inst.downPayment)}` };
    const maxPrice = D + M * inst.months;
    const groups = new Map();
    let total = 0;
    for (const b of p.blocks) for (const a of b.plan.apts) {
      const price = aptPrice(p, b, a);
      if (price > maxPrice) continue;
      const key = `${roomsLabel(a)}|${a.area}|${price}`;
      for (const f of floorsOf(p, b)) {
        if (status(p, b, f, a) !== 'free') continue;
        total++;
        const g = groups.get(key);
        if (g) g.count++;
        else groups.set(key, { a, b, f, price, count: 1, monthly: monthly(p, price, Math.min(D, price), inst.months) });
      }
    }
    if (!total) {
      const [minP] = priceRange(p);
      return { ok: false, reason: `нужен платёж от ${som(Math.ceil(Math.max(0, minP - D) / inst.months / 1000) * 1000)}/мес` };
    }
    const layouts = [...groups.values()].sort((x, y) => y.a.area - x.a.area || x.price - y.price);
    return { ok: true, total, layouts };
  }
  const budgetDone = () => state.budget.down && state.budget.monthly;

  function budgetHtml() {
    const B = state.budget;
    const chips = (vals, cur, attr) => vals.map((v) => `<button class="bchip ${cur === v ? 'on' : ''}" data-${attr}="${v}">до ${short(v)}</button>`).join('');
    const custom = (attr, ph) => `<form class="bcustom" data-for="${attr}"><input inputmode="numeric" placeholder="${ph}" aria-label="${ph}"><button>OK</button></form>`;
    let h = `<div class="budget"><div class="b-head"><b>Подобрать квартиру по бюджету</b>${B.down ? '<button class="link-btn" id="bReset">Сбросить</button>' : ''}</div>`;
    if (!B.down) {
      h += `<div class="b-q"><span class="b-n">1</span>Сколько можете внести сразу — первоначальный взнос?</div>
        <div class="bchips">${chips(DOWN_PRESETS, null, 'down')}</div>${custom('down', 'Своя сумма, сом')}`;
    } else {
      h += `<button class="b-done" data-edit="down"><span class="b-n ok">✓</span>Взнос: <b>до ${som(B.down)}</b><span>изменить</span></button>`;
      if (!B.monthly) {
        h += `<div class="b-q"><span class="b-n">2</span>Сколько готовы платить в месяц?</div>
          <div class="bchips">${chips(MONTHLY_PRESETS, null, 'monthly')}</div>${custom('monthly', 'Своя сумма в месяц, сом')}`;
      } else {
        h += `<button class="b-done" data-edit="monthly"><span class="b-n ok">✓</span>В месяц: <b>до ${som(B.monthly)}</b><span>изменить</span></button>`;
      }
    }
    return h + '</div>';
  }
  function resultsHtml(list) {
    const { down: D, monthly: M } = state.budget;
    const rows = list.map((p) => ({ p, r: budgetMatch(p, D, M) }));
    const good = rows.filter((x) => x.r.ok), bad = rows.filter((x) => !x.r.ok);
    const total = good.reduce((s, x) => s + x.r.total, 0);
    let h = good.length
      ? `<div class="b-sum">Подходит <b>${total.toLocaleString('ru-RU')}</b> ${plural(total, 'квартира', 'квартиры', 'квартир')} в ${good.length} ЖК</div>`
      : `<div class="empty" style="padding:20px 6px">С таким бюджетом пока нет вариантов.<br>${bad.map((x) => `${esc(x.p.name)}: ${x.r.reason}`).join('<br>')}</div>`;
    for (const { p, r } of good) {
      h += `<div class="rcard">
        <div class="rhead" data-go="#/${p.id}"><img src="${p.renders[0]}" alt=""><div><h3>${esc(p.name)}</h3><div class="small">${districtName(p.district)} р-н · сдача ${esc(p.completion)}</div><div class="small"><b style="color:var(--free)">${r.total} ${plural(r.total, 'вариант', 'варианта', 'вариантов')}</b> по вашему бюджету</div></div></div>
        ${r.layouts.slice(0, 4).map((g) => `<div class="rrow" data-go="#/${p.id}/${g.b.id}/${g.f}/${g.a.n}">
          <div><b>${roomsLabel(g.a)}</b>${euroTag(g.a)} · ${area(g.a.area)}<div class="small">${som(g.price)} · свободно ${g.count}</div></div>
          <div class="rpay"><b>${som(g.monthly)}</b><span>в месяц</span></div></div>`).join('')}
        ${r.layouts.length > 4 ? `<button class="link-btn" data-go="#/${p.id}" style="margin:8px 0 0">Ещё ${r.layouts.length - 4} ${plural(r.layouts.length - 4, 'планировка', 'планировки', 'планировок')} →</button>` : ''}
      </div>`;
    }
    if (good.length && bad.length) h += `<div class="b-bad"><div class="small" style="margin-bottom:6px">Не подходят по бюджету:</div>${bad.map((x) => `<div data-go="#/${x.p.id}"><b>${esc(x.p.name)}</b> — ${x.r.reason}</div>`).join('')}</div>`;
    return h;
  }
  function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many; }

  function renderList() {
    const list = visibleProjects();
    panelBody.innerHTML = `
      <h1>Квартиры в рассрочку<br>на карте Бишкека</h1>
      <p class="muted" style="margin:8px 0 14px">Укажите бюджет — покажем, что подходит. Или выберите дом на карте.</p>
      ${budgetHtml()}
      <div class="chips">${CFG.districts.map((d) => { const n = d.id === 'all' ? PROJECTS.length : PROJECTS.filter((p) => p.district === d.id).length; return `<button class="chip ${d.id === state.district ? 'active' : ''} ${n ? '' : 'zero'}" data-d="${d.id}">${d.name}<span class="cnt">${n}</span></button>`; }).join('')}</div>
      ${!list.length ? `<div class="empty">В этом районе пока нет объектов.<br>Скоро добавим.</div>` : budgetDone() ? resultsHtml(list) : list.map(cardHtml).join('')}`;
    panelBody.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { state.district = c.dataset.d; renderList(); addMarkers(); }));
    const set = (k, v) => { state.budget[k] = v; if (k === 'down') state.budget.monthly = null; saveBudget(); renderList(); addMarkers(); };
    panelBody.querySelectorAll('[data-down]').forEach((b) => b.onclick = () => set('down', +b.dataset.down));
    panelBody.querySelectorAll('[data-monthly]').forEach((b) => b.onclick = () => set('monthly', +b.dataset.monthly));
    panelBody.querySelectorAll('.bcustom').forEach((f) => {
      const inp = f.querySelector('input');
      inp.addEventListener('input', () => { const d = inp.value.replace(/\D/g, ''); inp.value = d ? (+d).toLocaleString('ru-RU') : ''; });
      f.onsubmit = (e) => { e.preventDefault(); const v = +inp.value.replace(/\D/g, ''); if (v > 0) set(f.dataset.for, v); };
    });
    panelBody.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
      if (b.dataset.edit === 'down') state.budget = { down: null, monthly: null }; else state.budget.monthly = null;
      saveBudget(); renderList(); addMarkers();
    });
    const r = $('#bReset'); if (r) r.onclick = () => { state.budget = { down: null, monthly: null }; saveBudget(); renderList(); addMarkers(); };
  }
  function cardHtml(p) {
    const m2 = m2Range(p);
    return `<div class="card" data-go="#/${p.id}">
      <img src="${p.renders[0]}" alt="${esc(p.name)}" loading="lazy">
      <div class="card-body">
        <div class="row"><h2>${esc(p.name)}</h2><span class="small">${districtName(p.district)} р-н</span></div>
        <div class="muted" style="font-size:13px;margin-top:2px">${esc(p.address)}</div>
        <div class="card-price">${m2.length > 1 ? 'от ' : ''}${som(m2[0])} <span>за м²</span></div>
        <div class="tags">
          <span class="tag hot">Взнос ${somShort(p.installment.downPayment)}</span>
          <span class="tag">Рассрочка ${monthsLabel(p.installment.months)}</span>
          <span class="tag">Сдача ${esc(p.completion)}</span>
          <span class="tag">${p.stats.floors} эт.</span>
        </div>
      </div></div>`;
  }

  function galleryHtml(p) {
    return `<div class="gallery" id="gal"><img src="${p.renders[0]}" alt="${esc(p.name)}">
      <button class="nav prev" aria-label="Назад">‹</button><button class="nav next" aria-label="Вперёд">›</button>
      <div class="dots">${p.renders.map((_, i) => `<button class="${i ? '' : 'on'}" data-i="${i}" aria-label="Фото ${i + 1}"></button>`).join('')}</div></div>`;
  }
  function bindGallery(p) {
    const g = $('#gal'); if (!g) return; let i = 0;
    const show = (k) => { i = (k + p.renders.length) % p.renders.length; g.querySelector('img').src = p.renders[i]; g.querySelectorAll('.dots button').forEach((d, j) => d.classList.toggle('on', j === i)); };
    g.querySelector('.prev').onclick = () => show(i - 1);
    g.querySelector('.next').onclick = () => show(i + 1);
    g.querySelectorAll('.dots button').forEach((d) => d.onclick = () => show(+d.dataset.i));
    g.querySelector('img').onclick = () => openModal(`<img src="${p.renders[i]}" style="width:100%;border-radius:12px;display:block">`, true);
    p.renders.forEach((src) => { const im = new Image(); im.src = src; });
  }

  function renderProject(p) {
    const [minP] = priceRange(p);
    const inst = p.installment;
    const m2 = m2Range(p);
    panelBody.innerHTML = `
      <div class="crumbs">${backBtn('#/')}<span>Все объекты</span></div>
      ${galleryHtml(p)}
      <div class="small" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700">${esc(p.klass)}</div>
      <h1 style="margin-top:4px">ЖК ${esc(p.name)}</h1>
      <p class="muted" style="margin:6px 0 0">${esc(p.address)} · ${districtName(p.district)} район</p>
      <div class="offer">
        <div class="sub">Цена за м²</div>
        <div class="big">${m2.map(som).join(' / ')}</div>
        ${m2.length > 1 ? `<div class="sub">${p.blocks.filter((b) => b.pricePerM2).map((b) => b.id).join(', ')} блоки — ${som(m2[1])}, остальные — ${som(m2[0])}</div>` : ''}
        <div class="grid">
          <div>Взнос<b>${somShort(inst.downPayment)}</b></div>
          <div>Рассрочка<b>${monthsLabel(inst.months)}</b></div>
          <div>Сдача<b>${esc(p.completion)}</b></div>
        </div>
        <div class="sub" style="margin-top:12px">Квартиры от ${somShort(minP)} · платёж от ${som(monthly(p, minP, inst.downPayment, inst.months))}/мес</div>
      </div>
      <div class="facts">
        <div class="fact"><b>${p.stats.apartments}</b><span>квартир</span></div>
        <div class="fact"><b>${projectFree(p)}</b><span>свободно сейчас</span></div>
        <div class="fact"><b>${p.stats.floors}</b><span>этажей</span></div>
        <div class="fact"><b>${p.stats.blocks}</b><span>блоков</span></div>
      </div>
      <p class="muted" style="font-size:13px">${esc(p.about)}</p>
      <div class="section-title"><h3>Выберите блок</h3><span class="small">или нажмите на этаж в 3D</span></div>
      <div class="blocks">${p.blocks.map((b) => `<button class="block-btn" data-go="#/${p.id}/${b.id}"><b>${b.id}</b><span>${b.floors} эт. · ${blockFree(p, b)} своб.</span></button>`).join('')}</div>
      <div class="hint">🖱 Поверните карту правой кнопкой мыши или двумя пальцами — осмотрите дом со всех сторон</div>
      <p class="small" style="margin-top:16px">Застройщик: ${esc(p.developer)}.</p>`;
    bindGallery(p);
    bindBlockHover(p);
  }
  function bindBlockHover(p) {
    panelBody.querySelectorAll('.block-btn').forEach((btn) => {
      const b = p.blocks.find((x) => x.id === btn.dataset.go.split('/').pop());
      btn.addEventListener('mouseenter', () => engine && engine.highlight('hover', p, b, b.floors));
      btn.addEventListener('mouseleave', () => { state.hoverKey = null; engine && engine.highlight('hover', null); });
    });
  }

  function renderBlock(p, b) {
    const floors = floorsOf(p, b).reverse();
    panelBody.innerHTML = `
      <div class="crumbs">${backBtn(`#/${p.id}`)}<span>${esc(p.name)}</span> / <b>${blockName(p, b)}</b></div>
      <h1>${blockName(p, b)}</h1>
      <p class="muted" style="margin:6px 0 0">${b.floors} этажей · ${b.plan.apts.length} квартир на этаже · жилые этажи с ${p.firstResidentialFloor}-го<br>
      ${som(priceM2(p, b))} за м² · свободно <b>${blockFree(p, b)}</b> квартир</p>
      <div class="section-title"><h3>Выберите этаж</h3><span class="small">наведите — этаж подсветится в 3D</span></div>
      <div class="floors">${floors.map((f) => { const c = freeCount(p, b, f); return `<button class="floor-btn ${c ? '' : 'none'}" data-go="#/${p.id}/${b.id}/${f}" data-f="${f}"><b>${f}</b><span>${c ? c + ' своб.' : 'нет'}</span></button>`; }).join('')}</div>`;
    panelBody.querySelectorAll('.floor-btn').forEach((btn) => {
      btn.addEventListener('mouseenter', () => selectFloor3D(p, b, +btn.dataset.f));
      btn.addEventListener('mouseleave', () => selectFloor3D(null));
    });
  }

  function planHtml(p, b, f, big = false) {
    const pl = b.plan;
    const style = `aspect-ratio:${pl.w}/${pl.h};` + (big ? `width:min(100%, calc(78vh * ${pl.w / pl.h}));margin:0 auto;` : '');
    return `<div class="plan-wrap ${big ? 'big' : ''}" style="${style}">
      <img src="${pl.img}" alt="План этажа, ${blockName(p, b)}">
      <svg viewBox="0 0 ${pl.w} ${pl.h}" preserveAspectRatio="none">
        ${pl.apts.map((a) => `<polygon class="apt-poly ${status(p, b, f, a)} ${state.apt === a ? 'on' : ''}" data-n="${a.n}" points="${a.poly.map((q) => q.join(',')).join(' ')}"/>`).join('')}
      </svg></div>`;
  }
  function bindPlan(root, p, b, f, onPick) {
    root.querySelectorAll('.apt-poly').forEach((poly) => {
      const a = b.plan.apts.find((x) => x.n === +poly.dataset.n);
      const st = status(p, b, f, a);
      poly.addEventListener('mousemove', (e) => showTip(e, `<b>Кв. ${aptNumber(p, b, f, a)} · ${roomsLabel(a)}</b>${a.euro ? '<br><i>' + euroNote(a) + '</i>' : ''}<br>${area(a.area)} · ${st === 'free' ? som(aptPrice(p, b, a)) : ST_LABEL[st]}`));
      poly.addEventListener('mouseleave', hideTip);
      poly.addEventListener('click', () => { hideTip(); if (st !== 'sold') onPick(a); });
    });
  }

  function renderFloor(p, b, f) {
    const apts = b.plan.apts, inst = p.installment;
    panelBody.innerHTML = `
      <div class="crumbs">${backBtn(`#/${p.id}/${b.id}`)}<span>${esc(p.name)} / ${blockName(p, b)}</span> / <b>${f} этаж</b></div>
      <div class="apt-head"><h1>${f} этаж</h1>
        <div style="display:flex;gap:6px">
          <button class="back" data-go="#/${p.id}/${b.id}/${Math.min(b.floors, f + 1)}" aria-label="Этаж выше" ${f >= b.floors ? 'disabled' : ''}>▲</button>
          <button class="back" data-go="#/${p.id}/${b.id}/${Math.max(p.firstResidentialFloor, f - 1)}" aria-label="Этаж ниже" ${f <= p.firstResidentialFloor ? 'disabled' : ''}>▼</button>
        </div></div>
      <p class="muted" style="margin:4px 0 12px">${blockName(p, b)} · свободно ${freeCount(p, b, f)} из ${apts.length}. Нажмите на квартиру на плане.</p>
      <div class="plan-tools">
        <div class="legend"><span><i style="background:var(--free)"></i>Свободна</span><span><i style="background:var(--booked)"></i>Бронь</span><span><i style="background:var(--sold)"></i>Продана</span></div>
        <button class="link-btn" id="zoomPlan">⤢ Крупнее</button>
      </div>
      ${planHtml(p, b, f)}
      <div class="apt-list">${apts.map((a) => { const st = status(p, b, f, a), pr = aptPrice(p, b, a); return `
        <div class="apt-row ${st}" ${st !== 'sold' ? `data-go="#/${p.id}/${b.id}/${f}/${a.n}"` : ''}>
          <b>№${aptNumber(p, b, f, a)}</b>
          <div>${roomsLabel(a)}${euroTag(a)} · ${area(a.area)}<div class="small">${st === 'sold' ? '' : som(pr) + ' · ' + som(monthly(p, pr, inst.downPayment, inst.months)) + '/мес'}</div></div>
          <span class="st ${st}">${ST_LABEL[st]}</span></div>`; }).join('')}</div>
      <p class="small" style="margin-top:12px">План типового этажа. Площади — по рабочему проекту.</p>`;
    bindPlan(panelBody, p, b, f, (a) => go(`#/${p.id}/${b.id}/${f}/${a.n}`));
    $('#zoomPlan').onclick = () => openPlanModal(p, b, f);
  }
  function openPlanModal(p, b, f) {
    openModal(`<h2 style="margin-bottom:12px">${blockName(p, b)} · ${f} этаж</h2>${planHtml(p, b, f, true)}`, true);
    bindPlan($('#modalCard'), p, b, f, (a) => { closeModal(); go(`#/${p.id}/${b.id}/${f}/${a.n}`); });
  }

  function addMonths(n) { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }); }

  function renderApt(p, b, f, a) {
    const st = status(p, b, f, a);
    const price = aptPrice(p, b, a);
    const inst = p.installment;
    const minDown = Math.min(inst.downPayment, price);
    const maxDown = Math.max(minDown, Math.floor(price * 0.9 / 10000) * 10000);
    panelBody.innerHTML = `
      <div class="crumbs">${backBtn(`#/${p.id}/${b.id}/${f}`)}<span>${esc(p.name)} / ${blockName(p, b)} / ${f} эт.</span> / <b>Кв. ${aptNumber(p, b, f, a)}</b></div>
      <div class="apt-head">
        <div><h1>${roomsLabel(a)}</h1><p class="muted" style="margin:4px 0 0">${area(a.area)} · ${f} этаж из ${b.floors} · ${blockName(p, b).toLowerCase()}</p>${a.euro ? `<p class="small" style="margin:4px 0 0">💬 ${euroNote(a)}</p>` : ''}</div>
        <span class="st ${st}" style="font-size:12px;font-weight:700;padding:5px 10px;border-radius:999px;white-space:nowrap">${ST_LABEL[st]}</span>
      </div>
      <div style="margin:14px 0 4px" class="price">${som(price)}</div>
      <div class="small">${som(priceM2(p, b))} за м² · сдача ${esc(p.completion)}</div>
      <div style="margin-top:14px">${planHtml(p, b, f)}</div>
      <div class="calc">
        <h3>Рассчитать рассрочку</h3>
        <label>Первоначальный взнос <b id="cDown"></b></label>
        <input type="range" id="rDown" min="${minDown}" max="${maxDown}" step="10000" value="${minDown}">
        <label>Срок рассрочки <b id="cMonths"></b></label>
        <input type="range" id="rMonths" min="6" max="${inst.months}" step="1" value="${inst.months}">
        <div class="monthly"><div><div class="small">Ежемесячный платёж</div><div class="v" id="cMonthly"></div></div><div class="small" style="text-align:right">без процентов<br>и переплаты</div></div>
        <div class="breakdown">
          <div><span>Стоимость квартиры</span><b>${som(price)}</b></div>
          <div><span>Первый взнос</span><b id="bDown"></b></div>
          <div><span>Остаток в рассрочку</span><b id="bRest"></b></div>
          <div><span>Последний платёж</span><b id="bEnd"></b></div>
        </div>
      </div>
      <button class="cta" id="leadBtn" ${st === 'sold' ? 'disabled' : ''}>${st === 'booked' ? 'Встать в очередь на квартиру' : 'Забронировать квартиру'}</button>
      <button class="cta ghost" data-go="#/${p.id}/${b.id}/${f}">Другие квартиры на этаже</button>
      <p class="small" style="margin-top:12px">Расчёт предварительный. Точные условия подтвердит менеджер.</p>`;
    bindPlan(panelBody, p, b, f, (x) => go(`#/${p.id}/${b.id}/${f}/${x.n}`));
    const rDown = $('#rDown'), rMonths = $('#rMonths');
    const upd = () => {
      const d = +rDown.value, m = +rMonths.value;
      $('#cDown').textContent = som(d);
      $('#cMonths').textContent = monthsLabel(m);
      $('#cMonthly').textContent = som(monthly(p, price, d, m));
      $('#bDown').textContent = som(d);
      $('#bRest').textContent = som(Math.max(0, price - d));
      $('#bEnd').textContent = addMonths(m);
    };
    rDown.oninput = upd; rMonths.oninput = upd; upd();
    $('#leadBtn').onclick = () => openLead(p, b, f, a, +rDown.value, +rMonths.value);
  }

  /* ---------- Заявка ---------- */
  function openLead(p, b, f, a, down, months) {
    const num = aptNumber(p, b, f, a);
    openModal(`
      <h2>Заявка на квартиру</h2>
      <p class="muted" style="margin:6px 0 4px">ЖК ${esc(p.name)}, ${blockName(p, b).toLowerCase()}, ${f} этаж, кв. ${num} — ${roomsShort(a)}, ${area(a.area)}.<br>Взнос ${som(down)}, рассрочка ${months} мес.</p>
      <form id="leadForm">
        <label class="field"><span>Ваше имя</span><input name="name" required autocomplete="name"></label>
        <label class="field"><span>Телефон или WhatsApp</span><input name="phone" required type="tel" inputmode="tel" placeholder="+996 ___ ___ ___" autocomplete="tel"></label>
        <button class="cta" type="submit">Отправить заявку</button>
      </form>`);
    $('#leadForm').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const lead = { project: p.name, block: b.id, floor: f, apt: num, area: a.area, down, months, name: fd.get('name'), phone: fd.get('phone'), at: new Date().toISOString() };
      try { const arr = JSON.parse(localStorage.getItem('yurta_leads') || '[]'); arr.push(lead); localStorage.setItem('yurta_leads', JSON.stringify(arr)); } catch (err) {}
      if (CFG.whatsapp) {
        const text = `Здравствуйте! Заявка с сайта «Объекты»:\nЖК ${p.name}, блок ${b.id}, ${f} этаж, кв. ${num} (${area(a.area)})\nВзнос ${som(down)}, рассрочка ${months} мес.\nИмя: ${lead.name}\nТелефон: ${lead.phone}`;
        window.open(`https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      }
      $('#modalCard').innerHTML = `<button class="modal-close" data-close>✕</button><h2>Спасибо, ${esc(lead.name)}!</h2><p class="muted" style="margin-top:8px">Менеджер свяжется с вами в ближайшее время и подтвердит бронь квартиры № ${num}.</p><button class="cta" data-close>Хорошо</button>`;
    };
  }

  /* ---------- Модальное окно ---------- */
  const modal = $('#modal'), modalCard = $('#modalCard');
  function openModal(html, wide = false) {
    modalCard.className = 'modal-card' + (wide ? ' wide' : '');
    modalCard.innerHTML = `<button class="modal-close" data-close aria-label="Закрыть">✕</button>${html}`;
    modal.hidden = false;
  }
  function closeModal() { modal.hidden = true; modalCard.innerHTML = ''; hideTip(); }
  modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  /* ---------- Мобильная шторка ---------- */
  function setSheet(cls) { panel.classList.remove('collapsed', 'expanded'); if (cls) panel.classList.add(cls); }
  $('#panelGrip').addEventListener('click', () => {
    if (panel.classList.contains('collapsed')) setSheet('');
    else if (panel.classList.contains('expanded')) setSheet('collapsed');
    else setSheet('expanded');
  });
  map.on('dragstart', () => { if (isMobile()) setSheet('collapsed'); });

  setTimeout(() => { if (!panelBody.innerHTML) route(); }, 4000);
})();
