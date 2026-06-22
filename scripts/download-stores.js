const fs = require('fs');
const path = require('path');

const WALMART_MAP_URL =
  'https://developer.api.walmart.com/api-proxy/service/Store-Services/Instore-Maps/v1/store';

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

async function downloadStore(storeId, storesDir) {
  const jsonPath = path.join(storesDir, `${storeId}.json`);
  const htmlPath = path.join(storesDir, `${storeId}.html`);

  if (fs.existsSync(jsonPath)) {
    return { storeId, status: 'cached' };
  }

  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const mapData = extractMapData(html);
    fs.writeFileSync(jsonPath, JSON.stringify(mapData));
    const kb = (fs.statSync(jsonPath).size / 1024).toFixed(0);
    return { storeId, status: 'converted', kb };
  }

  const url = `${WALMART_MAP_URL}/${storeId}/map`;
  const response = await fetch(url);
  if (!response.ok) {
    return { storeId, status: 'failed', error: `HTTP ${response.status}` };
  }
  const html = await response.text();
  if (!html.includes('window.mapData')) {
    return { storeId, status: 'failed', error: 'invalid map page' };
  }
  const mapData = extractMapData(html);
  fs.writeFileSync(jsonPath, JSON.stringify(mapData));
  const kb = (fs.statSync(jsonPath).size / 1024).toFixed(0);
  return { storeId, status: 'downloaded', kb };
}

async function runPool(ids, storesDir, concurrency = 4) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < ids.length) {
      const i = index++;
      const id = ids[i];
      try {
        const result = await downloadStore(id, storesDir);
        results.push(result);
        const tag = result.status === 'downloaded' ? `downloaded ${result.kb}KB` : result.status;
        console.log(`[${i + 1}/${ids.length}] Store ${id}: ${tag}`);
      } catch (err) {
        results.push({ storeId: id, status: 'failed', error: err.message });
        console.log(`[${i + 1}/${ids.length}] Store ${id}: failed - ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function main() {
  const root = path.join(__dirname, '..');
  const storesDir = path.join(root, 'stores');
  const listPath = path.join(storesDir, 'bundled-store-ids.json');
  const ids = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  fs.mkdirSync(storesDir, { recursive: true });

  console.log(`Downloading ${ids.length} stores...`);
  const results = await runPool(ids, storesDir);

  const downloaded = results.filter((r) => r.status === 'downloaded').length;
  const cached = results.filter((r) => r.status === 'cached').length;
  const failed = results.filter((r) => r.status === 'failed');

  console.log(`\nDone: ${cached} cached, ${downloaded} downloaded, ${failed.length} failed`);
  if (failed.length) {
    console.log('Failed stores:', failed.map((f) => `${f.storeId} (${f.error})`).join(', '));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
