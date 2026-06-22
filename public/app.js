import {
  extractMapData,
  mapDataToModel,
  normalizeQuery,
  parseSearchQuery,
  aislePointsFor,
  aisleGeometry,
  buildAisleIndex,
  sideInfoForAisle,
} from './map-parser.js';
import * as storeCache from './store-cache.js';

const svg = document.getElementById('svg');
const deptLayer = document.getElementById('deptLayer');
const deptLabelLayer = document.getElementById('deptLabelLayer');
const pointLayer = document.getElementById('pointLayer');
const poiLayer = document.getElementById('poiLayer');
const routeLayer = document.getElementById('routeLayer');
const highlightLayer = document.getElementById('highlightLayer');
const storeInput = document.getElementById('storeInput');
const loadStoreBtn = document.getElementById('loadStoreBtn');
const search = document.getElementById('search');
const statusEl = document.getElementById('status');
const details = document.getElementById('details');
const nearbyEl = document.getElementById('nearby');
const matchesEl = document.getElementById('matches');
const badge = document.getElementById('badge');
const cacheList = document.getElementById('cacheList');
const myLocationBtn = document.getElementById('myLocationBtn');
const importStoreBtn = document.getElementById('importStoreBtn');
const importStoreInput = document.getElementById('importStoreInput');

let model = null;
let aisleIndex = new Map();
let current = null;
let currentMode = null;
let myLocation = null;
let placingLocation = false;
let fullView = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setView(x, y, w, h) {
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
}

function getView() {
  const [x, y, w, h] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  return { x, y, w, h };
}

function zoom(f) {
  const v = getView();
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  const nw = v.w * f;
  const nh = v.h * f;
  setView(cx - nw / 2, cy - nh / 2, nw, nh);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mapToClient(mapX, mapY) {
  const pt = svg.createSVGPoint();
  pt.x = mapX;
  pt.y = mapY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const screen = pt.matrixTransform(ctm);
  return { x: screen.x, y: screen.y };
}

function nearestAislePoint(clientX, clientY) {
  if (!model?.points?.length) {
    const tap = clientToMap(clientX, clientY);
    return { x: tap.x, y: tap.y, id: null, snapDistance: 0 };
  }
  let best = model.points[0];
  let bestD = Infinity;
  for (const p of model.points) {
    const screen = mapToClient(p.x, p.y);
    const d = Math.hypot(screen.x - clientX, screen.y - clientY);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { x: best.x, y: best.y, id: best.id, snapDistance: bestD };
}

function setPlacementPointerEvents(enabled) {
  const value = enabled ? 'none' : '';
  pointLayer.style.pointerEvents = value;
  poiLayer.style.pointerEvents = value;
  deptLayer.style.pointerEvents = value;
  deptLabelLayer.style.pointerEvents = value;
}

function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

function addTo(layer, el) {
  layer.appendChild(el);
  return el;
}

function clearLayers() {
  deptLayer.innerHTML = '';
  deptLabelLayer.innerHTML = '';
  pointLayer.innerHTML = '';
  poiLayer.innerHTML = '';
  routeLayer.innerHTML = '';
  highlightLayer.innerHTML = '';
}

function boundariesToRect(boundaries) {
  const xs = boundaries.map((b) => b.x);
  const ys = boundaries.map((b) => b.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function rectOverlapRatio(inner, outer) {
  const ix = Math.max(inner.x, outer.x);
  const iy = Math.max(inner.y, outer.y);
  const ix2 = Math.min(inner.x + inner.w, outer.x + outer.w);
  const iy2 = Math.min(inner.y + inner.h, outer.y + outer.h);
  if (ix2 <= ix || iy2 <= iy) return 0;
  const inter = (ix2 - ix) * (iy2 - iy);
  return inter / (inner.w * inner.h);
}

function boxesOverlap(a, b, pad = 16) {
  return !(
    a.x + a.width + pad < b.x ||
    b.x + b.width + pad < a.x ||
    a.y + a.height + pad < b.y ||
    b.y + b.height + pad < a.y
  );
}

function labelSlots(rect) {
  return [
    { x: rect.cx, y: rect.cy },
    { x: rect.cx, y: rect.y + rect.h * 0.28 },
    { x: rect.cx, y: rect.y + rect.h * 0.72 },
    { x: rect.x + rect.w * 0.28, y: rect.cy },
    { x: rect.x + rect.w * 0.72, y: rect.cy },
  ];
}

function fitsInsideRect(bb, rect, margin = 18) {
  return (
    bb.x >= rect.x - margin &&
    bb.y >= rect.y - margin &&
    bb.x + bb.width <= rect.x + rect.w + margin &&
    bb.y + bb.height <= rect.y + rect.h + margin
  );
}

function addDeptLabel(x, y, text) {
  const group = svgEl('g', { class: 'deptLabelGroup' });
  const label = svgEl(
    'text',
    {
      x,
      y,
      class: 'deptLabel',
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
    },
    text,
  );
  group.appendChild(label);
  deptLabelLayer.appendChild(group);

  const bb = label.getBBox();
  const pad = 8;
  const bg = svgEl('rect', {
    x: bb.x - pad,
    y: bb.y - pad,
    width: bb.width + pad * 2,
    height: bb.height + pad * 2,
    rx: 6,
    class: 'deptLabelBg',
  });
  group.insertBefore(bg, label);
  return group.getBBox();
}

function drawDepartments() {
  const items = [];
  for (const d of model.departments) {
    if (!d.boundaries?.length) continue;
    const rect = boundariesToRect(d.boundaries);
    if (rect.w < 8 || rect.h < 8) continue;
    items.push({ name: d.name, rect, area: rect.w * rect.h });
  }

  items.sort((a, b) => b.area - a.area);
  for (const item of items) {
    addTo(
      deptLayer,
      svgEl('rect', {
        x: item.rect.x,
        y: item.rect.y,
        width: item.rect.w,
        height: item.rect.h,
        rx: 12,
        class: 'dept',
      }),
    );
  }

  const placed = [];
  const labelCandidates = items
    .filter((item) => item.rect.w >= 140 && item.rect.h >= 90)
    .sort((a, b) => b.area - a.area);

  for (const item of labelCandidates) {
    const nestedInLarger = items.some(
      (other) =>
        other.area > item.area * 1.35 &&
        rectOverlapRatio(item.rect, other.rect) > 0.82,
    );
    if (nestedInLarger) continue;

    let placedLabel = false;
    for (const slot of labelSlots(item.rect)) {
      const probe = svgEl(
        'text',
        {
          x: slot.x,
          y: slot.y,
          class: 'deptLabel',
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
        },
        item.name,
      );
      deptLabelLayer.appendChild(probe);
      const probeBox = probe.getBBox();
      probe.remove();

      if (!fitsInsideRect(probeBox, item.rect)) continue;
      if (placed.some((box) => boxesOverlap(probeBox, box))) continue;

      const box = addDeptLabel(slot.x, slot.y, item.name);
      placed.push(box);
      placedLabel = true;
      break;
    }
    if (!placedLabel && item.area > 350000) {
      const box = addDeptLabel(item.rect.cx, item.rect.cy, item.name);
      if (placed.some((b) => boxesOverlap(box, b))) {
        deptLabelLayer.lastChild?.remove();
      } else {
        placed.push(box);
      }
    }
  }
}

function drawBasePoints() {
  for (const p of model.points) {
    const c = svgEl('circle', { cx: p.x, cy: p.y, r: 8, class: 'aisleDot' });
    c.dataset.id = p.id;
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      findAisle(p.id);
    });
    addTo(pointLayer, c);
  }

  for (const poi of model.pois) {
    addTo(poiLayer, svgEl('circle', { cx: poi.x, cy: poi.y, r: 14, class: 'poi' }));
    addTo(
      poiLayer,
      svgEl('text', { x: poi.x + 22, y: poi.y + 8, class: 'smallLabel' }, poi.name),
    );
  }
}

function drawMyLocation() {
  if (!myLocation) return;
  addTo(routeLayer, svgEl('circle', { cx: myLocation.x, cy: myLocation.y, r: 90, class: 'youRing' }));
  addTo(routeLayer, svgEl('circle', { cx: myLocation.x, cy: myLocation.y, r: 28, class: 'youDot' }));
  const label = myLocation.id ? `You · ${myLocation.id}` : 'You';
  addTo(
    routeLayer,
    svgEl('text', { x: myLocation.x + 36, y: myLocation.y + 10, class: 'label' }, label),
  );
}

function drawRouteTo(target) {
  if (!myLocation || !target) return;
  addTo(
    routeLayer,
    svgEl('line', {
      x1: myLocation.x,
      y1: myLocation.y,
      x2: target.x,
      y2: target.y,
      class: 'routeLine',
    }),
  );
  const feet = Math.round(distance(myLocation, target) / 12);
  addTo(
    routeLayer,
    svgEl(
      'text',
      {
        x: (myLocation.x + target.x) / 2,
        y: (myLocation.y + target.y) / 2 - 24,
        class: 'callout',
        'text-anchor': 'middle',
      },
      `~${feet} ft`,
    ),
  );
}

function highlightExact(exact) {
  const near = model.points
    .map((p) => ({ ...p, d: distance(exact, p) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 12);

  addTo(highlightLayer, svgEl('circle', { cx: exact.x, cy: exact.y, r: 170, class: 'targetRing2' }));
  addTo(highlightLayer, svgEl('circle', { cx: exact.x, cy: exact.y, r: 105, class: 'targetRing' }));
  addTo(highlightLayer, svgEl('line', { x1: exact.x - 150, y1: exact.y, x2: exact.x - 60, y2: exact.y, class: 'crosshair' }));
  addTo(highlightLayer, svgEl('line', { x1: exact.x + 60, y1: exact.y, x2: exact.x + 150, y2: exact.y, class: 'crosshair' }));
  addTo(highlightLayer, svgEl('line', { x1: exact.x, y1: exact.y - 150, x2: exact.x, y2: exact.y - 60, class: 'crosshair' }));
  addTo(highlightLayer, svgEl('line', { x1: exact.x, y1: exact.y + 60, x2: exact.x, y2: exact.y + 150, class: 'crosshair' }));
  addTo(highlightLayer, svgEl('circle', { cx: exact.x, cy: exact.y, r: 30, class: 'targetDot' }));
  addTo(highlightLayer, svgEl('text', { x: exact.x + 50, y: exact.y + 16, class: 'label' }, exact.id));

  const side = sideInfoForAisle(aisleKeyFromPoint(exact), aisleIndex);
  if (side?.hint) {
    addTo(
      highlightLayer,
      svgEl('text', { x: exact.x - 700, y: exact.y - 360, class: 'callout' }, side.hint),
    );
  }

  return { near, side };
}

function aisleKeyFromPoint(p) {
  const m = p.id.toUpperCase().match(/^([A-Z]+\d+)\./);
  return m ? m[1] : null;
}

function highlightAisle(aisleKey) {
  const pts = aislePointsFor(model.points, aisleKey);
  const geom = aisleGeometry(pts);
  if (!geom) return { pts, side: null };

  const side = sideInfoForAisle(aisleKey, aisleIndex);
  const r = geom.rect;
  addTo(
    highlightLayer,
    svgEl('rect', {
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      rx: 18,
      class: 'aisleBand',
    }),
  );

  if (side?.facing) {
    let edge;
    if (geom.horizontal) {
      const y = side.facing === 'north' ? r.y : r.y + r.h;
      edge = { x1: r.x, y1: y, x2: r.x + r.w, y2: y };
    } else {
      const x = side.facing === 'west' ? r.x : r.x + r.w;
      edge = { x1: x, y1: r.y, x2: x, y2: r.y + r.h };
    }
    addTo(highlightLayer, svgEl('line', { ...edge, class: 'aisleBandEdge' }));
  }

  for (const p of pts) {
    addTo(highlightLayer, svgEl('circle', { cx: p.x, cy: p.y, r: 14, class: 'aisleDot' }));
  }

  addTo(
    highlightLayer,
    svgEl('text', { x: geom.cx, y: geom.cy + 12, class: 'callout', 'text-anchor': 'middle' }, side?.label || aisleKey),
  );

  return { pts, geom, side };
}

function focusOn(target, w = 1800, h = 1200) {
  const x = target.x ?? target.cx;
  const y = target.y ?? target.cy;
  setView(x - w / 2, y - h / 2, w, h);
}

function showMatches(q) {
  matchesEl.innerHTML = '';
  if (!q || !model) return;
  const n = normalizeQuery(q);
  const hits = model.points.filter((p) => p.id.toUpperCase().includes(n)).slice(0, 80);
  if (!hits.length) return;
  matchesEl.innerHTML = '<strong>Partial matches</strong><br>';
  for (const p of hits) {
    const b = document.createElement('button');
    b.textContent = p.id;
    b.onclick = () => findAisle(p.id);
    matchesEl.appendChild(b);
  }
}

function renderRouteAndYou() {
  routeLayer.innerHTML = '';
  drawMyLocation();
  if (current) drawRouteTo(current);
}

function findAisle(raw) {
  if (!model) return;
  const parsed = parseSearchQuery(raw || search.value);
  search.value = parsed.id || '';
  if (parsed.mode === 'empty') {
    showMatches('');
    return;
  }

  highlightLayer.innerHTML = '';
  nearbyEl.innerHTML = '';
  matchesEl.innerHTML = '';

  if (parsed.mode === 'aisle') {
    const pts = aislePointsFor(model.points, parsed.aisle);
    if (!pts.length) {
      badge.textContent = 'Not found';
      statusEl.textContent = `No aisle ${parsed.aisle} in store ${model.storeId}`;
      details.innerHTML = `<strong>${esc(parsed.aisle)}</strong> was not found in this store.`;
      showMatches(parsed.aisle);
      current = null;
      currentMode = null;
      renderRouteAndYou();
      return;
    }

    const { geom, side } = highlightAisle(parsed.aisle);
    current = { x: geom.cx, y: geom.cy, id: parsed.aisle };
    currentMode = 'aisle';
    badge.textContent = parsed.aisle;
    statusEl.textContent = `Aisle ${parsed.aisle} · ${pts.length} markers`;
    focusOn(geom, Math.max(geom.rect.w + 500, 1600), Math.max(geom.rect.h + 700, 1100));

    details.innerHTML = `<strong>Full aisle ${esc(parsed.aisle)}</strong><br>${pts.length} shelf markers highlighted.<br>${
      side?.hint ? `<span class="hint">${esc(side.hint)}</span><br>` : ''
    }<span class="hint">Add a subsection like <strong>${esc(parsed.aisle)}.5</strong> for an exact spot.</span>`;

    nearbyEl.innerHTML = '';
    for (const p of pts.slice(0, 16)) {
      const b = document.createElement('button');
      b.textContent = p.id;
      b.onclick = () => findAisle(p.id);
      nearbyEl.appendChild(b);
    }
    renderRouteAndYou();
    return;
  }

  const exact = model.byId.get(parsed.id);
  if (!exact) {
    statusEl.textContent = `No exact match for ${parsed.id}`;
    details.innerHTML = `<strong>${esc(parsed.id)}</strong> was not found. Try <strong>A13</strong> for the whole aisle or <strong>A13.5</strong> for a spot.`;
    badge.textContent = 'Not found';
    showMatches(parsed.id);
    current = null;
    currentMode = null;
    renderRouteAndYou();
    return;
  }

  current = exact;
  currentMode = 'exact';
  badge.textContent = exact.id;
  statusEl.textContent = `Found ${exact.id}`;
  const { near, side } = highlightExact(exact);
  focusOn(exact);

  details.innerHTML = `<strong>${esc(exact.id)}</strong><br>x=${exact.x}, y=${exact.y}<br>${
    side?.hint ? `${esc(side.hint)}<br>` : ''
  }<span class="hint">Exact shelf location. Search <strong>${esc(aisleKeyFromPoint(exact) || '')}</strong> without a number for the full aisle.</span>`;

  for (const p of near) {
    const b = document.createElement('button');
    b.textContent = `${p.id} · ${Math.round(p.d)}`;
    b.onclick = () => findAisle(p.id);
    nearbyEl.appendChild(b);
  }
  renderRouteAndYou();
}

async function listKnownStoreIds() {
  const ids = new Set(await storeCache.listCachedStores());
  if (window.BUNDLED_STORES) {
    for (const id of Object.keys(window.BUNDLED_STORES)) ids.add(String(id));
  }
  if (location.protocol.startsWith('http')) {
    try {
      const res = await fetch('/api/stores');
      if (res.ok) {
        const data = await res.json();
        for (const id of data.stores || []) ids.add(String(id));
      }
    } catch {}
    try {
      const res = await fetch('stores/manifest.json');
      if (res.ok) {
        const data = await res.json();
        for (const id of data.stores || []) ids.add(String(id));
      }
    } catch {}
  }
  return [...ids].sort((a, b) => Number(a) - Number(b));
}

async function fetchMapData(id, forceDownload = false) {
  if (!forceDownload) {
    const cached = await storeCache.getStore(id);
    if (cached) return { mapData: cached, source: 'saved on this device' };
  }

  if (window.BUNDLED_STORES?.[id]) {
    const mapData = window.BUNDLED_STORES[id];
    await storeCache.putStore(id, mapData);
    return { mapData, source: 'built into this file' };
  }

  if (location.protocol.startsWith('http')) {
    try {
      const q = forceDownload ? '?force=1' : '';
      const res = await fetch(`/api/store/${id}${q}`);
      if (res.ok) {
        const payload = await res.json();
        const mapData = payload.mapData || extractMapData(payload.html);
        await storeCache.putStore(id, mapData);
        const source = payload.cached ? 'local folder' : 'downloaded from Walmart';
        return { mapData, source };
      }
      if (res.status !== 404) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Failed to load store ${id}`);
      }
    } catch (err) {
      if (err.message && !err.message.includes('Failed to fetch')) throw err;
    }

    try {
      const res = await fetch(`stores/${id}.json`);
      if (res.ok) {
        const mapData = await res.json();
        await storeCache.putStore(id, mapData);
        return { mapData, source: 'bundled with app' };
      }
    } catch {}
  }

  const hint = window.STANDALONE_HTML
    ? 'Use Import map file — open the Walmart map page in your browser, save it as .html, then import it here.'
    : 'Connect to the internet and try again, or use Import map file.';
  throw new Error(`Store ${id} not found. ${hint}`);
}

async function refreshCacheList(activeStoreId) {
  const stores = await listKnownStoreIds();
  cacheList.innerHTML = '';
  if (!stores.length) {
    cacheList.innerHTML = '<li class="hint">No stores yet. Load one or import a map file.</li>';
    return;
  }
  for (const id of stores) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = id === activeStoreId ? `Store ${id} ✓` : `Store ${id}`;
    if (id === activeStoreId) btn.classList.add('active');
    btn.onclick = () => {
      storeInput.value = id;
      loadStore(id);
    };
    li.appendChild(btn);
    cacheList.appendChild(li);
  }
}

function applyModel(next) {
  model = next;
  aisleIndex = buildAisleIndex(model.points);
  fullView = model.fullView;
  current = null;
  currentMode = null;
  myLocation = null;
  placingLocation = false;
  myLocationBtn.classList.remove('active');
  svg.classList.remove('placing');
  setPlacementPointerEvents(false);
  clearLayers();
  drawDepartments();
  drawBasePoints();
  setView(fullView.x, fullView.y, fullView.w, fullView.h);
  badge.textContent = `Store ${model.storeId}`;
  statusEl.textContent = `Loaded store ${model.storeId} · ${model.points.length} aisle markers`;
  details.textContent = 'Enter an aisle like A13 (full aisle) or A13.5 (exact spot).';
}

async function loadStore(storeId, forceDownload = false) {
  const id = String(storeId).replace(/\D/g, '');
  if (!id) return;
  statusEl.textContent = `Loading store ${id}...`;
  try {
    const { mapData, source } = await fetchMapData(id, forceDownload);
    applyModel(mapDataToModel(mapData));
    statusEl.textContent = `Store ${id} · ${source}`;
    await refreshCacheList(id);
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  } catch (err) {
    statusEl.textContent = err.message;
    details.textContent = err.message;
  }
}

async function importStoreFile(file) {
  const text = await file.text();
  const mapData = extractMapData(text);
  const id = String(mapData.storeId);
  await storeCache.putStore(id, mapData);
  storeInput.value = id;
  await loadStore(id);
  statusEl.textContent = `Imported store ${id} from ${file.name}`;
}

function clientToMap(clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const map = pt.matrixTransform(ctm.inverse());
  return { x: map.x, y: map.y };
}

function toggleMyLocationMode() {
  placingLocation = !placingLocation;
  myLocationBtn.classList.toggle('active', placingLocation);
  svg.classList.toggle('placing', placingLocation);
  setPlacementPointerEvents(placingLocation);
  statusEl.textContent = placingLocation
    ? 'Tap the map — snaps to nearest aisle marker'
    : myLocation
      ? myLocation.id
        ? `My location: ${myLocation.id}`
        : 'My location set'
      : statusEl.textContent;
}

let dragging = false;
let last = null;

svg.addEventListener('pointerdown', (e) => {
  if (placingLocation) return;
  dragging = true;
  last = { x: e.clientX, y: e.clientY };
  svg.setPointerCapture(e.pointerId);
});

svg.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const v = getView();
  const dx = ((e.clientX - last.x) * v.w) / svg.clientWidth;
  const dy = ((e.clientY - last.y) * v.h) / svg.clientHeight;
  setView(v.x - dx, v.y - dy, v.w, v.h);
  last = { x: e.clientX, y: e.clientY };
});

svg.addEventListener('pointerup', (e) => {
  dragging = false;
  try {
    svg.releasePointerCapture(e.pointerId);
  } catch {}
});

svg.addEventListener('click', (e) => {
  if (!placingLocation) return;
  myLocation = nearestAislePoint(e.clientX, e.clientY);
  placingLocation = false;
  myLocationBtn.classList.remove('active');
  svg.classList.remove('placing');
  setPlacementPointerEvents(false);
  renderRouteAndYou();
  statusEl.textContent = myLocation.id
    ? `My location: ${myLocation.id}`
    : `My location: x=${Math.round(myLocation.x)}, y=${Math.round(myLocation.y)}`;
  if (!current) {
    details.innerHTML = myLocation.id
      ? `<span class="hint">Snapped to nearest marker <strong>${esc(myLocation.id)}</strong>. Search an aisle for directions.</span>`
      : '<span class="hint">Location set. Search an aisle, then the green line shows the way.</span>';
  }
});

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom(e.deltaY > 0 ? 1.15 : 0.87);
}, { passive: false });

document.getElementById('goBtn').onclick = () => findAisle();
document.getElementById('zoomIn').onclick = () => zoom(0.75);
document.getElementById('zoomOut').onclick = () => zoom(1.33);
document.getElementById('homeBtn').onclick = () => {
  if (fullView) setView(fullView.x, fullView.y, fullView.w, fullView.h);
};
document.getElementById('fullBtn').onclick = () => {
  if (fullView) setView(fullView.x, fullView.y, fullView.w, fullView.h);
};
document.getElementById('clearBtn').onclick = () => {
  current = null;
  currentMode = null;
  myLocation = null;
  highlightLayer.innerHTML = '';
  routeLayer.innerHTML = '';
  nearbyEl.innerHTML = '';
  matchesEl.innerHTML = '';
  details.textContent = 'Enter an aisle like A13 (full aisle) or A13.5 (exact spot).';
  badge.textContent = model ? `Store ${model.storeId}` : 'Search';
  statusEl.textContent = model ? `Loaded store ${model.storeId}` : 'Ready';
  search.value = '';
};
loadStoreBtn.onclick = () => loadStore(storeInput.value);
importStoreBtn.onclick = () => importStoreInput.click();
importStoreInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) importStoreFile(file);
  e.target.value = '';
});
myLocationBtn.onclick = toggleMyLocationMode;
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') findAisle();
});
search.addEventListener('input', (e) => showMatches(e.target.value));

const initialStore = (location.hash.match(/^\#(\d+)/) || [])[1] || storeInput.value || '1216';
storeInput.value = initialStore;
loadStore(initialStore);
