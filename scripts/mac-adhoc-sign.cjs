// electron-builder afterPack hook. Without an Apple certificate the Mac app is left with a
// broken signature once it is packaged, and macOS then calls the downloaded app "damaged".
// An ad-hoc signature keeps the bundle consistent: macOS shows the ordinary
// "unidentified developer" prompt instead (right-click → Open, or Privacy & Security → Open Anyway).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
