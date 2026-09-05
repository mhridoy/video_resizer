const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  pickInput: kind => ipcRenderer.invoke('pick-input', kind),
  pickOutput: () => ipcRenderer.invoke('pick-output'),
  start: (ids, options) => ipcRenderer.invoke('start-batch', ids, options),
  cancel: () => ipcRenderer.invoke('cancel-batch'),
  openOutput: () => ipcRenderer.invoke('open-output'),
  clear: () => ipcRenderer.invoke('clear-input'),
  onEvent: fn => { const listener = (_event, data) => fn(data); ipcRenderer.on('batch-event', listener); return () => ipcRenderer.removeListener('batch-event', listener); },
});
