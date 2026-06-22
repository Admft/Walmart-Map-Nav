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

for (const f of ['WalmartMapNav.bat', 'serve.ps1']) {
  const p = path.join(packDir, f);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function reportSuccess(label, file) {
  const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
  console.log(`\nSingle-file exe: ${file} (${mb} MB) [${label}]`);
  console.log('Double-click to run — no folder or install needed.');
}

// Try Go first (smallest exe)
try {
  execSync('go version', { stdio: 'ignore' });
  execSync(`go build -tags embed -ldflags="-s -w" -o "${exeOut}" .`, {
    cwd: path.join(root, 'launcher'),
    stdio: 'inherit',
  });
  reportSuccess('Go', exeOut);
  process.exit(0);
} catch {
  console.log('Go not installed — building with pkg instead...');
}

// Fallback: pkg bundles Node + app into one exe
try {
  const entry = path.join(root, 'launcher', 'portable-server.js');
  const pkgCmd = `npx --yes @yao-pkg/pkg "${entry}" --targets node20-win-x64 --output "${exeOut}" --compress GZip`;
  execSync(pkgCmd, { cwd: root, stdio: 'inherit' });
  reportSuccess('pkg', exeOut);
} catch {
  console.error('\nCould not build .exe');
  console.error('Option 1: Install Go from https://go.dev/dl/ and run npm run build:exe');
  console.error('Option 2: Use dist/WalmartMapNav.html instead (npm run build:html)');
  process.exit(1);
}
