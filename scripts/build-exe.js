const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist', 'WalmartMapNav');
const packDir = path.join(root, 'launcher', 'pack');
const exeOut = path.join(root, 'dist', 'WalmartMapNav.exe');

execSync('node scripts/build-standalone.js', { cwd: root, stdio: 'inherit' });

if (fs.existsSync(packDir)) fs.rmSync(packDir, { recursive: true, force: true });
fs.cpSync(dist, packDir, { recursive: true });

// Remove bat/ps1 from embedded pack — not needed inside exe
for (const f of ['WalmartMapNav.bat', 'serve.ps1']) {
  const p = path.join(packDir, f);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

try {
  execSync('go version', { stdio: 'ignore' });
  execSync(`go build -tags embed -ldflags="-s -w" -o "${exeOut}" .`, {
    cwd: path.join(root, 'launcher'),
    stdio: 'inherit',
  });
  const mb = (fs.statSync(exeOut).size / 1024 / 1024).toFixed(1);
  console.log(`\nSingle-file exe: ${exeOut} (${mb} MB)`);
  console.log('Upload just this one file to SharePoint — no folder needed.');
} catch {
  console.log('\nGo is not installed — could not build .exe');
  console.log('Install Go from https://go.dev/dl/ then run: npm run build:exe');
  process.exit(1);
}
