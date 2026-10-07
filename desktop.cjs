const { app, BrowserWindow, dialog, shell, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let worker, window;
function workspace() {
  if (!app.isPackaged) return __dirname;
  return JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'workspace.json'), 'utf8')).workspace;
}
function health() {
  return new Promise((resolve) => {
    const request = http.get('http://127.0.0.1:5173/api/engine', (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).engine === 'LTX-Video · local GPU');
        } catch {
          resolve(false);
        }
      });
    });
    request.setTimeout(1000, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      const root = workspace();
      if (!fs.existsSync(path.join(root, 'server.mjs')))
        throw Error('The project folder has moved. Rebuild the Mac app from its new location.');
      if (!(await health())) {
        worker = utilityProcess.fork(path.join(root, 'server.mjs'), [], { cwd: root, stdio: 'pipe' });
        worker.stderr?.on('data', (chunk) => console.error(chunk.toString()));
        let ready = false;
        for (let i = 0; i < 100; i++) {
          if (await health()) {
            ready = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!ready)
          throw Error('The local animation server could not start. Check whether port 5173 is in use.');
      }
      window = new BrowserWindow({
        width: 1360,
        height: 920,
        minWidth: 760,
        minHeight: 600,
        title: 'Animation Engine',
        backgroundColor: '#0c0f14',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) shell.openExternal(url);
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (event, url) => {
        if (new URL(url).origin !== 'http://127.0.0.1:5173') event.preventDefault();
      });
      await window.loadURL('http://127.0.0.1:5173');
    })
    .catch((error) => {
      dialog.showErrorBox('Animation Engine could not start', error.message);
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => worker?.kill());
}
