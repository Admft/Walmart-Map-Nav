const fs = require('fs');
const path = require('path');

function extractMapData(html) {
  const marker = 'window.mapData =';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Could not find window.mapData');

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

const storesDir = process.argv[2] || path.join(__dirname, '..', 'stores');
const outDir = process.argv[3] || storesDir;

for (const file of fs.readdirSync(storesDir)) {
  if (!/^\d+\.html$/i.test(file)) continue;
  const id = file.replace(/\.html$/i, '');
  const html = fs.readFileSync(path.join(storesDir, file), 'utf8');
  const mapData = extractMapData(html);
  const out = path.join(outDir, `${id}.json`);
  fs.writeFileSync(out, JSON.stringify(mapData));
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`Wrote stores/${id}.json (${kb} KB)`);
}
