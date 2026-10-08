const { app, BrowserWindow, dialog, shell, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let worker, window;
function workspace() {
  if (!app.isPackaged) return __dirname;
  return JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'workspace.json'), 'utf8')).workspace;
}
const DEFAULT_PORT = 5173;
function health(port) {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/api/engine`, (res) => {
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
// A server that is already running for this project, found through the port it last recorded.
async function runningPort(root) {
  let port = DEFAULT_PORT;
  try {
    port = JSON.parse(fs.readFileSync(path.join(root, '.jobs', 'server.json'), 'utf8')).port;
  } catch {}
  return (await health(port)) ? port : null;
}
// Starts the server, which picks a free port, and resolves with that port once it is serving.
function startServer(root) {
  return new Promise((resolve, reject) => {
    let errors = '';
    worker = utilityProcess.fork(path.join(root, 'server.mjs'), [], { cwd: root, stdio: 'pipe' });
    worker.stdout?.on('data', () => {}); // Drain it so the server never blocks on a full pipe.
    worker.stderr?.on('data', (chunk) => {
      errors = (errors + chunk.toString()).slice(-2000);
      console.error(chunk.toString());
    });
    const timer = setTimeout(() => reject(Error('The local animation server did not start in time.')), 30000);
    worker.on('message', (message) => {
      if (!message?.port) return;
      clearTimeout(timer);
      resolve(message.port);
    });
    worker.on('exit', () => {
      clearTimeout(timer);
      const reason = errors.match(/Error: (.*)/)?.[1];
      reject(Error(reason || 'The local animation server stopped while starting.'));
    });
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
      const port = (await runningPort(root)) ?? (await startServer(root));
      const origin = `http://127.0.0.1:${port}`;
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
        if (new URL(url).origin !== origin) event.preventDefault();
      });
      await window.loadURL(origin);
    })
    .catch((error) => {
      dialog.showErrorBox('Animation Engine could not start', error.message);
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => worker?.kill());
}
