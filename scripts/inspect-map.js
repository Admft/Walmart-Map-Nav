const fs = require('fs');
const path = process.argv[2] || 'store_1216_raw.html';
const h = fs.readFileSync(path, 'utf8');
const marker = 'window.mapData =';
const start = h.indexOf(marker) + marker.length;
let depth = 0;
let inStr = false;
let esc = false;
let end = -1;
for (let i = start; i < h.length; i++) {
  const c = h[i];
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
const d = JSON.parse(h.slice(start, end).trim());
const f = d.floors[0];
console.log('storeId', d.storeId);
console.log('floor keys:', Object.keys(f));
for (const k of Object.keys(f)) {
  const v = f[k];
  if (k === 'aisleLocations') {
    const ids = Object.keys(v);
    console.log('aisleLocations count', ids.length);
    const a13 = ids.filter((id) => /^A13/i.test(id));
    console.log('A13 samples', a13.slice(0, 15));
    console.log('A13 sample coords', a13.slice(0, 3).map((id) => ({ id, ...v[id] })));
    continue;
  }
  if (Array.isArray(v)) {
    const sample = v[0];
    console.log(k, 'len', v.length, sample ? JSON.stringify(sample).slice(0, 200) : '');
  } else if (typeof v === 'object' && v !== null) {
    console.log(k, 'object keys', Object.keys(v).slice(0, 5), '... total', Object.keys(v).length);
  } else {
    console.log(k, v);
  }
}
