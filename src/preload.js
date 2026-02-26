const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  probeFile: (filePath) => ipcRenderer.invoke('probe-file', filePath),
  convert: (args) => ipcRenderer.invoke('convert', args),
  cancelConvert: () => ipcRenderer.invoke('cancel-convert'),
  getFilePath: (file) => webUtils.getPathForFile(file),
  onProgress: (callback) => {
    ipcRenderer.on('progress', (_event, data) => callback(data));
  },
});
