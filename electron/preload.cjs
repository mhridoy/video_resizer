const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  pickInput: kind => ipcRenderer.invoke('pick-input', kind),
  pickOutput: () => ipcRenderer.invoke('pick-output'),
  start: (ids, options) => ipcRenderer.invoke('start-batch', ids, options),
  cancel: () => ipcRenderer.invoke('cancel-batch'),
  openOutput: () => ipcRenderer.invoke('open-output'),
  clear: () => ipcRenderer.invoke('clear-input'),
  platform: process.platform,
  pickShipmentFolder: () => ipcRenderer.invoke('pick-shipment-folder'),
  readShipmentFile: (token, id) => ipcRenderer.invoke('read-shipment-file', token, id),
  replaceShipmentFolder: (token, files) => ipcRenderer.invoke('replace-shipment-folder', token, files),
  shipmentAI: (body, accessCode) => ipcRenderer.invoke('shipment-ai', body, accessCode),
  cancelShipmentAI: () => ipcRenderer.invoke('shipment-ai-cancel'),
  fitVideo: async (file, targetBytes, mute) => {
    const filePath = webUtils.getPathForFile(file);
    if (!filePath && file.size > 1024 ** 3) throw new Error('ZIP videos above 1 GB must be extracted and imported as files.');
    return ipcRenderer.invoke('fit-video', filePath || file.name, targetBytes, mute === true, filePath ? undefined : new Uint8Array(await file.arrayBuffer()));
  },
  cancelFit: () => ipcRenderer.invoke('fit-cancel'),
  onFitProgress: fn => { const listener = (_event, value) => fn(value); ipcRenderer.on('fit-progress', listener); return () => ipcRenderer.removeListener('fit-progress', listener); },
  pickSaveFolder: () => ipcRenderer.invoke('pick-save-folder'),
  saveInto: (name, data) => ipcRenderer.invoke('save-into-folder', name, data),
  openSaveFolder: () => ipcRenderer.invoke('open-save-folder'),
  onEvent: fn => { const listener = (_event, data) => fn(data); ipcRenderer.on('batch-event', listener); return () => ipcRenderer.removeListener('batch-event', listener); },
});
