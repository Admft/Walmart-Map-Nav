const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;
const STORES_DIR = path.join(__dirname, 'stores');
const WALMART_MAP_URL =
  'https://developer.api.walmart.com/api-proxy/service/Store-Services/Instore-Maps/v1/store';

if (!fs.existsSync(STORES_DIR)) fs.mkdirSync(STORES_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, 'public')));

function storePath(storeId) {
  return path.join(STORES_DIR, `${storeId}.html`);
}

function storeJsonPath(storeId) {
  return path.join(STORES_DIR, `${storeId}.json`);
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
  for (const f of fs.readdirSync(STORES_DIR)) {
    if (/^\d+\.(html|json)$/.test(f)) ids.add(f.replace(/\.(html|json)$/, ''));
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
  const jsonFile = storeJsonPath(storeId);
  const htmlFile = storePath(storeId);

  if (!force && fs.existsSync(jsonFile)) {
    const mapData = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    const stat = fs.statSync(jsonFile);
    res.json({
      storeId,
      cached: true,
      downloadedAt: stat.mtime.toISOString(),
      mapData,
    });
    return;
  }

  if (!force && fs.existsSync(htmlFile)) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const mapData = extractMapDataFromHtml(html);
    fs.writeFileSync(jsonFile, JSON.stringify(mapData), 'utf8');
    const stat = fs.statSync(htmlFile);
    res.json({
      storeId,
      cached: true,
      downloadedAt: stat.mtime.toISOString(),
      mapData,
    });
    return;
  }

  try {
    const url = `${WALMART_MAP_URL}/${storeId}/map`;
    const response = await fetch(url);
    if (!response.ok) {
      res.status(response.status).json({
        error: `Walmart API returned ${response.status} for store ${storeId}`,
      });
      return;
    }
    const html = await response.text();
    if (!html.includes('window.mapData')) {
      res.status(502).json({ error: 'Downloaded file does not look like a Walmart map page' });
      return;
    }
    const mapData = extractMapDataFromHtml(html);
    fs.writeFileSync(htmlFile, html, 'utf8');
    fs.writeFileSync(jsonFile, JSON.stringify(mapData), 'utf8');
    res.json({
      storeId,
      cached: false,
      downloadedAt: new Date().toISOString(),
      mapData,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to download store map' });
  }
});

app.listen(PORT, () => {
  console.log(`Walmart Map Nav running at http://localhost:${PORT}`);
  console.log(`Cached stores: ${listCachedStores().join(', ') || '(none)'}`);
});
