const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spike', {
  config: () => ipcRenderer.invoke('spike:config'),
})
