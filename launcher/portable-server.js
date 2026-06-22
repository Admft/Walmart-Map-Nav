const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3456;
const ROOT = path.join(__dirname, 'pack');
const STORES_DIR = process.pkg
  ? path.join(process.env.APPDATA || process.env.HOME || ROOT, 'WalmartMapNav', 'stores')
  : path.join(ROOT, 'stores');
const WALMART_MAP_URL =
  'https://developer.api.walmart.com/api-proxy/service/Store-Services/Instore-Maps/v1/store';

if (!fs.existsSync(STORES_DIR)) fs.mkdirSync(STORES_DIR, { recursive: true });

const app = express();
app.use(express.static(ROOT));

function storeJsonPath(storeId) {
  return path.join(STORES_DIR, `${storeId}.json`);
}

function bundledJsonPath(storeId) {
  return path.join(ROOT, 'stores', `${storeId}.json`);
}

function extractMapDataFromHtml(html) {
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

function listCachedStores() {
  const ids = new Set();
  for (const dir of [STORES_DIR, path.join(ROOT, 'stores')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/^\d+\.json$/.test(f)) ids.add(f.replace(/\.json$/, ''));
    }
  }
  return [...ids].sort((a, b) => Number(a) - Number(b));
}

app.get('/api/stores', (_req, res) => {
  res.json({ stores: listCachedStores() });
});

app.get('/api/store/:id', async (req, res) => {
  const storeId = String(req.params.id).replace(/\D/g, '');
  if (!storeId) {
    res.status(400).json({ error: 'Invalid store number' });
    return;
  }

  const force = req.query.force === '1' || req.query.refresh === '1';
  const userFile = storeJsonPath(storeId);
  const bundledFile = bundledJsonPath(storeId);

  if (!force && fs.existsSync(userFile)) {
    const mapData = JSON.parse(fs.readFileSync(userFile, 'utf8'));
    const stat = fs.statSync(userFile);
    res.json({ storeId, cached: true, downloadedAt: stat.mtime.toISOString(), mapData });
    return;
  }

  if (!force && fs.existsSync(bundledFile)) {
    const mapData = JSON.parse(fs.readFileSync(bundledFile, 'utf8'));
    const stat = fs.statSync(bundledFile);
    res.json({ storeId, cached: true, downloadedAt: stat.mtime.toISOString(), mapData });
    return;
  }

  try {
    const response = await fetch(`${WALMART_MAP_URL}/${storeId}/map`);
    if (!response.ok) {
      res.status(response.status).json({ error: `Walmart API returned ${response.status} for store ${storeId}` });
      return;
    }
    const html = await response.text();
    if (!html.includes('window.mapData')) {
      res.status(502).json({ error: 'Downloaded file does not look like a Walmart map page' });
      return;
    }
    const mapData = extractMapDataFromHtml(html);
    fs.writeFileSync(userFile, JSON.stringify(mapData), 'utf8');
    res.json({ storeId, cached: false, downloadedAt: new Date().toISOString(), mapData });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to download store map' });
  }
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`Walmart Map Nav running at ${url}`);
  console.log(`Cached stores: ${listCachedStores().join(', ') || '(none)'}`);
  console.log('Close this window to stop.');
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`);
  }
});
