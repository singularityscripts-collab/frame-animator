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
  exportBegin: (opts) => ipcRenderer.invoke('export:begin', opts),
  exportFrame: (id, data) => ipcRenderer.invoke('export:frame', id, data),
  exportEnd: (id) => ipcRenderer.invoke('export:end', id),
  exportCancel: (id) => ipcRenderer.invoke('export:cancel', id),
  showInFolder: (p) => ipcRenderer.send('shell:show', p),
  onMenuAction: (fn) => ipcRenderer.on('menu:action', (_e, id) => fn(id)),
  onCloseRequested: (fn) => ipcRenderer.on('app:close-requested', () => fn()),
});
