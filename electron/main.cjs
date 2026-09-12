const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { BatchEngine, scanFolder } = require('./engine.cjs');
let win, engine, outputBase, lastOutput;
const selected = new Map();
const page = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('Untrusted request.');
    return fn(...args);
  });
}
app.whenReady().then(async () => {
  const { isVideo } = await import('../shared/options.mjs');
  const binary = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
  engine = new BatchEngine(binary, event => { if (win && !win.isDestroyed()) win.webContents.send('batch-event', event); });
  handle('pick-input', async kind => {
    if (engine.running) throw new Error('Wait for the current batch.');
    const result = await dialog.showOpenDialog(win, { properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'] });
    if (result.canceled) return [];
    const files = kind === 'folder' ? await scanFolder(result.filePaths[0]) : (await Promise.all(result.filePaths.filter(isVideo).map(async file => ({ id: randomUUID(), path: file, name: path.basename(file), size: (await fs.stat(file)).size }))));
    // IDs are the only input handles exposed to the renderer.
    for (const file of files) selected.set(file.id, file);
    return files.map(({ path: ignored, ...rest }) => rest);
  });
  handle('pick-output', async () => {
    if (engine.running) throw new Error('Wait for the current batch.');
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (!result.canceled) outputBase = result.filePaths[0];
    return outputBase;
  });
  handle('start-batch', async (ids, options) => {
    if (!Array.isArray(ids) || !ids.length || engine.running) throw new Error('Select videos or wait for the current batch.');
    const files = [...new Set(ids)].map(id => { if (!selected.has(id)) throw new Error('Unknown video.'); return selected.get(id); });
    lastOutput = path.join(outputBase || app.getPath('videos'), `Video Resizer Output ${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
    engine.run(files, lastOutput, options).catch(error => { if (!win.isDestroyed()) win.webContents.send('batch-event', { type: 'fatal', error: error.message }); });
    return lastOutput;
  });
  handle('cancel-batch', () => engine.cancel());
  handle('open-output', async () => { if (lastOutput) { const error = await shell.openPath(lastOutput); if (error) throw new Error(error); } });
  handle('clear-input', () => { if (!engine.running) selected.clear(); });
  function createWindow() {
    win = new BrowserWindow({ width: 1240, height: 840, minWidth: 720, minHeight: 600, backgroundColor: '#f8f9fc', title: 'Binary Beat', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('close', event => {
      if (engine.running) {
        const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep converting', 'Cancel and close'], defaultId: 0, cancelId: 0, message: 'A batch is still running. Cancel it and close?' });
        if (choice === 0) event.preventDefault(); else engine.cancel();
      }
    });
    win.loadURL(page);
  }
  createWindow();
  const { autoUpdater } = require('electron-updater');
  require('./updates.cjs').setupUpdates({ app, autoUpdater, portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR) });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { engine?.cancel(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => engine?.cancel());
