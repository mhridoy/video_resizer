const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { BatchEngine, scanFolder } = require('./engine.cjs');
const { shipmentAI, cancelShipmentAI } = require('./shipment-ai.cjs');
const { SourceFolder } = require('./source-folder.cjs');
const sourceFolder = new SourceFolder();
const { FitVideo } = require('./fit-video.cjs');
let win, engine, fitter, outputBase, lastOutput, saveRoot;
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
  handle('pick-shipment-folder', async () => {
    if (sourceFolder.running) throw new Error('Wait for folder replacement to finish.');
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Choose shipment folder — prepared files replace originals here' });
    if (result.canceled) return null;
    return sourceFolder.open(result.filePaths[0]);
  });
  handle('read-shipment-file', (token, id) => sourceFolder.read(token, id));
  handle('replace-shipment-folder', (token, files) => sourceFolder.replace(token, files));
  handle('shipment-ai', shipmentAI);
  handle('shipment-ai-cancel', cancelShipmentAI);
  handle('cancel-batch', () => engine.cancel());
  handle('pick-save-folder', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose where to save the prepared files' });
    if (result.canceled) return '';
    saveRoot = result.filePaths[0];
    return saveRoot;
  });
  // The renderer never supplies a directory: it can only write under the folder picked above.
  handle('save-into-folder', async (relativeName, data) => {
    if (!saveRoot) throw new Error('Choose a folder first.');
    if (!(data instanceof Uint8Array)) throw new Error('Invalid file contents.');
    const relative = String(relativeName).split(/[\\/]/).filter(part => part && part !== '.' && part !== '..').join(path.sep);
    const target = path.join(saveRoot, relative);
    if (!relative || !target.startsWith(saveRoot + path.sep)) throw new Error('Invalid file name.');
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Flat exports can be saved beside the originals: never replace an existing file.
    try { await fs.writeFile(target, data, { flag: 'wx' }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`A file named ${path.basename(target)} already exists. Choose an empty output folder.`);
      throw error;
    }
    return target;
  });
  handle('open-save-folder', async () => { if (saveRoot) { const error = await shell.openPath(saveRoot); if (error) throw new Error(error); } });
  fitter = new FitVideo(binary);
  let fitting = false, fitEpoch = 0;
  handle('fit-video', async (file, targetBytes, mute, bytes) => {
    if (fitting || fitter.child) throw new Error('Wait for the current video.');
    if (typeof file !== 'string' || !Number.isSafeInteger(targetBytes) || targetBytes < 64 * 1024) throw new Error('Invalid video request.');
    fitting = true; const requestEpoch = fitEpoch;
    let temporary;
    try {
      if (bytes !== undefined) {
        if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 1024 ** 3) throw new Error('Invalid ZIP video contents (maximum 1 GB).');
        const extension = path.extname(file).toLowerCase();
        if (!/^\.(mp4|mov|mkv|avi|webm|m4v|mpeg|mpg|3gp|ts|mts|m2ts|wmv|flv|vob|ogv)$/.test(extension)) throw new Error('Unsupported video extension.');
        temporary = await fs.mkdtemp(path.join(app.getPath('temp'), 'binary-beat-import-'));
        file = path.join(temporary, `input${extension}`);
        await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      }
      if (requestEpoch !== fitEpoch) throw new Error('Cancelled');
      const result = await fitter.fit(file, targetBytes, { mute: mute === true }, progress => { if (!win.isDestroyed()) win.webContents.send('fit-progress', progress); });
      return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
    } finally { fitting = false; if (temporary) await fs.rm(temporary, { recursive: true, force: true }); }
  });
  handle('fit-cancel', () => { ++fitEpoch; fitter.cancel(); });
  handle('open-output', async () => { if (lastOutput) { const error = await shell.openPath(lastOutput); if (error) throw new Error(error); } });
  handle('clear-input', () => { if (!engine.running) selected.clear(); });
  function createWindow() {
    win = new BrowserWindow({ width: 1240, height: 840, minWidth: 720, minHeight: 600, backgroundColor: '#f8f9fc', title: 'Binary Beat', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('close', event => {
      if (sourceFolder.running) { event.preventDefault(); return; }
      if (engine.running || fitter?.child) {
        const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep converting', 'Cancel and close'], defaultId: 0, cancelId: 0, message: 'A batch is still running. Cancel it and close?' });
        if (choice === 0) event.preventDefault(); else { engine.cancel(); fitter?.cancel(); }
      }
    });
    win.loadURL(page);
  }
  createWindow();
  const { autoUpdater } = require('electron-updater');
  require('./updates.cjs').setupUpdates({ app, autoUpdater, portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR) });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { engine?.cancel(); fitter?.cancel(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { cancelShipmentAI(); engine?.cancel(); fitter?.cancel(); });
