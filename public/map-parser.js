export function extractMapData(html) {
  const marker = 'window.mapData =';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Could not find window.mapData in store HTML');

  const jsonStart = start + marker.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;

  for (let i = jsonStart; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end < 0) throw new Error('Could not parse mapData JSON');
  return JSON.parse(html.slice(jsonStart, end).trim());
}

export function mapDataToModel(mapData) {
  const floor = mapData.floors?.[0];
  if (!floor) throw new Error('No floor data in map');

  const points = Object.entries(floor.aisleLocations || {}).map(([id, v]) => ({
    id,
    x: v.x,
    y: v.y,
    deptId: v.deptId,
  }));

  const pois = (floor.pointsOfInterest || []).flatMap((poi) =>
    (poi.points || []).map((pt) => ({
      name: poi.name,
      typeId: poi.typeId,
      x: pt.x,
      y: pt.y,
    })),
  );

  const departments = (floor.departments || []).map((d) => ({
    id: String(d.id),
    name: d.name || d.custname || `Dept ${d.id}`,
    boundaries: d.boundaries || [],
  }));

  const coords = [];
  for (const p of points) coords.push(p.x, p.y);
  for (const poi of pois) coords.push(poi.x, poi.y);
  for (const d of departments) {
    for (const b of d.boundaries) coords.push(b.x, b.y);
  }

  const pad = 120;
  const xs = coords.filter((_, i) => i % 2 === 0);
  const ys = coords.filter((_, i) => i % 2 === 1);
  const fullView = {
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    w: Math.max(...xs) - Math.min(...xs) + pad * 2,
    h: Math.max(...ys) - Math.min(...ys) + pad * 2,
  };

  return {
    storeId: mapData.storeId,
    points,
    pois,
    departments,
    fullView,
    byId: new Map(points.map((p) => [p.id.toUpperCase(), p])),
  };
}

export function normalizeQuery(v) {
  return String(v || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '.')
    .replace(/_/g, '.');
}

export function parseSearchQuery(raw) {
  const id = normalizeQuery(raw);
  if (!id) return { mode: 'empty', id };

  const fullAisle = id.match(/^([A-Z]+\d+)$/);
  if (fullAisle) return { mode: 'aisle', aisle: fullAisle[1], id };

  return { mode: 'exact', id };
}

export function aislePointsFor(points, aisleKey) {
  const prefix = aisleKey.toUpperCase() + '.';
  return points.filter((p) => p.id.toUpperCase().startsWith(prefix));
}

export function aisleGeometry(pts) {
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xSpread = maxX - minX;
  const ySpread = maxY - minY;
  const horizontal = xSpread >= ySpread;
  const thickness = Math.max(horizontal ? ySpread : xSpread, 18) + 36;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return {
    horizontal,
    minX,
    maxX,
    minY,
    maxY,
    cx,
    cy,
    rect: horizontal
      ? { x: minX - 20, y: cy - thickness / 2, w: maxX - minX + 40, h: thickness }
      : { x: cx - thickness / 2, y: minY - 20, w: thickness, h: maxY - minY + 40 },
  };
}

export function aisleKeyFromId(id) {
  const m = id.toUpperCase().match(/^([A-Z]+\d+)\./);
  return m ? m[1] : null;
}

export function buildAisleIndex(points) {
  const index = new Map();
  for (const p of points) {
    const key = aisleKeyFromId(p.id);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(p);
  }
  return index;
}

export function sideInfoForAisle(aisleKey, aisleIndex) {
  const pts = aisleIndex.get(aisleKey) || [];
  const geom = aisleGeometry(pts);
  if (!geom) return null;

  const neighbors = [];
  for (const [otherKey, otherPts] of aisleIndex.entries()) {
    if (otherKey === aisleKey) continue;
    const otherGeom = aisleGeometry(otherPts);
    if (!otherGeom || otherGeom.horizontal !== geom.horizontal) continue;

    if (geom.horizontal) {
      const overlap = Math.min(geom.maxX, otherGeom.maxX) - Math.max(geom.minX, otherGeom.minX);
      if (overlap < Math.min(geom.maxX - geom.minX, otherGeom.maxX - otherGeom.minX) * 0.35) continue;
      const gap = otherGeom.cy - geom.cy;
      if (Math.abs(gap) < 8 || Math.abs(gap) > 220) continue;
      neighbors.push({ key: otherKey, gap, direction: gap < 0 ? 'north' : 'south' });
    } else {
      const overlap = Math.min(geom.maxY, otherGeom.maxY) - Math.max(geom.minY, otherGeom.minY);
      if (overlap < Math.min(geom.maxY - geom.minY, otherGeom.maxY - otherGeom.minY) * 0.35) continue;
      const gap = otherGeom.cx - geom.cx;
      if (Math.abs(gap) < 8 || Math.abs(gap) > 220) continue;
      neighbors.push({ key: otherKey, gap, direction: gap < 0 ? 'west' : 'east' });
    }
  }

  neighbors.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
  const closest = neighbors[0];
  if (!closest) return { label: aisleKey, facing: null, neighbor: null };

  const facing =
    closest.direction === 'north'
      ? 'north face'
      : closest.direction === 'south'
        ? 'south face'
        : closest.direction === 'west'
          ? 'west face'
          : 'east face';

  return {
    label: `${aisleKey} · ${facing}`,
    facing: closest.direction,
    neighbor: closest.key,
    hint: `Back-to-back with ${closest.key} on the ${closest.direction} side`,
  };
}
