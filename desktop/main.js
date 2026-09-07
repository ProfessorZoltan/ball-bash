// Deflector for the desktop: an Electron window around the game, with the
// game's own server (server.js) running alongside it so a same-Wi-Fi match
// can be hosted straight from the app. Online play still goes through the
// relay the game is configured with; nothing here changes the game itself.
//
//   npm start        run from a checkout (the game files are one folder up)
//   npm run build    installer + portable .exe in dist/ (see the README)
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

// A fixed port keeps the page's origin, and with it the game's saved settings
// and campaign progress, the same from one launch to the next. The next few
// ports are tried when it is taken.
const PORT = 27411;
const PORT_TRIES = 10;

// Where index.html and server.js live: next to this folder in a checkout,
// under resources/game in a packaged build (see extraResources in package.json).
const GAME_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'game') : path.join(__dirname, '..');

let win = null;
let server = null;
let port = PORT; // the port actually in use
let quitting = false;

// Only one copy runs; launching a second one focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.setAppUserModelId('io.github.professorzoltan.deflector');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.whenReady().then(main).catch((err) => {
    dialog.showErrorBox('Deflector could not start', String((err && err.message) || err));
    app.quit();
  });
}

async function main() {
  Menu.setApplicationMenu(null);
  port = await pickPort();
  server = startServer(port);
  await waitForServer(port);
  createWindow(port);
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

async function pickPort() {
  for (let p = PORT; p < PORT + PORT_TRIES; p++) if (await portFree(p)) return p;
  throw new Error(`Ports ${PORT} to ${PORT + PORT_TRIES - 1} are all in use.`);
}

/** Run server.js as a plain Node process (the Electron binary doubles as Node). */
function startServer(port) {
  const child = spawn(process.execPath, [path.join(GAME_ROOT, 'server.js'), String(port)], {
    cwd: GAME_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  child.on('exit', (code, signal) => {
    server = null;
    if (quitting) return;
    dialog.showErrorBox('Deflector stopped', `The game server exited (${signal || code}). Please start the game again.`);
    app.quit();
  });
  return child;
}

function waitForServer(port, tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry(left);
      });
      req.on('error', () => retry(left));
      req.on('timeout', () => req.destroy());
    };
    const retry = (left) => {
      if (left <= 0 || !server) reject(new Error('The game server did not start.'));
      else setTimeout(() => attempt(left - 1), 100);
    };
    attempt(tries);
  });
}

function createWindow(port) {
  const origin = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 420,
    show: false,
    title: 'Deflector',
    backgroundColor: '#03050c',
    autoHideMenuBar: true,
    icon: path.join(GAME_ROOT, 'icons', 'icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.on('closed', () => {
    win = null;
  });
  // Links to anywhere else (the README, the relay's page) open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(origin)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  // There is no menu bar, so the usual window shortcuts are handled here. The
  // game's own F key and Fullscreen button keep working too.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
  win.loadURL(`${origin}/`);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  if (server) server.kill();
});
app.on('activate', () => {
  if (!win && server) createWindow(port);
});
