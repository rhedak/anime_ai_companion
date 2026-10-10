import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { AvatarService } from "./avatar.ts";
import { shareNudge } from "./share-nudge.ts";
import { findAvatarTags } from "./avatar-tags.ts";
import { ClaudeCodeProvider } from "./providers/claude-code.ts";
import type { Provider } from "./providers/types.ts";

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

const provider: Provider = new ClaudeCodeProvider({
  model: process.env.COMPANION_MODEL ?? "haiku",
  tools: process.env.COMPANION_TOOLS ?? "",
  persona: () => personaBase + "\n" + avatar.promptSection(),
  cwd: workspace,
});

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
const wss = new WebSocketServer({
  server,
  path: "/ws",
  // Block other websites in the browser from talking to this local backend.
  verifyClient: ({ origin }: { origin: string }) => allowedOrigins.has(origin),
});

const clients = new Set<WebSocket>();
const broadcast = (msg: unknown) => {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
};

// Problems with the model's avatar tags, passed back to it with the next user message.
let notesForModel: string[] = [];

/** Runs one user turn: streams the reply, applies any [avatar ...] tags as they complete. */
function runTurn(userText: string): void {
  const notes = notesForModel;
  notesForModel = [];
  const toModel = notes.length
    ? `(system note, not from the user: ${notes.join(" ")})\n\n${userText}`
    : userText;

  let reply = "";
  let tagsSeen = 0;
  const applyNewTags = () => {
    const tags = findAvatarTags(reply);
    for (; tagsSeen < tags.length; tagsSeen++) {
      avatar
        .applyPatch(tags[tagsSeen])
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

  provider.send(toModel, (event) => {
    if (event.type === "delta") {
      reply += event.text;
      applyNewTags();
      broadcast(event);
    } else {
      applyNewTags();
      // Let queued avatar changes land before the turn is reported finished.
      avatar.settled().finally(() => broadcast(event));
    }
  });
}

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "hello", provider: provider.name, version: avatar.version }));
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
      runTurn(msg.text);
    } else if (msg.type === "reset") {
      provider.reset();
      notesForModel = [];
      broadcast({ type: "reset" });
    } else if (msg.type === "reset-look") {
      await avatar.resetLook();
      provider.reset();
      broadcast({ type: "reset" });
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
