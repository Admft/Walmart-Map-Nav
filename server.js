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

function listCachedStores() {
  return fs
    .readdirSync(STORES_DIR)
    .filter((f) => /^\d+\.html$/.test(f))
    .map((f) => f.replace(/\.html$/, ''))
    .sort((a, b) => Number(a) - Number(b));
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
  const file = storePath(storeId);
  if (!force && fs.existsSync(file)) {
    const html = fs.readFileSync(file, 'utf8');
    const stat = fs.statSync(file);
    res.json({
      storeId,
      cached: true,
      downloadedAt: stat.mtime.toISOString(),
      html,
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
    fs.writeFileSync(file, html, 'utf8');
    res.json({
      storeId,
      cached: false,
      downloadedAt: new Date().toISOString(),
      html,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to download store map' });
  }
});

app.listen(PORT, () => {
  console.log(`Walmart Map Nav running at http://localhost:${PORT}`);
  console.log(`Cached stores: ${listCachedStores().join(', ') || '(none)'}`);
});
