// Ponte segura entre a interface e o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  confirmUnsaved: (name) => ipcRenderer.invoke('app:confirm-unsaved', name),
  ready: () => ipcRenderer.send('app:ready'),
  closeConfirmed: () => ipcRenderer.send('app:close-confirmed'),
  setTitle: (t) => ipcRenderer.send('app:set-title', t),
  openPreview: (data) => ipcRenderer.send('preview:open', data),
  getPreviewData: () => ipcRenderer.invoke('preview:get-data'),
  onMenuAction: (fn) => ipcRenderer.on('menu:action', (_e, id) => fn(id)),
  onCloseRequested: (fn) => ipcRenderer.on('app:close-requested', () => fn()),
});
