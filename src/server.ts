import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { AvatarService } from "./avatar.ts";
import { shareNudge } from "./share-nudge.ts";
import { TerminalLink } from "./terminal-link.ts";
import { findAvatarTags } from "./avatar-tags.ts";
import { ClaudeCodeProvider } from "./providers/claude-code.ts";
import { checkProjectDir, loadSettings, saveSettings } from "./settings.ts";
import type { Decision, Mode, PermissionRequest, Provider, SessionConfig } from "./providers/types.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(root, "public");
const workspace = join(root, "workspace");
const port = Number(process.env.PORT ?? 3737);
// Local only: this server can run Claude Code, so never expose it on the network.
const host = "127.0.0.1";

await mkdir(workspace, { recursive: true });
const personaBase = await readFile(join(root, "persona.md"), "utf8");
const emotions = JSON.parse(await readFile(join(root, "emotions.json"), "utf8"));

const creatorSrc = process.env.CREATOR_SRC ?? resolve(root, "../anime-character-creator/src");
const avatar = new AvatarService({
  creatorSrc,
  python: process.env.PYTHON ?? "python3",
  workerPath: join(root, "python/render_worker.py"),
  statePath: join(root, "data/avatar.json"),
  emotions,
  defaultPreset: process.env.COMPANION_PRESET ?? "linnea",
});
await avatar.start();

const personaWork = await readFile(join(root, "persona-work.md"), "utf8");
const personaAttached = await readFile(join(root, "persona-attached.md"), "utf8");
const settingsPath = join(root, "data/settings.json");
const settings = await loadSettings(settingsPath);
// Always start in chat mode: work mode can change files, so it is an explicit choice each time.
let mode: Mode = "chat";

const sessionConfig = (): SessionConfig => ({
  mode,
  cwd: settings.projectDir ?? workspace,
  model: mode === "work" ? settings.workModel : settings.chatModel,
  allowedTools: settings.allowedTools,
});

const provider: Provider = new ClaudeCodeProvider({
  config: sessionConfig(),
  chatCwd: workspace,
  persona: (config) =>
    personaBase +
    (config.mode === "work" ? `\n${personaWork}\nProject folder: ${config.cwd}\n` : "") +
    "\n" +
    avatar.promptSection(),
});

const modeInfo = () => ({
  type: "mode",
  mode: link.connected ? "attached" : mode,
  projectDir: settings.projectDir,
  model: sessionConfig().model,
  sessionId: provider.sessionId,
  allowedTools: settings.allowedTools,
});

/** Approvals waiting for an answer, so a reloaded tab can show them again. */
const pendingPermissions = new Map<string, PermissionRequest>();

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const file = normalize(join(publicDir, path === "/" ? "index.html" : path));
  if (!file.startsWith(publicDir)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

const allowedOrigins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
const wss = new WebSocketServer({ noServer: true });

// Browsers connect on /ws (only from our own origin); a terminal session's channel shim
// connects on /attach with the token from data/attach-token.
server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/ws" && allowedOrigins.has(String(req.headers.origin))) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else if (path === "/attach" && link.handleUpgrade(req, socket, head)) {
    // handled by the link
  } else {
    socket.destroy();
  }
});

const clients = new Set<WebSocket>();
const broadcast = (msg: unknown) => {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
};

const attachToken = randomBytes(24).toString("hex");
await mkdir(join(root, "data"), { recursive: true });
await writeFile(join(root, "data/attach-token"), attachToken, { mode: 0o600 });

// Problems with the model's avatar tags, passed back to it with the next user message.
let notesForModel: string[] = [];

/** Applies each complete [avatar ...] tag in a growing reply exactly once, in order. */
function makeTagApplier(): (reply: string) => void {
  let seen = 0;
  return (reply) => {
    const tags = findAvatarTags(reply);
    for (; seen < tags.length; seen++) {
      avatar
        .applyPatch(tags[seen])
        .then(({ applied, rejected }) => {
          if (applied.length) broadcast({ type: "avatar", version: avatar.version, applied });
          if (rejected.length) {
            notesForModel.push(
              "Your avatar tag had problems: " +
                rejected.map((r) => `${r.key}: ${r.reason}`).join("; ") + ".",
            );
          }
        })
        .catch((err) => console.error("avatar patch failed:", err));
    }
  };
}

/** Prepends any pending notes about the model's own mistakes to the user's message. */
function withNotes(userText: string): string {
  const notes = notesForModel;
  notesForModel = [];
  return notes.length ? `(system note, not from the user: ${notes.join(" ")})\n\n${userText}` : userText;
}

// Pro mode: a terminal Claude Code session connected through the channel shim.
const link = new TerminalLink({
  token: attachToken,
  persona: () => personaBase + "\n" + avatar.promptSection() + "\n" + personaAttached,
  onSay: (text) => {
    makeTagApplier()(text);
    // Let avatar changes land before she "speaks", so the new look is there for the words.
    avatar.settled().finally(() => broadcast({ type: "say", text }));
  },
  onChange: () => {
    if (link.connected) provider.close(); // one brain at a time
    pendingPermissions.clear();
    broadcast(modeInfo());
  },
});

/** Runs one user turn: streams the reply, applies any [avatar ...] tags as they complete. */
function runTurn(userText: string): void {
  const toModel = withNotes(userText);
  let reply = "";
  const applyNewTags = makeTagApplier();

  provider.send(toModel, (event) => {
    if (event.type === "delta") {
      reply += event.text;
      applyNewTags(reply);
      broadcast(event);
    } else if (event.type === "tool") {
      broadcast(event);
    } else if (event.type === "permission") {
      pendingPermissions.set(event.request.id, event.request);
      broadcast(event);
    } else if (event.type === "permission-cancelled") {
      pendingPermissions.delete(event.id);
      broadcast(event);
    } else {
      pendingPermissions.clear();
      applyNewTags(reply);
      // Let queued avatar changes land before the turn is reported finished.
      avatar.settled().finally(() => broadcast(event));
    }
  });
}

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "hello", provider: provider.name, version: avatar.version }));
  ws.send(JSON.stringify(modeInfo()));
  for (const request of pendingPermissions.values()) ws.send(JSON.stringify({ type: "permission", request }));
  ws.on("close", () => clients.delete(ws));
  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "user" && typeof msg.text === "string" && msg.text.trim()) {
      broadcast({ type: "user", text: msg.text });
      if (link.connected) link.send(withNotes(msg.text));
      else runTurn(msg.text);
    } else if (msg.type === "permission-reply" && typeof msg.id === "string") {
      const decision = msg.decision as Decision;
      if (!["allow", "allow-session", "deny"].includes(decision) || !pendingPermissions.has(msg.id)) return;
      pendingPermissions.delete(msg.id);
      provider.respondPermission(msg.id, decision);
      broadcast({ type: "permission-resolved", id: msg.id, decision });
    } else if (msg.type === "mode" && (msg.mode === "chat" || msg.mode === "work")) {
      const notice = (text: string) => ws.send(JSON.stringify({ type: "notice", text }));
      if (link.connected) return notice("A terminal session is connected. Close it (or /exit) to switch modes.");
      if (provider.busy) return notice("Wait for her to finish the current reply first.");
      if (msg.mode === "work") {
        const wanted = typeof msg.projectDir === "string" && msg.projectDir.trim() ? msg.projectDir : settings.projectDir;
        if (!wanted) return notice("Choose a project folder first.");
        const check = await checkProjectDir(wanted);
        if (!check.ok) return notice(check.reason);
        settings.projectDir = check.dir;
        await saveSettings(settingsPath, settings);
      }
      mode = msg.mode;
      provider.configure(sessionConfig());
      broadcast(modeInfo());
    } else if (msg.type === "reset") {
      provider.reset();
      notesForModel = [];
      pendingPermissions.clear();
      broadcast({ type: "reset" });
      broadcast(modeInfo());
    } else if (msg.type === "reset-look") {
      await avatar.resetLook();
      provider.reset();
      pendingPermissions.clear();
      broadcast({ type: "reset" });
      broadcast(modeInfo());
      broadcast({ type: "avatar", version: avatar.version, applied: ["back to the original look"] });
    } else if (msg.type === "frames" && typeof msg.emotion === "string") {
      try {
        const version = avatar.version;
        const svgs = await avatar.frames(msg.emotion);
        ws.send(JSON.stringify({ type: "frames", version, emotion: msg.emotion, svgs }));
      } catch (err) {
        console.error("frames failed:", err);
      }
    }
  });
});

server.listen(port, host, () => {
  console.log(`Companion ready: http://${host}:${port}  (${provider.name})`);
  if (process.argv.includes("--open")) openBrowser(`http://${host}:${port}`);
  void shareNudge(
    [
      { name: "anime_ai_companion", dir: root, url: "https://github.com/rhedak/anime_ai_companion" },
      { name: "anime-character-creator", dir: resolve(creatorSrc, ".."), url: "https://github.com/rhedak/anime-character-creator" },
    ],
    join(root, "data/nudge.json"),
  );
});

function openBrowser(url: string): void {
  const [cmd, ...args] =
    process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

const shutdown = () => {
  provider.close();
  avatar.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
