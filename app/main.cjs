// The desktop shell. It does not contain the app: it starts the app's own server (src/server.ts, run by Electron's bundled Node) and shows the
// page it serves in a window (Windows and macOS). The server stays what it is everywhere else: listening on
// 127.0.0.1 only, with the user's files in a folder of their own (ANAICO_DATA, ANAICO_WORKSPACE), never inside the program.
const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const https = require("node:https");
const path = require("node:path");
const { TAGS_URL, RELEASES_URL, isNewer, newestTag, dueNow } = require("./update-check.cjs");

const DEFAULT_PORT = Number(process.env.PORT ?? 3737);
const HOST = "127.0.0.1";

// In a checkout the app is the folder above this one; a packaged build puts it (and the creator at the pinned release) in resources/. Not named
// "app": Electron takes resources/app for its own program.
const appRoot = app.isPackaged ? path.join(process.resourcesPath, "anaico-app") : path.join(__dirname, "..");
const bundledCreator = app.isPackaged ? path.join(process.resourcesPath, "creator", "ts", "src") : null;

let server = null; // the child we started (null when we are showing a server that was already running)
let origin = "";
let quitting = false;
let win = null;
let tray = null; // kept in a variable so it is not garbage collected, which would remove the icon
const iconPath = path.join(__dirname, "build", "icon.png");
const isMac = process.platform === "darwin";
// X11 drops a window icon of 255 px or more (_NET_WM_ICON stays empty, issue 25), so Linux gets the 512 px file at 128 px.
const windowIcon = () => {
  const image = nativeImage.createFromPath(iconPath);
  return process.platform === "linux" ? image.resize({ width: 128, height: 128, quality: "best" }) : image;
};
// One window class for every window (the main one and the dialogs), the one the AppImage's launcher entry names as StartupWMClass (app/package.json).
if (process.platform === "linux") {
  app.commandLine.appendSwitch("class", "anime-ai-companion");
  app.commandLine.appendSwitch("name", "anime-ai-companion"); // the window instance, which stayed "anaico" (issue 26); if Chromium ignores it, only the class is set
}

// A Finder-launched app gets a bare PATH, so the server would not find claude, opencode, cursor-agent or ollama. Ask the user's own login shell for its PATH
// (a marker line, because start-up files may print other things) and add the usual install places in case that fails.
function macPath() {
  const home = app.getPath("home");
  let fromShell = "";
  try {
    const out = spawnSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "\\nANAICO_PATH=%s\\n" "$PATH"'], { encoding: "utf8", timeout: 5000 }).stdout || "";
    fromShell = (out.match(/^ANAICO_PATH=(.*)$/m) || [])[1] || "";
  } catch {}
  const usual = [".local/bin", ".opencode/bin", ".claude/local", ".npm-global/bin"].map((d) => path.join(home, d)).concat(["/opt/homebrew/bin", "/usr/local/bin"]);
  return [fromShell, ...usual, process.env.PATH || ""].filter(Boolean).join(":");
}

// --version and --help answer on the terminal and leave, before a window, the single-instance lock or the server.
const cliAnswer = process.argv.slice(1).find((a) => a === "--version" || a === "-v" || a === "--help" || a === "-h");
if (cliAnswer) {
  const version = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8")).version;
    } catch {
      return "unknown";
    }
  })();
  process.stdout.write(
    cliAnswer === "--version" || cliAnswer === "-v"
      ? `Anime AI Companion ${version}\n`
      : `Anime AI Companion ${version}\n\nStarts the desktop app. Its settings are in the app's user-data folder; the page is served on http://127.0.0.1:${DEFAULT_PORT}.\n  --version, -v   print the version and exit\n  --help, -h      print this and exit\n  --no-sandbox    start without Chromium's sandbox (Linux, when it is refused)\n`,
  );
  process.exit(0);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
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
    ANAICO_UPDATES_FILE: updateFile(), // the server reads the answer to the update question (auto, packs) from here each time, so File, Options takes effect at once
    ANAICO_PARENT_RESTARTS: "1", // /restart exits 75 and this shell starts the server again, on the same port
  };
  if (isMac) env.PATH = macPath();
  if (bundledCreator) env.CREATOR_SRC = bundledCreator;
  const log = fs.openSync(logPath(), "a");
  const launch = { args: [path.join(appRoot, "src", "server.ts")], env };
  server = spawn(process.execPath, launch.args, { cwd: appRoot, env: launch.env, stdio: ["ignore", log, log], windowsHide: true });
  watchServer(launch);
  function watchServer(spawned) {
    server.on("exit", (code) => {
      server = null;
      // 75 is RESTART_EXIT in src/restart.ts: the page's /restart, so start the same server again.
      if (code === 75 && !quitting) {
        const next = fs.openSync(logPath(), "a");
        server = spawn(process.execPath, spawned.args, { cwd: appRoot, env: spawned.env, stdio: ["ignore", next, next], windowsHide: true });
        watchServer(spawned);
        return;
      }
      if (!quitting) fail(`The server stopped (exit code ${code}). Its log is in ${logPath()}`);
    });
  }
  const url = `http://${HOST}:${port}`;
  await waitUntilServing(url + "/", server);
  return url;
}

/** A question or notice that belongs to the app's window: modal to it while it is showing, so it cannot end up behind it (a separate dialog window is easy to lose). */
// Every dialog carries the app icon: a Linux dialog without one shows a generic icon in window lists and docks (issue 26).
const askUser = (options) => {
  const withIcon = { icon: windowIcon(), ...options };
  return win && !win.isDestroyed() && win.isVisible() ? dialog.showMessageBox(win, withIcon) : dialog.showMessageBox(withIcon);
};

// --- Update notices: notify only. Off until the user agrees (the one request this shell makes on its own, so it says who is contacted first). ---
const updateFile = () => path.join(app.getPath("userData"), "updates.json");
function readUpdateSettings() {
  try {
    return JSON.parse(fs.readFileSync(updateFile(), "utf8"));
  } catch {
    return {};
  }
}
function writeUpdateSettings(patch) {
  const next = { ...readUpdateSettings(), ...patch };
  fs.writeFileSync(updateFile(), JSON.stringify(next));
  return next;
}
const runningVersion = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8")).version;
  } catch {
    return app.getVersion();
  }
};
function fetchTags() {
  return new Promise((resolve, reject) => {
    const req = https.get(TAGS_URL, { headers: { "User-Agent": "anaico-desktop", Accept: "application/vnd.github+json" }, timeout: 10000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode === 403 || res.statusCode === 429) return reject(new Error("GitHub is limiting requests from this network right now. Try again later."));
        if (res.statusCode !== 200) return reject(new Error("GitHub answered " + res.statusCode));
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("no answer from GitHub")));
  });
}
// manual: the user asked, so say the result either way. Automatic: speak only when there is something new.
async function checkForUpdates(manual) {
  try {
    const latest = newestTag(await fetchTags());
    writeUpdateSettings({ lastCheck: Date.now() });
    const current = runningVersion();
    if (latest && isNewer(latest, current)) {
      const { response } = await askUser({
        type: "info",
        title: "Anime AI Companion",
        message: `Anime AI Companion ${latest.replace(/^v/, "")} is available`,
        detail: `You have ${current}. Nothing is downloaded or installed for you: the button opens the releases page in your browser.`,
        buttons: ["Open releases page", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) shell.openExternal(RELEASES_URL);
    } else if (manual) {
      await askUser({ type: "info", title: "Anime AI Companion", message: "Anime AI Companion is up to date", detail: `You have ${current}.`, buttons: ["OK"] });
    }
  } catch (err) {
    if (manual) dialog.showErrorBox("Could not check for updates", String(err && err.message ? err.message : err));
  }
}
/** The separate question for the picture-pack list, which the first-start question did not include: asked once, and only to someone who has update checks on. */
async function askAboutPackUpdates() {
  writeUpdateSettings({ packsAsked: true });
  const { response } = await askUser({
    type: "question",
    title: "Anime AI Companion",
    message: "Also look for picture-pack updates?",
    detail:
      "Besides the version number, Anime AI Companion could ask GitHub Pages (rhedak.github.io) about once a day for the list of picture packs, to see whether packs you have downloaded have newer versions. " +
      "GitHub sees your IP address and that this app asked; nothing else is sent. Nothing is downloaded for you: a newer pack is only offered, and the app asks first.",
    buttons: ["Check packs too", "No thanks"],
    defaultId: 1,
    cancelId: 1,
  });
  writeUpdateSettings({ packs: response === 0 });
}
async function offerUpdateChecks() {
  const settings = readUpdateSettings();
  // Ask once the window has its page, so the question opens over a finished window (and modal to it) instead of beside an empty one.
  if (win && !win.isDestroyed() && win.webContents.isLoading()) {
    await new Promise((resolve) => {
      win.webContents.once("did-finish-load", resolve);
      setTimeout(resolve, 8000);
    });
  }
  // Asked once: the question is marked as asked before it is shown, so closing the app with it open does not bring it back at every start.
  if (typeof settings.auto !== "boolean" && !settings.asked) {
    writeUpdateSettings({ asked: true });
    const { response } = await askUser({
      type: "question",
      title: "Anime AI Companion",
      message: "Tell me when a new version is out?",
      detail:
        "About once a day Anime AI Companion would ask GitHub (api.github.com) for the newest version number, and GitHub Pages (rhedak.github.io) for the list of picture packs, to see whether packs you have downloaded have newer versions. " +
        "GitHub sees your IP address and that this app asked; nothing else is sent. " +
        "Nothing is downloaded or installed for you: a newer pack is only offered, and the app asks first. You can change this later under File, Options.",
      buttons: ["Check for updates", "No thanks"],
      defaultId: 1,
      cancelId: 1,
    });
    writeUpdateSettings({ auto: response === 0, packs: response === 0, packsAsked: true });
    buildMenu(); // so the Help menu's tick matches
  } else if (settings.auto === true && typeof settings.packs !== "boolean" && !settings.packsAsked) {
    await askAboutPackUpdates(); // said yes before the pack list was part of it: that yes was to the version number only
  }
  if (dueNow(readUpdateSettings())) checkForUpdates(false);
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Closing the window hides it: she and her server keep running, and the tray icon brings the window back. Quit in the tray menu (or the File menu)
// really quits and stops the server. The first time, a notice says where she went.
function hideToTray() {
  win.hide();
  const flag = path.join(app.getPath("userData"), ".tray-notice-shown");
  if (process.platform === "win32" && tray && !fs.existsSync(flag)) {
    fs.writeFileSync(flag, "");
    tray.displayBalloon({ iconType: "info", title: "Anime AI Companion is still running", content: "She is in the tray. Click the icon to bring the window back, or right-click it to quit." });
  }
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: isMac ? 18 : 32, height: isMac ? 18 : 32, quality: "best" }));
  tray.setToolTip("Anime AI Companion");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Anime AI Companion", click: showWindow },
      { label: "Open in Browser", click: () => shell.openExternal(origin + "/") },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
  tray.on("click", showWindow);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 480,
    minHeight: 520,
    title: "Anime AI Companion",
    icon: windowIcon(),
    backgroundColor: "#1b1b22",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  // The constructor option alone left _NET_WM_ICON empty on Linux (issue 18); setting it on the live window sets the property.
  if (process.platform === "linux") win.setIcon(windowIcon());
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
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    hideToTray();
  });
  win.on("closed", () => {
    win = null;
  });
  win.loadURL(origin + "/");
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open in Browser", click: () => shell.openExternal(origin + "/") },
        { type: "separator" },
        {
          label: "Options",
          submenu: [
            {
              label: "Check for Updates Automatically (asks GitHub once a day)",
              type: "checkbox",
              checked: readUpdateSettings().auto === true,
              click: (item) => {
                writeUpdateSettings({ auto: item.checked, asked: true });
                if (item.checked) checkForUpdates(false);
                if (item.checked && typeof readUpdateSettings().packs !== "boolean") askAboutPackUpdates(); // a tick here is a yes to the version number only
              },
            },
          ],
        },
        ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }]),
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }])],
    },
    {
      label: "Help",
      submenu: [
        { label: "Check for Updates…", click: () => checkForUpdates(true) },
        { label: "Releases Page", click: () => shell.openExternal(RELEASES_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function main() {
  buildMenu();
  if (isMac && !app.isPackaged) app.dock.setIcon(nativeImage.createFromPath(iconPath));
  origin = await startServer();
  createTray();
  createWindow();
  offerUpdateChecks();
  app.on("activate", showWindow);
}

function fail(message) {
  if (quitting) return;
  quitting = true;
  stopServer();
  dialog.showErrorBox("Anime AI Companion could not start", message);
  app.exit(1);
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  stopServer();
});
