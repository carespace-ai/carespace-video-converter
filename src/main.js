const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { convertToWebM, convertToHEVC, probeFile } = require('./converter');

let mainWindow;
let activeCommand = null;
let activeOutputPath = null;

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

function cleanupPartialFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // best-effort cleanup
  }
}

ipcMain.handle('convert', async (_event, { filePath, outputDir, options }) => {
  const baseName = path.basename(filePath, path.extname(filePath));
  const results = [];

  if (options.webm) {
    const outPath = path.join(outputDir, `${baseName}.webm`);
    activeOutputPath = outPath;
    try {
      const { promise, command } = convertToWebM(filePath, outPath, options, (progress) => {
        mainWindow.webContents.send('progress', { filePath, format: 'webm', progress });
      });
      activeCommand = command;
      await promise;
      results.push({ format: 'webm', path: outPath, success: true });
    } catch (err) {
      cleanupPartialFile(outPath);
      results.push({ format: 'webm', path: outPath, success: false, error: err.message });
    } finally {
      activeCommand = null;
      activeOutputPath = null;
    }
  }

  if (options.hevc) {
    const outPath = path.join(outputDir, `${baseName}_safari.mov`);
    activeOutputPath = outPath;
    try {
      const { promise, command } = convertToHEVC(filePath, outPath, options, (progress) => {
        mainWindow.webContents.send('progress', { filePath, format: 'hevc', progress });
      });
      activeCommand = command;
      await promise;
      results.push({ format: 'hevc', path: outPath, success: true });
    } catch (err) {
      cleanupPartialFile(outPath);
      results.push({ format: 'hevc', path: outPath, success: false, error: err.message });
    } finally {
      activeCommand = null;
      activeOutputPath = null;
    }
  }

  return results;
});

ipcMain.handle('cancel-convert', async () => {
  if (activeCommand) {
    activeCommand.kill('SIGKILL');
    cleanupPartialFile(activeOutputPath);
    activeCommand = null;
    activeOutputPath = null;
  }
});
