const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const storesSrc = path.join(root, 'stores');
const outHtml = path.join(root, 'dist', 'WalmartMapNav.html');
const tmpStores = path.join(root, 'dist', '_tmp_stores');

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
  if (!fs.existsSync(storesSrc)) return bundled;

  fs.mkdirSync(tmpStores, { recursive: true });
  execSync(`node "${path.join(__dirname, 'extract-store-json.js')}" "${storesSrc}" "${tmpStores}"`, {
    cwd: root,
    stdio: 'pipe',
  });

  for (const file of fs.readdirSync(tmpStores)) {
    if (!/^\d+\.json$/.test(file)) continue;
    const id = file.replace(/\.json$/, '');
    bundled[id] = JSON.parse(fs.readFileSync(path.join(tmpStores, file), 'utf8'));
  }
  fs.rmSync(tmpStores, { recursive: true, force: true });
  return bundled;
}

fs.mkdirSync(path.dirname(outHtml), { recursive: true });

const bundled = loadBundledStores();
const bundledIds = Object.keys(bundled).sort((a, b) => Number(a) - Number(b));

const mapParser = stripExports(fs.readFileSync(path.join(publicDir, 'map-parser.js'), 'utf8'));
const storeCache = bundleStoreCache();
const appJs = fs
  .readFileSync(path.join(publicDir, 'app.js'), 'utf8')
  .replace(/^import[\s\S]*?;\s*/gm, '');

const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
const body = fs
  .readFileSync(path.join(publicDir, 'index.html'), 'utf8')
  .replace(/<link rel="stylesheet" href="styles\.css" \/>/, '')
  .replace(
    /<p class="hint">[\s\S]*?<\/p>/,
    `<p class="hint">Open this file in Chrome or Edge. Built-in stores: <strong>${bundledIds.join(', ') || 'none'}</strong>. Use <strong>Import map file</strong> to add more.</p>`,
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
console.log(`Wrote ${outHtml} (${mb} MB, stores: ${bundledIds.join(', ')})`);
