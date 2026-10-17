// The desktop shell. It does not contain the app: it starts the app's own server (src/server.ts, run by Electron's bundled Node) and shows the
// page it serves in a window, like the Mac stub (scripts/mac) does with a native one. The server stays what it is everywhere else: listening on
// 127.0.0.1 only, with the user's files in a folder of their own (ANAICO_DATA, ANAICO_WORKSPACE), never inside the program.
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const DEFAULT_PORT = Number(process.env.PORT ?? 3737);
const HOST = "127.0.0.1";

// In a checkout the app is the folder above this one; a packaged build puts it (and the creator at the pinned release) in resources/.
const appRoot = app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..");
const bundledCreator = app.isPackaged ? path.join(process.resourcesPath, "creator", "ts", "src") : null;

let server = null; // the child we started (null when we are showing a server that was already running)
let origin = "";
let quitting = false;
let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(main).catch((err) => fail(String(err && err.stack ? err.stack : err)));
}

function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", () => resolve(0));
    req.on("timeout", () => req.destroy());
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, HOST, () => probe.close(() => resolve(true)));
  });
}

async function waitUntilServing(url, child) {
  for (let i = 0; i < 120; i++) {
    if (child && child.exitCode !== null) throw new Error("The server stopped while starting. Its log is in " + logPath());
    if ((await get(url)) === 200) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The server did not answer within 30 seconds. Its log is in " + logPath());
}

const logPath = () => path.join(app.getPath("userData"), "server.log");

function stopServer() {
  if (!server || server.exitCode !== null) return;
  // Windows has no process groups to signal: taskkill /T ends the server and anything it started (a brain, a shell command).
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true });
  else server.kill("SIGTERM");
}

async function startServer() {
  const userData = app.getPath("userData");
  const data = path.join(userData, "data");
  const workspace = path.join(userData, "workspace");
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });

  // Already running (a second launch after the window was closed, or `anaico` in a terminal): show that one.
  const existing = `http://${HOST}:${DEFAULT_PORT}`;
  if ((await get(existing + "/")) === 200) return existing;

  let port = DEFAULT_PORT;
  while (!(await portFree(port))) port += 1; // a port that is taken by something else; the page's saved settings are per-port, but she still starts
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1", // Electron's own binary, running as plain Node
    PORT: String(port),
    ANAICO_DATA: data,
    ANAICO_WORKSPACE: workspace,
  };
  if (bundledCreator) env.CREATOR_SRC = bundledCreator;
  const log = fs.openSync(logPath(), "a");
  server = spawn(process.execPath, [path.join(appRoot, "src", "server.ts")], { cwd: appRoot, env, stdio: ["ignore", log, log], windowsHide: true });
  server.on("exit", (code) => {
    server = null;
    if (!quitting) fail(`The server stopped (exit code ${code}). Its log is in ${logPath()}`);
  });
  const url = `http://${HOST}:${port}`;
  await waitUntilServing(url + "/", server);
  return url;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 480,
    minHeight: 520,
    title: "Anaico",
    backgroundColor: "#1b1b22",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  const ours = (url) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  // Only her own page loads in the window; any other address opens in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (ours(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(["clipboard-sanitized-write", "fullscreen"].includes(permission) && ours(wc.getURL()));
  });
  win.on("closed", () => {
    win = null;
  });
  win.loadURL(origin + "/");
}

function buildMenu() {
  const template = [
    { label: "File", submenu: [{ label: "Open in Browser", click: () => shell.openExternal(origin + "/") }, { type: "separator" }, { role: "quit" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }])],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function main() {
  buildMenu();
  origin = await startServer();
  createWindow();
  app.on("activate", () => {
    if (!win) createWindow();
  });
}

function fail(message) {
  if (quitting) return;
  quitting = true;
  stopServer();
  dialog.showErrorBox("Anaico could not start", message);
  app.exit(1);
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  stopServer();
});
