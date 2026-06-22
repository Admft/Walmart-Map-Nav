const fs = require('fs');
const path = require('path');

function extractMapData(html) {
  const marker = 'window.mapData =';
  const start = html.indexOf(marker) + marker.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
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
  return JSON.parse(html.slice(start, end).trim());
}

function aisleStats(loc, prefix) {
  const pts = Object.entries(loc)
    .filter(([k]) => k.toUpperCase().startsWith(prefix.toUpperCase() + '.'))
    .map(([id, v]) => ({ id, ...v }));
  const xs = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(pts.map((p) => p.y))].sort((a, b) => a - b);
  return { count: pts.length, xs, ys, pts };
}

const html = fs.readFileSync(path.join(__dirname, '..', 'store_1216_raw.html'), 'utf8');
const data = extractMapData(html);
const loc = data.floors[0].aisleLocations;

for (const aisle of ['A12', 'A13', 'A14', 'L8', 'L9']) {
  const s = aisleStats(loc, aisle);
  console.log(aisle, s);
}

// Check if Walmart HTML has wall/floor geometry elsewhere
const wallIdx = html.indexOf('boundaries');
const svgIdx = html.indexOf('<svg');
console.log('boundaries idx', wallIdx, 'svg idx', svgIdx);
console.log('has floorGeometry', html.includes('floorGeometry'));
console.log('has mapElements', html.includes('mapElements'));

module.exports = { extractMapData };
