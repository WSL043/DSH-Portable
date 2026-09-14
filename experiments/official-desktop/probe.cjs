// Isolated Electron substrate probe, NOT a build of the official DSH desktop.
const { app, BrowserWindow, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const output = process.env.PORTABLE_PROBE_OUTPUT;
if (!output || !process.env.DSH_HOME) throw new Error('Explicit probe paths are required');
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.whenReady().then(async () => {
  protocol.handle('dsh-app', () => new Response('<!doctype html><title>Isolated probe</title>'));
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('dsh-app://probe/');
  const before = await window.webContents.executeJavaScript('localStorage.getItem("portable-probe")');
  await window.webContents.executeJavaScript('localStorage.setItem("portable-probe", "synthetic-test-value")');
  const cookiesBefore = await session.defaultSession.cookies.get({ url: 'dsh-app://probe/' });
  let cookieError;
  try {
    await session.defaultSession.cookies.set({ url: 'dsh-app://probe/', name: 'portable-probe', value: 'synthetic-cookie', expirationDate: Date.now() / 1000 + 3600 });
  } catch (error) { cookieError = error.message; }
  await session.defaultSession.cookies.flushStore();
  session.defaultSession.flushStorageData();
  const paths = Object.fromEntries(['userData', 'sessionData', 'logs', 'crashDumps'].map(key => [key, app.getPath(key)]));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ electron: process.versions.electron, isPackaged: app.isPackaged,
    paths, dshHome: process.env.DSH_HOME, before, cookiesBefore, cookieError, visible: window.isVisible() }, null, 2));
  window.destroy();
  app.quit();
}).catch(error => { fs.writeFileSync(output, JSON.stringify({ error: error.message })); app.exit(1); });
