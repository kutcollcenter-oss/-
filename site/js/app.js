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
    engine = window.Yurta3D.init(map, PROJECTS, { floorBase, isWindow: facadeHasWindow });
    hideOsmBuildings();
    map.on('sourcedata', (e) => { if (e.sourceId === 'openmaptiles' && e.isSourceLoaded) hideOsmBuildings(); });
    addMarkers();
    setupInteractions();
    route();
    renderCmpBar();
    updateMatches();
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
      showTip(e.originalEvent, `<b>${esc(hit.label || 'Коммерческие помещения')}</b><br>${esc(p.name)}${hit.block ? ' · ' + blockName(p, hit.block) : ''}`);
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
    // вытянутость плана считаем по самим квартирам, а не по размеру картинки (у картинок есть поля)
    const all = b.plan.apts.flatMap((x) => x.poly), pw = Math.max(...all.map((q) => q[0])) - Math.min(...all.map((q) => q[0])), ph = Math.max(...all.map((q) => q[1])) - Math.min(...all.map((q) => q[1]));
    const widePlan = pw > ph * 1.3;
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
  // Точки, которые должны быть видны с камеры: квартира, этаж или весь блок
  function focusTargets(p, b, f, a) {
    const top = floorBase(p, b.floors + 1);
    if (a) {
      const lp = aptLocalPoly(p, b, a), z = floorBase(p, f) + p.floorHeight / 2;
      return [[...centroid(lp), z], ...lp.map((q) => [q[0], q[1], z])];
    }
    const zs = f ? [floorBase(p, f) + p.floorHeight / 2] : [top * 0.25, top * 0.6, top * 0.95];
    const pts = [centroid(b.fp), ...b.fp];
    return zs.flatMap((z) => pts.map((q) => [q[0], q[1], z]));
  }
  // Есть ли окна на этом месте фасада: сторона не глухая по плану и за стеной — квартира
  const SIDE = { top: 0, right: 90, bottom: 180, left: 270 };
  const angDiff = (x, y) => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };
  function facadeHasWindow(p, b, c, n) {
    const az = azim(n[0], n[1]);
    for (const sd of b.plan.blank || []) if (angDiff(az, (planUp(p, b) + SIDE[sd]) % 360) < 35) return false;
    if (!b._lp) b._lp = b.plan.apts.map((x) => aptLocalPoly(p, b, x));
    return [0.8, 1.8, 3.0].some((d) => { const q = [c[0] - n[0] * d, c[1] - n[1] * d]; return b._lp.some((pl) => pointInPoly(q, pl)); });
  }
  function distToPoly(pt, poly) {
    if (pointInPoly(pt, poly)) return 0;
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, t = Math.max(0, Math.min(1, ((pt[0] - ax) * (bx - ax) + (pt[1] - ay) * (by - ay)) / L2));
      best = Math.min(best, Math.hypot(pt[0] - ax - t * (bx - ax), pt[1] - ay - t * (by - ay)));
    }
    return best;
  }
  // Камера на квартиру — со стороны, где у неё окна
  function aptFacing(p, b, a) {
    const lp = aptLocalPoly(p, b, a), pcs = engine && engine.facade(p, b);
    let vx = 0, vy = 0;
    for (const pc of pcs || []) if (pc.win && distToPoly(pc.c, lp) < 1.8) { vx += pc.n[0] * pc.len; vy += pc.n[1] * pc.len; }
    if (Math.hypot(vx, vy) > 0.5) return azim(vx, vy);
    const c = centroid(lp), bc = centroid(b.fp);
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
  function flyDistrict(id) {
    if (id === 'all') return flyCity();
    const list = PROJECTS.filter((p) => p.district === id), d = CFG.districts.find((x) => x.id === id) || {};
    if (!list.length) return map.flyTo({ center: d.center || CFG.city.center, zoom: 13, pitch: 45, bearing: -12, duration: 1600, padding: camPad() });
    const b = new maplibregl.LngLatBounds();
    list.forEach((p) => b.extend(p.marker));
    if (d.center) b.extend(d.center);
    const pad = camPad();
    map.fitBounds(b, { padding: { top: pad.top + 90, bottom: pad.bottom + 90, left: pad.left + 90, right: pad.right + 90 }, maxZoom: 15, pitch: 50, bearing: -12, duration: 1800 });
  }
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
    if (viewMode && (!state.apt || viewMode.a !== state.apt)) closeWindowView(false);
    if (!state.apt) sunOff();
    selectFloor3D(state.project, state.block, state.floor);
    if (engine) engine.focusBlock(state.block ? p : null, b, state.block ? focusTargets(p, b, state.floor, state.apt) : []); // прозрачные — только те блоки, что закрывают вид
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
  // Хлебные крошки: каждая часть — ссылка на свой уровень
  const crumbs = (back, parts) => `<nav class="crumbs" aria-label="Навигация">${backBtn(back)}${parts.map(([t, h], i) => (i ? '<span class="sep">/</span>' : '') + (h ? `<a href="${h}" data-go="${h}">${esc(t)}</a>` : `<b>${esc(t)}</b>`)).join('')}</nav>`;
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

  /* Математика подбора.
     Квартира подходит, если взнос D ≥ минимального взноса ЖК и (цена − D) / срок ≤ платёж M.
     Значит минимальный платёж при взносе D = min по свободным квартирам ( max(0, цена − D) / срок ).
     Кнопки показываем только для сумм, при которых есть хотя бы одна квартира. */
  function freePrices(p) {
    if (p._fp) return p._fp;
    const out = [];
    for (const b of p.blocks) for (const a of b.plan.apts) {
      if (floorsOf(p, b).some((f) => status(p, b, f, a) === 'free')) out.push(aptPrice(p, b, a));
    }
    return (p._fp = out.sort((x, y) => x - y));
  }
  const minDownAll = () => Math.min(...visibleProjects().map((p) => p.installment.downPayment));
  function monthlyRange(D) {
    let lo = Infinity, hi = 0;
    for (const p of visibleProjects()) {
      if (D < p.installment.downPayment) continue;
      const pr = freePrices(p); if (!pr.length) continue;
      const m = (x) => Math.max(0, x - D) / p.installment.months;
      lo = Math.min(lo, m(pr[0])); hi = Math.max(hi, m(pr[pr.length - 1]));
    }
    return lo === Infinity ? null : [lo, hi];
  }
  const roundUp = (v, step) => Math.ceil(v / step) * step;
  const niceStep = (v) => (v < 50000 ? 5000 : v < 200000 ? 10000 : 50000);
  function downOptions() {
    const lo = roundUp(minDownAll(), 10000);
    return [...new Set([lo, ...DOWN_PRESETS.filter((v) => v > lo * 1.15)])].slice(0, 6);
  }
  // 5 ровных сумм: от «минимально нужного» до «хватает на самую дорогую»
  function monthlyOptions(D) {
    const r = monthlyRange(D); if (!r) return [];
    const [lo, hi] = r, start = Math.max(1000, roundUp(lo, 1000));
    if (hi <= start) return [start];
    const out = [start];
    for (let i = 1; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; out.push(roundUp(v, niceStep(v))); }
    return out.filter((v, i, a) => i === 0 || v > a[i - 1]);
  }

  function budgetHtml() {
    const B = state.budget;
    const chips = (vals, cur, attr) => vals.map((v) => `<button class="bchip ${cur === v ? 'on' : ''}" data-${attr}="${v}">до ${short(v)}</button>`).join('');
    const custom = (attr, ph) => `<form class="bcustom" data-for="${attr}"><input inputmode="numeric" placeholder="${ph}" aria-label="${ph}"><button>OK</button></form>`;
    let h = `<div class="budget"><div class="b-head"><b>Подобрать квартиру по бюджету</b>${B.down ? '<button class="link-btn" id="bReset">Сбросить</button>' : ''}</div>`;
    if (!B.down) {
      h += `<div class="b-q"><span class="b-n">1</span>Сколько можете внести сразу — первоначальный взнос?</div>
        <div class="bchips">${chips(downOptions(), null, 'down')}</div>${custom('down', `Своя сумма, от ${short(minDownAll())}`)}<div class="small" style="margin-top:6px">Минимальный взнос сейчас — ${som(minDownAll())}</div>`;
    } else {
      h += `<button class="b-done" data-edit="down"><span class="b-n ok">✓</span>Взнос: <b>до ${som(B.down)}</b><span>изменить</span></button>`;
      if (!B.monthly) {
        h += `<div class="b-q"><span class="b-n">2</span>Сколько готовы платить в месяц?</div>
          ${(() => { const o = monthlyOptions(B.down); return o.length ? `<div class="bchips">${chips(o, null, 'monthly')}</div>${custom('monthly', `Своя сумма, от ${short(o[0])}`)}<div class="small" style="margin-top:6px">При таком взносе платёж — от ${som(o[0])} в месяц</div>` : `<div class="small">С таким взносом пока нет вариантов. Минимальный взнос — ${som(minDownAll())}.</div>`; })()}`;
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
      ? `<div class="b-sum">Подходит <b>${total.toLocaleString('ru-RU')}</b> ${plural(total, 'квартира', 'квартиры', 'квартир')} в ${good.length} ЖК</div><div class="glow-note"><i></i>На 3D-домах эти квартиры светятся зелёным — откройте ЖК</div>`
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
    if (budgetDone() && !list.some((p) => budgetMatch(p, state.budget.down, state.budget.monthly).ok)) {
      if (!monthlyOptions(state.budget.down).length) state.budget.down = null;
      state.budget.monthly = null; saveBudget();
    }
    panelBody.innerHTML = `
      <h1 class="h-home">Квартиры в рассрочку на карте Бишкека</h1>
      ${budgetHtml()}
      <div class="chips">${CFG.districts.map((d) => { const n = d.id === 'all' ? PROJECTS.length : PROJECTS.filter((p) => p.district === d.id).length; return `<button class="chip ${d.id === state.district ? 'active' : ''} ${n ? '' : 'zero'}" data-d="${d.id}">${d.name}<span class="cnt">${n}</span></button>`; }).join('')}</div>
      ${!list.length ? `<div class="empty">В этом районе пока нет объектов.<br>Скоро добавим.</div>` : budgetDone() ? resultsHtml(list) : list.map(cardHtml).join('')}`;
    panelBody.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { state.district = c.dataset.d; renderList(); addMarkers(); updateMatches(); flyDistrict(state.district); }));
    const set = (k, v) => { state.budget[k] = v; if (k === 'down') state.budget.monthly = null; saveBudget(); renderList(); addMarkers(); updateMatches(); };
    panelBody.querySelectorAll('[data-down]').forEach((b) => b.onclick = () => set('down', +b.dataset.down));
    panelBody.querySelectorAll('[data-monthly]').forEach((b) => b.onclick = () => set('monthly', +b.dataset.monthly));
    panelBody.querySelectorAll('.bcustom').forEach((f) => {
      const inp = f.querySelector('input');
      inp.addEventListener('input', () => { const d = inp.value.replace(/\D/g, ''); inp.value = d ? (+d).toLocaleString('ru-RU') : ''; });
      f.onsubmit = (e) => {
        e.preventDefault(); const v = +inp.value.replace(/\D/g, ''); if (!(v > 0)) return;
        const min = f.dataset.for === 'down' ? minDownAll() : (monthlyOptions(state.budget.down)[0] || 0);
        if (v < min) { inp.value = ''; inp.placeholder = `Минимум ${short(min)} — дешевле вариантов нет`; inp.focus(); return; }
        set(f.dataset.for, v);
      };
    });
    panelBody.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
      if (b.dataset.edit === 'down') state.budget = { down: null, monthly: null }; else state.budget.monthly = null;
      saveBudget(); renderList(); addMarkers(); updateMatches();
    });
    const r = $('#bReset'); if (r) r.onclick = () => { state.budget = { down: null, monthly: null }; saveBudget(); renderList(); addMarkers(); updateMatches(); };
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
      ${crumbs('#/', [['Все объекты', '#/'], [p.name]])}
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
      ${budgetDone() ? '<div class="glow-note"><i></i>Зелёным на доме — квартиры по вашему бюджету</div>' : ''}
      ${progressHtml()}
      <div class="section-title"><h3>Выберите блок</h3><span class="small">или нажмите на этаж в 3D</span></div>
      <div class="blocks">${p.blocks.map((b) => `<button class="block-btn" data-go="#/${p.id}/${b.id}"><b>${b.id}</b><span>${b.floors} эт. · ${blockFree(p, b)} своб.</span></button>`).join('')}</div>
      <div class="hint">🖱 Поверните карту правой кнопкой мыши или двумя пальцами — осмотрите дом со всех сторон</div>
      <p class="small" style="margin-top:16px">Застройщик: ${esc(p.developer)}.</p>`;
    bindGallery(p);
    bindBlockHover(p);
    bindProgress(p);
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
      ${crumbs(`#/${p.id}`, [['Все объекты', '#/'], [p.name, `#/${p.id}`], [blockName(p, b)]])}
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
      ${crumbs(`#/${p.id}/${b.id}`, [[p.name, `#/${p.id}`], [blockName(p, b), `#/${p.id}/${b.id}`], [`${f} этаж`]])}
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
          <span class="st ${st}">${ST_LABEL[st]}</span>${st !== 'sold' ? favHtml(favKey(p, b, f, a)) : ''}</div>`; }).join('')}</div>
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
      ${crumbs(`#/${p.id}/${b.id}/${f}`, [[p.name, `#/${p.id}`], [blockName(p, b), `#/${p.id}/${b.id}`], [`${f} эт.`, `#/${p.id}/${b.id}/${f}`], [`Кв. ${aptNumber(p, b, f, a)}`]])}
      <div class="apt-head">
        <div><h1>${roomsLabel(a)}</h1><p class="muted" style="margin:4px 0 0">${area(a.area)} · ${f} этаж из ${b.floors} · ${blockName(p, b).toLowerCase()}</p>${a.euro ? `<p class="small" style="margin:4px 0 0">💬 ${euroNote(a)}</p>` : ''}</div>
        <div style="display:flex;gap:6px;align-items:center"><span class="st ${st}" style="font-size:12px;font-weight:700;padding:5px 10px;border-radius:999px;white-space:nowrap">${ST_LABEL[st]}</span>${favHtml(favKey(p, b, f, a), true)}</div>
      </div>
      <div style="margin:14px 0 4px" class="price">${som(price)}</div>
      <div class="small">${som(priceM2(p, b))} за м² · сдача ${esc(p.completion)}</div>
      <div style="margin-top:14px">${planHtml(p, b, f)}</div>
      <div class="apt-tools"><button class="tool" id="winView">👁 Вид из окна</button><button class="tool" id="offerBtn">📄 Расчёт в WhatsApp / PDF</button></div>
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
      ${sunHtml()}
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
    $('#winView').onclick = () => { loadMedia(p.id).then(() => openWindowView(p, b, f, a)); };
    $('#offerBtn').onclick = () => shareOffer(p, b, f, a, +rDown.value, +rMonths.value);
    bindSun(p, b, f, a);
  }

  /* =====================================================================
     Новые функции: солнце, вид из окна, подсветка по бюджету, избранное и сравнение,
     ход стройки, расчёт-ссылка для WhatsApp
     ===================================================================== */

  /* ---------- Солнце: положение по дате и времени (упрощённые формулы NOAA, точность ~1°) ---------- */
  const TZ = 6; // Бишкек, UTC+6
  function sunPos(date, lat, lon) {
    const rad = Math.PI / 180;
    const d = date.getTime() / 864e5 + 2440587.5 - 2451545.0;  // дни от J2000
    const g = (357.529 + 0.98560028 * d) * rad;                // средняя аномалия
    const q = 280.459 + 0.98564736 * d;                        // средняя долгота
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
    const e = (23.439 - 0.00000036 * d) * rad;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    const H = (gmst * 15 + lon) * rad - ra;                    // часовой угол
    const phi = lat * rad;
    const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
    return { az: (az / rad + 360) % 360, alt: alt / rad };
  }
  const localDate = (ymd, hours) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 0, 0) + (hours - TZ) * 3600e3); };
  const hhmm = (h) => { const mm = Math.round(h * 60); return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; };
  const SUN_DAYS = () => { const y = new Date().getFullYear(); return [
    { id: 'summer', name: 'Лето', ymd: `${y}-06-21` }, { id: 'spring', name: 'Весна/осень', ymd: `${y}-03-21` },
    { id: 'winter', name: 'Зима', ymd: `${y}-12-21` }, { id: 'today', name: 'Сегодня', ymd: new Date(Date.now() + TZ * 3600e3).toISOString().slice(0, 10) }]; };
  // Куски фасада с окнами квартиры (метры участка)
  function aptWindows(p, b, a) {
    const key = `${b.id}|${a.n}`; p._aw = p._aw || {};
    if (p._aw[key]) return p._aw[key];
    const pcs = engine && engine.facade(p, b); if (!pcs) return [];
    const lp = aptLocalPoly(p, b, a);
    return (p._aw[key] = pcs.filter((pc) => pc.win && distToPoly(pc.c, lp) < 1.8));
  }
  // Часы, когда солнце попадает в окна квартиры (с учётом домов этого ЖК), шаг 15 минут
  function sunHours(p, b, f, a, ymd) {
    const wins = aptWindows(p, b, a); if (!wins.length) return { slots: [], total: 0 };
    const z = floorBase(p, f) + 1.5, ll = toLngLat(p, centroid(b.fp)), slots = [];
    for (let t = 4; t < 22; t += 0.25) {
      const s = sunPos(localDate(ymd, t), ll[1], ll[0]);
      if (s.alt < 2) { slots.push(false); continue; }
      const azL = s.az + (p.rotation || 0), A = azL * Math.PI / 180; // азимут в системе участка
      const sd = [Math.sin(A), Math.cos(A)];
      slots.push(wins.some((w) => w.n[0] * sd[0] + w.n[1] * sd[1] > 0.17 && !engine.sunBlocked(p, [w.c[0], w.c[1], z], azL, s.alt)));
    }
    return { slots, total: slots.filter(Boolean).length / 4 };
  }
  function sunRanges(slots) {
    const out = []; let st = null;
    slots.forEach((v, i) => { const t = 4 + i * 0.25; if (v && st == null) st = t; if (!v && st != null) { out.push([st, t]); st = null; } });
    if (st != null) out.push([st, 22]);
    return out;
  }
  const sunState = { day: 'spring', hour: 13, on: false };
  function applySun(p) {
    const d = SUN_DAYS().find((x) => x.id === sunState.day), ll = toLngLat(p, centroid(p.plot));
    const s = sunPos(localDate(d.ymd, sunState.hour), ll[1], ll[0]);
    if (engine) engine.setSun(true, s.az, s.alt);
    sunState.on = true;
    return s;
  }
  function sunOff() { if (sunState.on && engine) { engine.setSun(false); sunState.on = false; } }
  function sunHtml() {
    return `<div class="sunbox" id="sunBox"><div class="sun-head"><h3>☀ Солнце в квартире</h3><span class="small">дома этого ЖК учтены</span></div>
      <div class="sun-days">${SUN_DAYS().map((d) => `<button class="bchip ${d.id === sunState.day ? 'on' : ''}" data-sday="${d.id}">${d.name}</button>`).join('')}</div>
      <div class="sun-bar" id="sunBar"></div><div class="sun-ticks"><span>4:00</span><span>10:00</span><span>16:00</span><span>22:00</span></div>
      <div class="sun-sum" id="sunSum">Считаю…</div>
      <label class="sun-time">Время на 3D: <b id="sunT"></b></label><input type="range" id="sunH" min="5" max="21" step="0.25" value="${sunState.hour}">
      <div class="small">Двигайте ползунок — на модели дома двигаются тени.</div></div>`;
  }
  function bindSun(p, b, f, a) {
    const box = $('#sunBox'); if (!box) return;
    const draw = () => {
      if (!$('#sunBox')) return;
      const d = SUN_DAYS().find((x) => x.id === sunState.day);
      if (!engine || !engine.facade(p, b)) { setTimeout(draw, 400); return; }
      const r = sunHours(p, b, f, a, d.ymd), rg = sunRanges(r.slots);
      $('#sunBar').innerHTML = rg.map(([s, e]) => `<i style="left:${(s - 4) / 18 * 100}%;width:${(e - s) / 18 * 100}%"></i>`).join('') + `<u id="sunNow" style="left:${(sunState.hour - 4) / 18 * 100}%"></u>`;
      $('#sunSum').innerHTML = r.total
        ? `Солнце в окнах: <b>${rg.map(([s, e]) => `${hhmm(s)}–${hhmm(e)}`).join(', ')}</b> · всего ${String(r.total).replace('.', ',')} ч (${d.name.toLowerCase()})`
        : `Прямого солнца в окнах нет (${d.name.toLowerCase()}): окна на север или их закрывают соседние блоки`;
    };
    const moveSun = () => {
      const s = applySun(p);
      $('#sunT').textContent = `${hhmm(sunState.hour)} · ${s.alt > 0 ? 'солнце на высоте ' + Math.round(s.alt) + '°' : 'солнце за горизонтом'}`;
      const n = $('#sunNow'); if (n) n.style.left = `${(sunState.hour - 4) / 18 * 100}%`;
    };
    box.querySelectorAll('[data-sday]').forEach((btn) => btn.onclick = () => { sunState.day = btn.dataset.sday; box.querySelectorAll('[data-sday]').forEach((x) => x.classList.toggle('on', x === btn)); draw(); moveSun(); });
    $('#sunH').oninput = (e) => { sunState.hour = +e.target.value; moveSun(); };
    draw(); moveSun();
  }

  /* ---------- Вид из окна: камера на высоте этажа смотрит наружу ---------- */
  const SIDES = { N: 'север', E: 'восток', S: 'юг', W: 'запад' };
  const sideOf = (az) => ['N', 'E', 'S', 'W'][Math.round((((az % 360) + 360) % 360) / 90) % 4];
  let viewMode = null;
  function openWindowView(p, b, f, a) {
    const wins = aptWindows(p, b, a);
    if (!wins.length) { openModal('<h2>Вид из окна</h2><p class="muted">Не удалось определить окна этой квартиры.</p>'); return; }
    let vx = 0, vy = 0, cx = 0, cy = 0, L = 0;
    for (const w of wins) { vx += w.n[0] * w.len; vy += w.n[1] * w.len; cx += w.c[0] * w.len; cy += w.c[1] * w.len; L += w.len; }
    const nl = Math.hypot(vx, vy) || 1, n = [vx / nl, vy / nl], c = [cx / L, cy / L];
    const from = [c[0] + n[0] * 2.5, c[1] + n[1] * 2.5], to = [c[0] + n[0] * 400, c[1] + n[1] * 400];
    const alt = floorBase(p, f) + 1.6, az = (azim(n[0], n[1]) - (p.rotation || 0) + 360) % 360;
    viewMode = { p, b, f, a };
    map.setMaxPitch(85);
    if (map.calculateCameraOptionsFromTo) {
      const cam = map.calculateCameraOptionsFromTo(maplibregl.LngLat.convert(toLngLat(p, from)), alt, maplibregl.LngLat.convert(toLngLat(p, to)), Math.max(0, alt - 30));
      map.flyTo({ ...cam, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 1800, essential: true });
    } else {
      map.flyTo({ center: toLngLat(p, [c[0] + n[0] * 60, c[1] + n[1] * 60]), zoom: 19, pitch: 84, bearing: az, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 1800 });
    }
    document.body.classList.add('window-view');
    const photos = ((mediaCache[p.id] || {}).media || []).filter((m) => m.type === 'view' && (!m.block || m.block === b.id) && (!m.floorFrom || f >= m.floorFrom) && (!m.floorTo || f <= m.floorTo) && (!m.side || m.side === sideOf(az)));
    let bar = $('#winBar'); if (!bar) { bar = document.createElement('div'); bar.id = 'winBar'; document.body.append(bar); }
    bar.innerHTML = `<div class="wb-title"><b>👁 Вид из окна</b><span>${esc(p.name)} · блок ${b.id} · ${f} этаж · кв. ${aptNumber(p, b, f, a)} · окна на ${SIDES[sideOf(az)]}</span></div>
      <div class="wb-btns"><button data-wv="up" ${f >= b.floors ? 'disabled' : ''}>▲ этаж выше</button><button data-wv="down" ${f <= p.firstResidentialFloor ? 'disabled' : ''}>▼ ниже</button>
      ${photos.length ? `<button data-wv="photo" class="hl">📷 Фото с дрона (${photos.length})</button>` : ''}<button data-wv="exit" class="x">✕ Выйти</button></div>
      <p>Соседние дома на карте — по данным OpenStreetMap, высоты примерные.${photos.length ? '' : ' Настоящее фото с этой высоты появится, когда его загрузит менеджер.'}</p>`;
    bar.querySelectorAll('[data-wv]').forEach((btn) => btn.onclick = () => {
      const k = btn.dataset.wv;
      if (k === 'exit') return closeWindowView(true);
      if (k === 'photo') return openModal(photos.map((m) => `<figure class="wv-photo"><img src="${m.url}" alt=""><figcaption>${esc(m.caption || 'Вид из окна')} · ${esc(m.date)}</figcaption></figure>`).join(''), true);
      const nf = f + (k === 'up' ? 1 : -1);
      viewMode = null;
      go(`#/${p.id}/${b.id}/${nf}/${a.n}`);
      setTimeout(() => openWindowView(p, b, nf, a), 60);
    });
  }
  function closeWindowView(fly) {
    if (!viewMode) return;
    const { p, b, a } = viewMode; viewMode = null;
    document.body.classList.remove('window-view');
    const bar = $('#winBar'); if (bar) bar.remove();
    if (fly && state.apt) flyApt(p, b, a);
    setTimeout(() => { if (!viewMode) map.setMaxPitch(75); }, 1700);
  }

  /* ---------- Подсветка на 3D квартир, подходящих по бюджету ---------- */
  function updateMatches(tries = 0) {
    if (!engine) return;
    for (const p of PROJECTS) {
      let quads = null;
      if (budgetDone() && visibleProjects().includes(p) && state.budget.down >= p.installment.downPayment) {
        const maxPrice = state.budget.down + state.budget.monthly * p.installment.months;
        quads = [];
        for (const b of p.blocks) {
          if (!engine.facade(p, b)) { if (tries < 20) setTimeout(() => updateMatches(tries + 1), 500); return; }
          for (const a of b.plan.apts) {
            if (aptPrice(p, b, a) > maxPrice) continue;
            const wins = aptWindows(p, b, a);
            for (const f of floorsOf(p, b)) {
              if (status(p, b, f, a) !== 'free') continue;
              const z0 = floorBase(p, f) + 0.25, z1 = floorBase(p, f) + p.floorHeight - 0.35;
              for (const w of wins) {
                const d = [-w.n[1], w.n[0]], h = w.len / 2 - 0.15;
                quads.push({ a: [w.c[0] - d[0] * h, w.c[1] - d[1] * h], b: [w.c[0] + d[0] * h, w.c[1] + d[1] * h], n: w.n, z0, z1 });
              }
            }
          }
        }
      }
      engine.setMatches(p, quads);
    }
  }

  /* ---------- Избранное и сравнение ---------- */
  let favs = [];
  try { favs = JSON.parse(localStorage.getItem('yurta_favs') || '[]').filter((k) => typeof k === 'string'); } catch (e) {}
  const favKey = (p, b, f, a) => `${p.id}/${b.id}/${f}/${a.n}`;
  const isFav = (k) => favs.includes(k);
  function toggleFav(k) {
    favs = isFav(k) ? favs.filter((x) => x !== k) : [...favs, k].slice(-8);
    try { localStorage.setItem('yurta_favs', JSON.stringify(favs)); } catch (e) {}
    document.querySelectorAll(`[data-fav="${k}"]`).forEach((el) => el.classList.toggle('on', isFav(k)));
    renderCmpBar();
  }
  const favHtml = (k, big) => `<button class="fav ${big ? 'big' : ''} ${isFav(k) ? 'on' : ''}" data-fav="${k}" title="В избранное" aria-label="В избранное">♥</button>`;
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-fav]'); if (t) { e.stopPropagation(); e.preventDefault(); toggleFav(t.dataset.fav); } }, true);
  function resolveFav(k) {
    const [pid, bid, f, n] = k.split('/'), p = PROJECTS.find((x) => x.id === pid), b = p && p.blocks.find((x) => x.id === bid), a = b && b.plan.apts.find((x) => x.n === +n);
    return a ? { k, p, b, f: +f, a } : null;
  }
  const cmpBar = document.createElement('button'); cmpBar.id = 'cmpBar'; cmpBar.hidden = true; document.body.append(cmpBar);
  cmpBar.onclick = () => openCompare();
  function renderCmpBar() {
    const n = favs.map(resolveFav).filter(Boolean).length;
    cmpBar.hidden = !n;
    cmpBar.innerHTML = `<span>♥</span> Избранное: <b>${n}</b> · ${n > 1 ? 'Сравнить' : 'Открыть'}`;
  }
  function miniPlan(p, b, a) {
    const pl = b.plan;
    return `<div class="mini-plan" style="aspect-ratio:${pl.w}/${pl.h}"><img src="${pl.img}" alt=""><svg viewBox="0 0 ${pl.w} ${pl.h}" preserveAspectRatio="none"><polygon points="${a.poly.map((q) => q.join(',')).join(' ')}"/></svg></div>`;
  }
  function openCompare() {
    const items = favs.map(resolveFav).filter(Boolean).slice(-4);
    if (!items.length) return;
    const spring = SUN_DAYS()[1].ymd;
    const rows = items.map((x) => {
      const price = aptPrice(x.p, x.b, x.a), inst = x.p.installment, st = status(x.p, x.b, x.f, x.a);
      const sun = engine && engine.facade(x.p, x.b) ? sunHours(x.p, x.b, x.f, x.a, spring).total : null;
      return { ...x, price, st, m2: priceM2(x.p, x.b), mon: monthly(x.p, price, inst.downPayment, inst.months), sun };
    });
    const many = rows.length > 1;
    const best = (vals, dir) => { const v = vals.filter((z) => z != null); return many && v.length ? (dir < 0 ? Math.min(...v) : Math.max(...v)) : null; };
    const bPrice = best(rows.map((r) => r.price), -1), bMon = best(rows.map((r) => r.mon), -1), bArea = best(rows.map((r) => r.a.area), 1), bSun = best(rows.map((r) => r.sun), 1);
    const cell = (v, ok) => `<td class="${ok ? 'best' : ''}">${v}</td>`;
    openModal(`<h2>${many ? 'Сравнение квартир' : 'Избранное'}</h2><p class="small" style="margin:4px 0 12px">${many ? 'Зелёным — лучшее значение. ' : ''}Платёж — при минимальном взносе и максимальном сроке. Солнце — весной/осенью.</p>
      <div class="cmp-wrap"><table class="cmp"><tbody>
        <tr><th></th>${rows.map((r) => `<td>${miniPlan(r.p, r.b, r.a)}</td>`).join('')}</tr>
        <tr><th>ЖК</th>${rows.map((r) => `<td><b>${esc(r.p.name)}</b><div class="small">${districtName(r.p.district)} р-н</div></td>`).join('')}</tr>
        <tr><th>Квартира</th>${rows.map((r) => `<td>Блок ${r.b.id} · ${r.f} эт. · кв. ${aptNumber(r.p, r.b, r.f, r.a)}</td>`).join('')}</tr>
        <tr><th>Комнат</th>${rows.map((r) => `<td>${roomsLabel(r.a)}${euroTag(r.a)}</td>`).join('')}</tr>
        <tr><th>Площадь</th>${rows.map((r) => cell(area(r.a.area), r.a.area === bArea)).join('')}</tr>
        <tr><th>Цена</th>${rows.map((r) => cell(som(r.price), r.price === bPrice)).join('')}</tr>
        <tr><th>За м²</th>${rows.map((r) => `<td>${som(r.m2)}</td>`).join('')}</tr>
        <tr><th>Взнос от</th>${rows.map((r) => `<td>${som(r.p.installment.downPayment)}</td>`).join('')}</tr>
        <tr><th>Платёж в месяц</th>${rows.map((r) => cell(`<b>${som(r.mon)}</b><div class="small">${r.p.installment.months} мес.</div>`, r.mon === bMon)).join('')}</tr>
        <tr><th>Солнце в окнах</th>${rows.map((r) => cell(r.sun == null ? '—' : `${String(r.sun).replace('.', ',')} ч в день`, r.sun != null && r.sun === bSun)).join('')}</tr>
        <tr><th>Сдача</th>${rows.map((r) => `<td>${esc(r.p.completion)}</td>`).join('')}</tr>
        <tr><th>Статус</th>${rows.map((r) => `<td><span class="st ${r.st}">${ST_LABEL[r.st]}</span></td>`).join('')}</tr>
        <tr><th></th>${rows.map((r) => `<td><button class="cta" style="margin:0;padding:10px" data-open="#/${r.k}">Открыть</button><button class="link-btn" data-unfav="${r.k}" style="margin-top:6px">Убрать</button></td>`).join('')}</tr>
      </tbody></table></div>${favs.length > 4 ? '<p class="small">Показаны 4 последние квартиры из избранного.</p>' : ''}`, true);
    modalCard.querySelectorAll('[data-open]').forEach((el) => el.onclick = () => { closeModal(); go(el.dataset.open); });
    modalCard.querySelectorAll('[data-unfav]').forEach((el) => el.onclick = () => { toggleFav(el.dataset.unfav); if (favs.length) openCompare(); else closeModal(); });
  }

  /* ---------- Ход строительства ---------- */
  const mediaCache = {};
  async function loadMedia(pid, force) {
    if (mediaCache[pid] && !force) return mediaCache[pid];
    try { const r = await fetch('/api/media?pid=' + encodeURIComponent(pid)); mediaCache[pid] = await r.json(); } catch (e) { mediaCache[pid] = { media: [], progress: null }; }
    return mediaCache[pid];
  }
  const STAGES = ['Котлован', 'Фундамент', 'Каркас', 'Стены и кровля', 'Фасад и окна', 'Отделка и благоустройство', 'Сдача'];
  const progressHtml = () => `<div class="progress-box"><div class="section-title" style="margin-top:0"><h3>🏗 Ход строительства</h3><span class="small" id="progUpd"></span></div><div id="progBody" class="small">Загрузка…</div></div>`;
  async function bindProgress(p) {
    const d = await loadMedia(p.id); const body = $('#progBody'); if (!body || state.project !== p) return;
    const pr = d.progress, photos = (d.media || []).filter((m) => m.type === 'progress').sort((x, y) => (y.date > x.date ? 1 : -1));
    const staff = !!window.YurtaStaff;
    $('#progUpd').textContent = pr ? 'обновлено ' + new Date(pr.updatedAt).toLocaleDateString('ru-RU') : '';
    body.innerHTML = `
      ${pr ? `<div class="prog-line"><div class="prog-fill" style="width:${pr.percent}%"></div></div><div class="prog-txt"><b>${pr.percent}% готовности</b>${pr.stage ? ' · этап: ' + esc(pr.stage) : ''}</div>` : `<div class="prog-txt">Плановая сдача — <b>${esc(p.completion)}</b>. Процент готовности появится после первого отчёта.</div>`}
      ${photos.length ? `<div class="prog-photos">${photos.map((m, i) => `<button class="pp" data-ph="${i}"><img src="${m.url}" alt="" loading="lazy"><span>${new Date(m.date).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })}</span></button>`).join('')}</div>` : '<div class="small" style="margin-top:6px">Фото со стройки будут добавляться каждый месяц.</div>'}
      ${staff ? '<button class="link-btn" id="progAdd" style="margin-top:8px">＋ Добавить фото / обновить готовность</button>' : ''}`;
    body.querySelectorAll('[data-ph]').forEach((btn) => btn.onclick = () => {
      const m = photos[+btn.dataset.ph];
      openModal(`<figure class="wv-photo"><img src="${m.url}" alt=""><figcaption>${esc(m.caption || 'Ход строительства')} · ${new Date(m.date).toLocaleDateString('ru-RU')}${staff ? ' · <button class="link-btn" id="phDel">удалить</button>' : ''}</figcaption></figure>`, true);
      const del = $('#phDel'); if (del) del.onclick = async () => { if (!confirm('Удалить фото?')) return; await fetch('/api/media/' + m.id, { method: 'DELETE' }); closeModal(); await loadMedia(p.id, true); bindProgress(p); };
    });
    const add = $('#progAdd'); if (add) add.onclick = () => openMediaForm(p, pr);
  }
  // Сжимаем фото в браузере до 2000 px, чтобы загрузка была быстрой
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Не удалось открыть фото')); img.src = url;
    });
  }
  function openMediaForm(p, pr) {
    openModal(`<h2>Стройка и фото — ${esc(p.name)}</h2>
      <form id="mf" class="mform">
        <fieldset><legend>Готовность</legend>
          <label>Процент готовности<input name="percent" type="number" min="0" max="100" value="${pr ? pr.percent : ''}" placeholder="например, 35"></label>
          <label>Этап<select name="stage">${STAGES.map((s) => `<option ${pr && pr.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <button type="button" class="cta ghost" id="mfProg" style="margin-top:6px">Сохранить готовность</button></fieldset>
        <fieldset><legend>Добавить фото</legend>
          <label>Что на фото<select name="type"><option value="progress">Ход строительства</option><option value="view">Вид из окна (фото с дрона)</option></select></label>
          <label>Фото<input name="file" type="file" accept="image/*" required></label>
          <label>Дата съёмки<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
          <label>Подпись<input name="caption" maxlength="200" placeholder="например, залит 10 этаж блока 3"></label>
          <div class="mf-view" hidden>
            <label>Блок<select name="block"><option value="">любой</option>${p.blocks.map((b) => `<option>${b.id}</option>`).join('')}</select></label>
            <label>Этажи с — по<span class="row2"><input name="floorFrom" type="number" min="1" placeholder="с"><input name="floorTo" type="number" min="1" placeholder="по"></span></label>
            <label>Окна смотрят на<select name="side"><option value="">любую сторону</option><option value="N">север</option><option value="E">восток</option><option value="S">юг</option><option value="W">запад</option></select></label>
          </div>
          <div class="yc-err" id="mfErr" hidden></div>
          <button class="cta" type="submit" style="margin-top:8px">Загрузить фото</button></fieldset>
      </form>`);
    const f = $('#mf'), err = (t) => { const e = $('#mfErr'); e.hidden = !t; e.textContent = t || ''; };
    f.elements.type.onchange = () => { f.querySelector('.mf-view').hidden = f.elements.type.value !== 'view'; };
    $('#mfProg').onclick = async () => {
      const r = await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: p.id, percent: f.elements.percent.value, stage: f.elements.stage.value }) });
      if (!r.ok) return err((await r.json()).error || 'Ошибка');
      await loadMedia(p.id, true); closeModal(); bindProgress(p);
    };
    f.onsubmit = async (e) => {
      e.preventDefault(); err('');
      const el = f.elements, file = el.file.files[0]; if (!file) return;
      const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Загружаю…';
      try {
        const image = await shrinkImage(file);
        const r = await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: p.id, image, type: el.type.value, date: el.date.value, caption: el.caption.value, block: el.block.value, floorFrom: el.floorFrom.value, floorTo: el.floorTo.value, side: el.side.value }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Ошибка');
        await loadMedia(p.id, true); closeModal(); bindProgress(p);
      } catch (ex) { err(ex.message); btn.disabled = false; btn.textContent = 'Загрузить фото'; }
    };
  }
  window.addEventListener('yurta:staff', () => { if (state.project && !state.block) bindProgress(state.project); });

  /* ---------- Расчёт: ссылка на страницу с графиком платежей (её можно сохранить как PDF) ---------- */
  async function shareOffer(p, b, f, a, down, months) {
    const offer = { pid: p.id, project: p.name, address: p.address, completion: p.completion, block: b.id, floor: f, floors: b.floors, apt: aptNumber(p, b, f, a),
      rooms: roomsLabel(a), euro: !!a.euro, area: a.area, price: aptPrice(p, b, a), m2: priceM2(p, b), down, months,
      planImg: b.plan.img, planW: b.plan.w, planH: b.plan.h, render: p.renders[0], poly: a.poly };
    openModal('<h2>Готовлю расчёт…</h2>');
    try {
      const r = await fetch('/api/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offer }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Ошибка');
      const link = `${location.origin}/offer.html?id=${j.id}`;
      const text = `ЖК ${p.name}, блок ${b.id}, ${f} этаж, кв. ${offer.apt} — ${offer.rooms}, ${area(a.area)}\nЦена ${som(offer.price)}, взнос ${som(down)}, ${months} мес. по ${som(monthly(p, offer.price, down, months))}\nГрафик платежей: ${link}`;
      modalCard.innerHTML = `<button class="modal-close" data-close aria-label="Закрыть">✕</button><h2>Расчёт готов</h2>
        <p class="muted" style="margin:6px 0 12px">Страница с квартирой, планировкой и графиком всех ${months} платежей. Отправьте её в WhatsApp или сохраните как PDF.</p>
        <div class="offer-link"><input readonly value="${esc(link)}"><button class="link-btn" id="ofCopy">Копировать</button></div>
        <a class="cta wa" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Отправить в WhatsApp</a>
        <a class="cta ghost" href="${esc(link)}" target="_blank" rel="noopener">Открыть / скачать PDF</a>`;
      $('#ofCopy').onclick = () => { try { navigator.clipboard.writeText(link); } catch (e) {} $('#ofCopy').textContent = 'Скопировано ✓'; };
    } catch (e) { modalCard.innerHTML = `<button class="modal-close" data-close aria-label="Закрыть">✕</button><h2>Не получилось</h2><p class="muted">${esc(e.message)}</p>`; }
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
