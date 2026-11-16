// Ponte da janela "Testar filme": só lê o documento a tocar.
// Os scripts do documento rodam nesta janela, então ela não recebe nada que grave arquivos.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPreviewData: () => ipcRenderer.invoke('preview:get-data'),
});
