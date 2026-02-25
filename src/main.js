const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { convertToWebM, convertToHEVC, probeFile } = require('./converter');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 620,
    minWidth: 600,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC Handlers ──

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select ProRes 4444 .mov files',
    filters: [{ name: 'QuickTime Movie', extensions: ['mov'] }],
    properties: ['openFile', 'multiSelections'],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select output directory',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('probe-file', async (_event, filePath) => {
  return probeFile(filePath);
});

ipcMain.handle('convert', async (_event, { filePath, outputDir, options }) => {
  const baseName = path.basename(filePath, path.extname(filePath));
  const results = [];

  if (options.webm) {
    const outPath = path.join(outputDir, `${baseName}.webm`);
    try {
      await convertToWebM(filePath, outPath, options, (progress) => {
        mainWindow.webContents.send('progress', { filePath, format: 'webm', progress });
      });
      results.push({ format: 'webm', path: outPath, success: true });
    } catch (err) {
      results.push({ format: 'webm', path: outPath, success: false, error: err.message });
    }
  }

  if (options.hevc) {
    const outPath = path.join(outputDir, `${baseName}_safari.mov`);
    try {
      await convertToHEVC(filePath, outPath, options, (progress) => {
        mainWindow.webContents.send('progress', { filePath, format: 'hevc', progress });
      });
      results.push({ format: 'hevc', path: outPath, success: true });
    } catch (err) {
      results.push({ format: 'hevc', path: outPath, success: false, error: err.message });
    }
  }

  return results;
});
