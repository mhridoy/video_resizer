const { Menu } = require('electron');
function setupUpdates({ app, autoUpdater, portable = false, platform = process.platform, setTimer = setInterval }) {
  let status = `Version ${app.getVersion()}`, checking = false, ready = false;
  const enabled = app.isPackaged && platform === 'win32' && !portable;
  const render = () => Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit', label: 'Exit Binary Beat' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Updates', submenu: [
      { label: status, enabled: false },
      { label: 'Check for updates', enabled: enabled && !checking && !ready, click: check },
      { label: enabled ? 'Downloaded updates install when you exit' : 'Use the Setup installer for automatic updates', enabled: false }
    ] }
  ]));
  async function check() {
    if (!enabled || checking || ready) return;
    checking = true; status = 'Checking for updates…'; render();
    try { await autoUpdater.checkForUpdates(); }
    catch { status = 'Could not check — try again when online'; }
    finally { checking = false; render(); }
  }
  render();
  if (!enabled) return { check };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('update-available', info => { status = `Downloading version ${info.version}…`; render(); });
  autoUpdater.on('download-progress', info => { status = `Downloading update: ${Math.round(info.percent)}%`; render(); });
  autoUpdater.on('update-not-available', () => { status = `You're up to date (${app.getVersion()})`; render(); });
  autoUpdater.on('update-downloaded', info => { ready = true; status = `Version ${info.version} ready — installs on exit`; render(); });
  autoUpdater.on('error', () => { status = 'Update unavailable — check again later'; render(); });
  const timer = setTimer(check, 4 * 60 * 60 * 1000);
  timer.unref?.();
  check();
  return { check };
}
module.exports = { setupUpdates };
