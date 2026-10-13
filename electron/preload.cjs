const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  pickInput: kind => ipcRenderer.invoke('pick-input', kind),
  pickOutput: () => ipcRenderer.invoke('pick-output'),
  start: (ids, options) => ipcRenderer.invoke('start-batch', ids, options),
  cancel: () => ipcRenderer.invoke('cancel-batch'),
  openOutput: () => ipcRenderer.invoke('open-output'),
  clear: () => ipcRenderer.invoke('clear-input'),
  platform: process.platform,
  fitVideo: (file, targetBytes, mute) => ipcRenderer.invoke('fit-video', webUtils.getPathForFile(file), targetBytes, mute === true),
  cancelFit: () => ipcRenderer.invoke('fit-cancel'),
  onFitProgress: fn => { const listener = (_event, value) => fn(value); ipcRenderer.on('fit-progress', listener); return () => ipcRenderer.removeListener('fit-progress', listener); },
  onEvent: fn => { const listener = (_event, data) => fn(data); ipcRenderer.on('batch-event', listener); return () => ipcRenderer.removeListener('batch-event', listener); },
});
