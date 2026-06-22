const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist', 'WalmartMapNav');
const publicDir = path.join(root, 'public');
const storesSrc = path.join(root, 'stores');

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (fs.statSync(from).isDirectory()) copyDir(from, to);
    else copyFile(from, to);
  }
}

if (fs.existsSync(dist)) fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

copyDir(publicDir, dist);
copyFile(path.join(root, 'launcher', 'serve.ps1'), path.join(dist, 'serve.ps1'));
copyFile(path.join(root, 'launcher', 'WalmartMapNav.bat'), path.join(dist, 'WalmartMapNav.bat'));

const distStores = path.join(dist, 'stores');
fs.mkdirSync(distStores, { recursive: true });

if (fs.existsSync(storesSrc)) {
  execSync(`node "${path.join(__dirname, 'extract-store-json.js')}" "${storesSrc}" "${distStores}"`, {
    stdio: 'inherit',
    cwd: root,
  });
}

const bundled = fs
  .readdirSync(distStores)
  .filter((f) => /^\d+\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ''))
  .sort((a, b) => Number(a) - Number(b));

fs.writeFileSync(path.join(distStores, 'manifest.json'), JSON.stringify({ stores: bundled }, null, 2));

const goDir = path.join(root, 'launcher');
if (fs.existsSync(path.join(goDir, 'main.go'))) {
  try {
    execSync('go version', { stdio: 'ignore' });
    execSync(`go build -ldflags="-s -w" -o "${path.join(dist, 'WalmartMapNav.exe')}" .`, {
      cwd: goDir,
      stdio: 'inherit',
    });
    console.log('Built WalmartMapNav.exe');
  } catch {
    console.log('Go not installed — skipped .exe (use WalmartMapNav.bat instead)');
  }
}

console.log(`\nStandalone app ready: ${dist}`);
console.log('Double-click WalmartMapNav.bat or WalmartMapNav.exe to run.');
