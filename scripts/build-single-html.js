const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const storesSrc = path.join(root, 'stores');
const outHtml = path.join(root, 'dist', 'WalmartMapNav.html');
const manifestPath = path.join(storesSrc, 'bundled-store-ids.json');

function stripExports(code) {
  return code.replace(/^export /gm, '');
}

function bundleStoreCache() {
  const code = stripExports(fs.readFileSync(path.join(publicDir, 'store-cache.js'), 'utf8'));
  return `${code}
const storeCache = { listCachedStores, getStore, putStore };
`;
}

function loadBundledStores() {
  const bundled = {};
  if (!fs.existsSync(manifestPath)) return bundled;

  const ids = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const id of ids) {
    const jsonPath = path.join(storesSrc, `${id}.json`);
    if (!fs.existsSync(jsonPath)) {
      console.warn(`Missing store ${id}.json — run: node scripts/download-stores.js`);
      continue;
    }
    bundled[id] = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  }
  return bundled;
}

function formatStoreHint(ids) {
  if (!ids.length) return 'none';
  if (ids.length <= 12) return ids.join(', ');
  return `${ids.length} stores (${ids.slice(0, 8).join(', ')}…)`;
}

fs.mkdirSync(path.dirname(outHtml), { recursive: true });

const bundled = loadBundledStores();
const bundledIds = Object.keys(bundled).sort((a, b) => Number(a) - Number(b));

const mapParser = stripExports(fs.readFileSync(path.join(publicDir, 'map-parser.js'), 'utf8'));
const storeCache = bundleStoreCache();
const appJs = fs
  .readFileSync(path.join(publicDir, 'app.js'), 'utf8')
  .replace(/^import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\s*/gm, '');

const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
const body = fs
  .readFileSync(path.join(publicDir, 'index.html'), 'utf8')
  .replace(/<link rel="stylesheet" href="styles\.css" \/>/, '')
  .replace(
    /<p class="hint">[\s\S]*?<\/p>/,
    `<p class="hint">Open this file in Chrome or Edge. Built-in stores: <strong>${formatStoreHint(bundledIds)}</strong>. Use <strong>Import map file</strong> to add more.</p>`,
  )
  .replace(
    /<script type="module" src="app\.js"><\/script>/,
    `<script>
window.STANDALONE_HTML = true;
window.BUNDLED_STORES = ${JSON.stringify(bundled)};
${mapParser}
${storeCache}
${appJs}
</script>`,
  );

const html = body.replace('</head>', `<style>\n${css}\n</style>\n</head>`);

fs.writeFileSync(outHtml, html);
const mb = (fs.statSync(outHtml).size / 1024 / 1024).toFixed(2);
console.log(`Wrote ${outHtml} (${mb} MB, ${bundledIds.length} stores)`);
if (bundledIds.length < JSON.parse(fs.readFileSync(manifestPath, 'utf8')).length) {
  console.warn('Some stores missing — run: node scripts/download-stores.js');
}
