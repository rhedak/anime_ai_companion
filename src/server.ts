import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { AvatarService } from "./avatar.ts";
import { pythonCommand } from "./python.ts";
import { shareNudge } from "./share-nudge.ts";
import { Transcript, claudeSessionExists, type ShownRecord } from "./transcript.ts";
import { findAvatarTags, findImageTags } from "./avatar-tags.ts";
import { resolveCreatorSrc } from "./creator.ts";
import { MAX_MESSAGE_BYTES, parseImages, type ImageInput } from "./images.ts";
import { listSessions, loadSessionItems, sessionContext, sessionPath, type SessionInfo } from "./sessions.ts";
import { coldCache, formatIdle, formatTokens, type ConversationState } from "./cache-guard.ts";
import { ClaudeCodeProvider } from "./providers/claude-code.ts";
import { CursorProvider } from "./providers/cursor.ts";
import { OpenCodeProvider } from "./providers/opencode.ts";
import { listOllamaModels, OllamaProvider } from "./providers/ollama.ts";
import { prettyModel, type Limit } from "./providers/claude-stream.ts";
import { pickFolder } from "./folder-picker.ts";
import { randomUUID } from "node:crypto";
import { checkShownImage } from "./shown-images.ts";
import { frameMime, isPackName, listPacks, packInfo, readPack, type FramePack } from "./frame-pack.ts";
import { gateRequest, isLoopbackAddress, loadToken, newToken, phoneLinks, qrRows, saveToken, sessionCookie, socketAllowed } from "./lan.ts";
import { runShell } from "./shell.ts";
import { loadUserEffort, resolveEffort, efforts, isEffort, type Effort } from "./claude-settings.ts";
import { checkProjectDir, cleanName, loadSettings, saveSettings, type ProviderName } from "./settings.ts";
import { permissionModes, type Decision, type Mode, type PermissionMode, type PermissionRequest, type Provider, type ProviderEvent, type SessionConfig } from "./providers/types.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(root, "public");
const workspace = join(root, "workspace");
const customCssPath = join(root, "data/custom.css");
const port = Number(process.env.PORT ?? 3737);
// Local only unless `--lan` is passed: this server can run Claude Code, so reaching it from the network is an
// opt-in made again at every start, and every request from the network needs the token (src/lan.ts).
const host = "127.0.0.1";
const lan = process.argv.includes("--lan");
const bindHost = lan ? "0.0.0.0" : host;
const lanTokenPath = join(root, "data/lan-token");
let lanToken = lan ? await loadToken(lanTokenPath) : "";

await mkdir(workspace, { recursive: true });
const personaBase = await readFile(join(root, "persona.md"), "utf8");
const emotions = JSON.parse(await readFile(join(root, "emotions.json"), "utf8"));

const creatorSrc = await resolveCreatorSrc();
const avatar = new AvatarService({
  creatorSrc,
  python: pythonCommand(),
  workerPath: join(root, "python/render_worker.py"),
  statePath: join(root, "data/avatar.json"),
  looksDir: join(root, "data/looks"),
  emotions,
  defaultPreset: process.env.COMPANION_PRESET ?? "linnea",
});
await avatar.start();

const personaWork = await readFile(join(root, "persona-work.md"), "utf8");
const settingsPath = join(root, "data/settings.json");
const settings = await loadSettings(settingsPath);

// A set of pictures shown instead of the drawn avatar (data/frames/<name>, see src/frame-pack.ts).
const framesDir = join(root, "data/frames");
/** Where packs are looked for: the user's own first, then the ones that come with the app. */
const packDirs = [framesDir, join(root, "packs")];
let activePack: FramePack | null = null;
/** Reads the chosen pack's folder again, so pictures replaced on disk show on the next page load. */
async function refreshPack(): Promise<string[]> {
  if (!settings.framePack) {
    activePack = null;
    return [];
  }
  const result = await readPack(packDirs, settings.framePack, Object.keys(emotions));
  activePack = result.ok ? result.pack : null;
  return result.ok ? result.pack.notes : [result.reason];
}
const packMessage = () => ({ type: "pack", pack: activePack ? packInfo(activePack) : null });
await refreshPack();
// Start in work mode when there is a folder to work in, unless --chat says otherwise.
// `anaico` passes the folder it was started from as --project-dir; that folder is only
// pre-filled here, not saved, until the user picks one in the UI.
let mode: Mode = "chat";
{
  const flag = process.argv.indexOf("--project-dir");
  const wanted = flag >= 0 ? process.argv[flag + 1] : settings.projectDir;
  if (wanted) {
    const check = await checkProjectDir(wanted);
    if (check.ok) {
      settings.projectDir = check.dir;
      if ((settings.provider === "claude" || settings.provider === "cursor" || settings.provider === "opencode") && !process.argv.includes("--chat")) mode = "work";
    } else {
      if (settings.projectDir === wanted) settings.projectDir = null;
      console.log(`Starting in chat mode: ${check.reason}`);
    }
  }
}

// Not saved: loosening approvals (auto, accept edits) is a choice made again each run.
let permissionMode: PermissionMode = "manual";
/** Like the permission mode, never saved: hooks run commands, so each start begins isolated. */
let claudeSetup = false;

const ollamaHost = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
/** Installed Ollama models, refreshed when a browser connects; null when Ollama is not reachable. */
let ollamaModels: string[] | null = null;

const userEffort = await loadUserEffort();
/** The effort in force: the user's pick, or what their own Claude Code settings give this model. */
function effectiveEffort(modelAlias = mode === "work" ? settings.workModel : settings.chatModel): Effort | null {
  if (settings.provider !== "claude") return null;
  return settings.effort === "default" ? resolveEffort(userEffort, modelAlias) : settings.effort;
}

const sessionConfig = (): SessionConfig => ({
  mode,
  cwd: settings.projectDir ?? workspace,
  model:
    settings.provider === "ollama"
      ? (settings.ollamaModel ?? "")
      : settings.provider === "cursor"
        ? (settings.cursorModel ?? "")
        : settings.provider === "opencode"
          ? (settings.opencodeModel ?? "")
          : mode === "work" ? settings.workModel : settings.chatModel,
  allowedTools: settings.allowedTools,
  permissionMode,
  claudeSetup,
  effort: effectiveEffort(),
});

const persona = (config: SessionConfig) =>
  personaBase.replaceAll("{{name}}", settings.name) +
  (config.mode === "work" ? `\n${personaWork}\nProject folder: ${config.cwd}\n` : "") +
  "\n" +
  avatar.promptSection();

// What the chat log shows, and which Claude Code session it belongs to, survive a restart.
const transcript = new Transcript(join(root, "data/transcript.json"));
const savedLog = await transcript.load();
const claudeResumable =
  savedLog?.provider === "claude" && savedLog.sessionId && (await claudeSessionExists(savedLog.sessionId))
    ? savedLog.sessionId
    : undefined;
if (!claudeResumable && savedLog?.provider === "claude") transcript.clear(); // its session is gone: start clean
/** How big her memory is and when she last answered: a cold prompt cache makes the next message expensive. */
const convo: ConversationState = {
  contextTokens: claudeResumable ? savedLog?.contextTokens ?? null : null,
  lastReplyAt: claudeResumable ? savedLog?.lastReplyAt ?? null : null,
};
/** A message waiting for the user to decide how to pay for a cold cache (see coldCacheOffer). */
let heldMessage: { text: string; images: ImageInput[] } | null = null;
const cursorResumable = savedLog?.provider === "cursor" ? savedLog.sessionId ?? undefined : undefined;
const opencodeResumable = savedLog?.provider === "opencode" ? savedLog.sessionId ?? undefined : undefined;

const providers: Record<ProviderName, Provider> = {
  claude: new ClaudeCodeProvider({
    config: sessionConfig(),
    chatCwd: workspace,
    persona,
    resumeSessionId: claudeResumable,
  }),
  ollama: new OllamaProvider({
    host: ollamaHost,
    model: settings.ollamaModel ?? "",
    persona: () => persona(sessionConfig()),
  }),
  cursor: new CursorProvider({
    config: sessionConfig(),
    chatCwd: workspace,
    persona,
    resumeSessionId: cursorResumable,
  }),
  opencode: new OpenCodeProvider({
    config: sessionConfig(),
    chatCwd: workspace,
    persona,
    resumeSessionId: opencodeResumable,
  }),
};
let provider: Provider = providers[settings.provider];

/** What the footer shows. Limits belong to the account, so they outlive a /clear; the context belongs to the conversation. */
const account: { model: string | null; session: Limit | null; week: Limit | null; limitsAt: number | null } = {
  model: null,
  session: null,
  week: null,
  limitsAt: null,
};

const meterInfo = () => {
  const usage = provider.usage;
  const ctx = usage?.contextTokens != null && usage.contextWindow ? Math.min(1, usage.contextTokens / usage.contextWindow) : null;
  const claude = settings.provider === "claude";
  return {
    type: "meter",
    model: claude ? (account.model ? prettyModel(account.model) : null) : provider.name,
    effort: claude ? effectiveEffort() : null,
    session: claude ? account.session : null,
    week: claude ? account.week : null,
    limitsAt: account.limitsAt,
    ctx,
  };
};

/** Cursor and opencode both speak ACP, so share the session, model and resume plumbing. */
type AcpBrain = CursorProvider | OpenCodeProvider;
const acpBrain = (): AcpBrain | null => (provider instanceof CursorProvider || provider instanceof OpenCodeProvider ? provider : null);
const cursorBrain = () => (provider instanceof CursorProvider ? provider : null);
const opencodeBrain = () => (provider instanceof OpenCodeProvider ? provider : null);

/** What the work bar and /model show. ACP catalog ids are long; show the short name. */
const shownModel = () => acpBrain()?.modelLabel || sessionConfig().model;

const modeInfo = () => ({
  type: "mode",
  name: settings.name,
  mode,
  provider: settings.provider,
  canUseTools: provider.canUseTools,
  ollamaModels,
  ollamaModel: settings.ollamaModel,
  cursorModels: cursorBrain()?.availableModels ?? [],
  cursorModel: cursorBrain()?.modelId || settings.cursorModel,
  opencodeModels: opencodeBrain()?.availableModels ?? [],
  opencodeModel: opencodeBrain()?.modelId || settings.opencodeModel,
  projectDir: settings.projectDir,
  model: shownModel(),
  sessionId: provider.sessionId,
  allowedTools: settings.allowedTools,
  permissionMode,
  claudeSetup,
  effort: settings.effort,
  effortNow: effectiveEffort(),
});

const looksInfo = () => ({ type: "looks", names: avatar.lookNames, presets: avatar.presetNames, canUndo: avatar.canUndo });

async function refreshOllamaModels(): Promise<void> {
  const before = JSON.stringify(ollamaModels);
  ollamaModels = await listOllamaModels(ollamaHost);
  if (JSON.stringify(ollamaModels) !== before) broadcast(modeInfo());
}

/** Approvals waiting for an answer, so a reloaded tab can show them again. */
const pendingPermissions = new Map<string, PermissionRequest>();

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

// Defence in depth for a page that talks to a server able to run commands: no inline or
// foreign scripts at all, no framing (clickjacking the approval buttons), nothing leaves the origin.
const securityHeaders = {
  "content-security-policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self' ws://${host}:${port} ws://localhost:${port}`, // 'self' covers the phone's own address
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

/** Pages and files go to this machine freely; over the network only with the token (see src/lan.ts). */
function letThrough(req: IncomingMessage, res: ServerResponse): boolean {
  if (isLoopbackAddress(req.socket.remoteAddress)) return true;
  const gate = lan ? gateRequest(req, lanToken) : { action: "refuse" as const, status: 401 as const, text: "Not available." };
  if (gate.action === "allow") return true;
  if (gate.action === "sign-in") {
    res.writeHead(302, { "set-cookie": sessionCookie(lanToken), location: gate.location, "cache-control": "no-store", ...securityHeaders }).end();
  } else {
    res.writeHead(gate.status, { "content-type": "text/plain; charset=utf-8", ...securityHeaders }).end(gate.text);
  }
  return false;
}

const server = createServer(async (req, res) => {
  if (!letThrough(req, res)) return;
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const shown = /^\/shown\/([0-9a-f-]{36})$/.exec(path);
  if (shown) {
    // A picture she showed in the chat. The id is unguessable and the file is re-checked on every request.
    const record = transcript.findShown(shown[1]);
    const ok = record && !("error" in (await checkShownImage(record.path, record.root)));
    if (!record || !ok) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": record.mime, "cache-control": "private, max-age=3600", ...securityHeaders });
    res.end(await readFile(record.path));
    return;
  }
  const frame = /^\/frames\/([^/]+)\/([^/]+)$/.exec(path);
  if (frame) {
    // Only files the scan of the chosen pack found are sent, never a path taken from the url.
    let name = "", file = "";
    try {
      [name, file] = [decodeURIComponent(frame[1]), decodeURIComponent(frame[2])];
    } catch {}
    const known = activePack?.name === name ? activePack.files.get(file) : undefined;
    const body = known && (await readFile(known.path).catch(() => null));
    if (!known || !body) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": frameMime(file), "cache-control": "no-cache", ...securityHeaders });
    res.end(body);
    return;
  }
  if (path === "/custom.css") {
    // The user's own styling (see public/theme.css). Missing file: an empty sheet, not a 404.
    const css = await readFile(customCssPath).catch(() => "");
    res.writeHead(200, { "content-type": mime[".css"], "cache-control": "no-cache", ...securityHeaders });
    res.end(css);
    return;
  }
  const file = normalize(join(publicDir, path === "/" ? "index.html" : path));
  if (file !== publicDir && !file.startsWith(publicDir + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": mime[extname(file)] ?? "application/octet-stream",
      ...securityHeaders,
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

const allowedOrigins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

// Browsers connect on /ws, and only from our own origin. From the network (--lan) that also takes the token cookie.
const remoteSockets = new WeakSet<WebSocket>();
server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const local = isLoopbackAddress(req.socket.remoteAddress);
  const ok = local ? allowedOrigins.has(String(req.headers.origin)) : lan && socketAllowed(req, lanToken);
  if (path === "/ws" && ok) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!local) remoteSockets.add(ws);
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

const clients = new Set<WebSocket>();
const broadcast = (msg: unknown) => {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
  // Whatever changed the mode, brain or conversation may have changed the footer too.
  if ((msg as { type?: string }).type === "mode") {
    const meter = JSON.stringify(meterInfo());
    for (const c of clients) if (c.readyState === c.OPEN) c.send(meter);
  }
};

await mkdir(join(root, "data"), { recursive: true });

/** Save the visible log and the session it belongs to (debounced a little: turns end often). */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistTranscript(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    transcript
      .save({ provider: settings.provider, sessionId: provider.sessionId, ...convo })
      .catch((err) => console.error("could not save the transcript:", err));
  }, 300);
}

// Problems with the model's avatar tags, passed back to it with the next user message.
let notesForModel: string[] = [];

/** Applies each complete [avatar ...] tag in a growing reply exactly once, in order. */
function makeTagApplier(): (reply: string) => void {
  let seen = 0;
  return (reply) => {
    const tags = findAvatarTags(reply);
    for (; seen < tags.length; seen++) {
      if (activePack) {
        const note = "Your look is a fixed set of pictures now: [avatar ...] tags and gestures change nothing. Do not use them.";
        if (!notesForModel.includes(note)) notesForModel.push(note);
        continue;
      }
      avatar
        .applyPatch(tags[seen])
        .then(({ applied, rejected }) => {
          if (applied.length) {
            transcript.look(applied);
            broadcast({ type: "avatar", version: avatar.version, applied });
            broadcast(looksInfo());
          }
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

const MAX_SHOWN_PER_REPLY = 8;

/** The pictures named by `[image path]` tags in a finished reply, checked and registered. */
async function collectShownImages(reply: string): Promise<ShownRecord[]> {
  const records: ShownRecord[] = [];
  const problems: string[] = [];
  const wanted = [...new Set(findImageTags(reply))];
  if (wanted.length > MAX_SHOWN_PER_REPLY) {
    problems.push(`only ${MAX_SHOWN_PER_REPLY} pictures can be shown per reply, so the last ${wanted.length - MAX_SHOWN_PER_REPLY} were left out; show them in a follow-up message`);
  }
  for (const requested of wanted.slice(0, MAX_SHOWN_PER_REPLY)) {
    const checked = await checkShownImage(requested, sessionConfig().cwd);
    if ("error" in checked) problems.push(checked.error);
    else records.push({ id: randomUUID(), name: checked.name, path: checked.path, root: checked.root, mime: checked.mime });
  }
  if (problems.length) notesForModel.push(`Your image tag had problems: ${problems.join("; ")}.`);
  return records;
}

/** Prepends any pending notes about the model's own mistakes to the user's message. */
function withNotes(userText: string): string {
  const notes = notesForModel;
  notesForModel = [];
  return notes.length ? `(system note, not from the user: ${notes.join(" ")})\n\n${userText}` : userText;
}

/** Tells the user something in their chat log only (not stored, not sent to other tabs). */
type Say = (text: string) => void;

/** Why a settings change cannot happen right now, or null. */
function cannotChange(): string | null {
  if (provider.busy) return "Wait for her to finish the current reply first.";
  return null;
}

async function switchMode(wanted: Mode, dir: unknown, say: Say): Promise<void> {
  const blocked = cannotChange();
  if (blocked) return say(blocked);
  if (wanted === "work") {
    if (!provider.canUseTools) return say("This model cannot use tools. Switch to Claude Code, Cursor or opencode for work mode.");
    const folder = typeof dir === "string" && dir.trim() ? dir : settings.projectDir;
    if (!folder) return say("Choose a project folder first.");
    const check = await checkProjectDir(folder);
    if (!check.ok) return say(check.reason);
    settings.projectDir = check.dir;
    await saveSettings(settingsPath, settings);
  }
  const before = { mode, cwd: sessionConfig().cwd };
  mode = wanted;
  provider.configure(sessionConfig());
  // Claude Code sends the system prompt it recorded when the conversation began, which keeps the prompt cache
  // intact across restarts but means the work-mode rules in the new persona never reach her. Tell her instead.
  const now = sessionConfig();
  if (settings.provider === "claude" && transcript.items.length > 0 && (before.mode !== mode || (mode === "work" && before.cwd !== now.cwd))) {
    notesForModel.push(
      mode === "work"
        ? `the user switched you to work mode. ${personaWork.replace(/\s+/g, " ").trim()} Project folder: ${now.cwd}.`
        : "the user switched you back to chat mode: you have no tools now, and the work-mode rules no longer apply.",
    );
  }
  broadcast(modeInfo());
}

/** Works in the middle of a reply too (Claude Code takes the change live), so an approval card can switch it. */
async function changeEffort(value: Effort | "default", say: Say): Promise<void> {
  if (settings.provider !== "claude") return say("Effort only applies to Claude.");
  const blocked = cannotChange();
  if (blocked) return say(blocked);
  settings.effort = value;
  await saveSettings(settingsPath, settings);
  provider.configure(sessionConfig()); // restarts claude with --effort; the conversation carries on
  broadcast(modeInfo());
}

function changeClaudeSetup(on: boolean, say: Say): void {
  const blocked = cannotChange();
  if (blocked) say(blocked);
  else if (!provider.canUseTools) say("This model cannot use tools, so there is no Claude Code setup to load.");
  else {
    claudeSetup = on;
    provider.configure(sessionConfig()); // restarts claude; the conversation carries on
    if (on && mode === "work") {
      say("Using your Claude Code setup in work mode: your user and project settings, hooks, rules and MCP servers now apply.");
    }
  }
  broadcast(modeInfo());
}

async function rename(input: string, say: Say): Promise<void> {
  const name = cleanName(input);
  if (!name) return say("A name can have 1 to 24 letters, numbers, spaces and . ' - _");
  if (name === settings.name) return;
  settings.name = name;
  await saveSettings(settingsPath, settings);
  // Her running session keeps the old prompt until it restarts, so tell her directly.
  notesForModel.push(`the user renamed you: your name is now ${name}.`);
  broadcast(modeInfo());
}

function changePermissionMode(value: PermissionMode, say: Say): void {
  if (!provider.canUseTools) say("This model cannot use tools, so there are no permissions.");
  else if (value === "everything" && settings.provider !== "cursor" && settings.provider !== "opencode") {
    say("Run everything is a Cursor or opencode mode. Claude stays on Ask, Plan, Accept edits or Auto.");
  } else if (settings.provider !== "claude" && (value === "auto" || value === "acceptEdits")) {
    say(`${settings.provider === "cursor" ? "Cursor" : "opencode"} here has Ask, Plan and Run everything. Auto and Accept edits are Claude Code modes.`);
  } else {
    permissionMode = value;
    if (provider.setPermissionMode) provider.setPermissionMode(value);
    else provider.configure(sessionConfig());
    if (value === "everything") {
      say(
        settings.provider === "cursor"
          ? "Run everything: she runs tools without a card, unless Cursor still asks. A deny rule still blocks. This resets to Ask the next time the server starts."
          : "Run everything: opencode runs every tool without a card. This resets to Ask the next time the server starts.",
      );
    }
  }
  broadcast(modeInfo());
}

const permissionNames: Record<string, PermissionMode> = { ask: "manual", plan: "plan", accept: "acceptEdits", auto: "auto", everything: "everything" };

interface CommandContext {
  /** Everything after the command name. */
  args: string;
  /** The full line as typed. */
  text: string;
  say: Say;
  /** Sends one message to the page that typed the command (not stored, not sent to other tabs). */
  reply: (msg: unknown) => void;
  /** The command came from a device on the network (--lan), not from this machine. */
  remote: boolean;
}

/** What a phone may not do: anything that loosens approvals or reaches into this machine without a card. */
const remoteRefusal = "That is only possible on the computer itself, not from a phone.";
const looserThanAsk = (mode: unknown) => mode !== "manual" && mode !== "plan";

/** The slash commands that would loosen approvals, load the user's hooks, or point her at another folder. */
function remoteBlocked(name: string, args: string): boolean {
  const a = args.trim().toLowerCase();
  if (name === "work") return a !== ""; // /work alone returns to the saved folder
  if (name === "setup") return a === "on";
  if (name === "permissions") return Object.hasOwn(permissionNames, a) && looserThanAsk(permissionNames[a]);
  return false;
}

/**
 * Slash commands typed in the chat box. Only a lone `/word` counts, so paths still reach the
 * model. `copy`, `export` and `voice` run in the browser; they are listed here so /help shows them.
 */
const slashCommands: Record<
  string,
  {
    help: string;
    /** Needs Claude Code underneath: with another brain the command says so instead of pretending. */
    claudeOnly?: boolean;
    run: (ctx: CommandContext) => void | Promise<void>;
  }
> = {
  help: {
    help: "list these commands",
    run: ({ say }) => {
      const claude = settings.provider === "claude";
      say(
        Object.entries(slashCommands)
          .map(([name, c]) => `/${name}: ${c.help}${c.claudeOnly && !claude ? " (needs Claude Code)" : ""}`)
          .join("\n") +
          "\n!command: run a shell command in your project folder (work mode), e.g. !git status\nCtrl+C (or the stop button): stop her reply or a running !command",
      );
    },
  },
  clear: { help: "forget the conversation and start fresh", run: () => resetConversation() },
  new: { help: "same as /clear", run: () => resetConversation() },
  compact: {
    help: "summarise the conversation to free up context",
    claudeOnly: true,
    run: ({ text, say }) => {
      if (provider.busy) return say("Wait for her to finish the current reply first.");
      transcript.user(text);
      broadcast({ type: "user", text });
      runTurn(text, { raw: true });
    },
  },
  resume: {
    help: "list earlier conversations in this folder, then /resume <number> to continue one",
    run: ({ args, say }) => resumeCommand(args, say),
  },
  status: {
    help: "show the brain, model, mode, folder and session",
    run: ({ say }) => {
      const info = modeInfo();
      say(
        [
          `Brain: ${provider.name}`,
          `Mode: ${info.mode}${mode === "work" ? ` · permissions: ${permissionMode}` : ""}`,
          `Folder: ${settings.projectDir ?? "(none)"}`,
          `Session: ${provider.sessionId ?? "(none)"}`,
        ].join("\n"),
      );
    },
  },
  cost: {
    help: "what this conversation has used so far (an estimate)",
    claudeOnly: true,
    run: ({ say }) => {
      const u = provider.usage;
      if (!u) return say("This brain does not report usage.");
      if (u.turns === 0) return say("Nothing yet: usage shows after her next reply.");
      const context = u.contextTokens === null ? "unknown" : `~${u.contextTokens.toLocaleString("en-US")} tokens`;
      say(
        `This conversation: about $${u.costUsd.toFixed(4)} at API prices (a subscription is not billed per token).\n` +
          `Context in use: ${context}. /compact frees it up.`,
      );
    },
  },
  model: {
    help: "show or set the model, e.g. /model opus (until the server restarts)",
    run: async ({ args, say }) => {
      if (settings.provider === "ollama") return say("Pick the Ollama model in the dropdown.");
      if (settings.provider === "cursor" || settings.provider === "opencode") {
        const label = settings.provider === "cursor" ? "Cursor" : "opencode";
        if (!args) return say(`Model: ${shownModel() || `(waiting for ${label})`}`);
        const blocked = cannotChange();
        if (blocked) return say(blocked);
        if (settings.provider === "cursor") settings.cursorModel = args;
        else settings.opencodeModel = args;
        await saveSettings(settingsPath, settings);
        provider.configure(sessionConfig());
        broadcast(modeInfo());
        return say(`Model set to ${args}.`);
      }
      const current = mode === "work" ? settings.workModel : settings.chatModel;
      if (!args) return say(`Model: ${current} (${mode} mode)`);
      if (!/^[A-Za-z0-9][\w.\-\[\]]{0,59}$/.test(args)) return say("That does not look like a model name.");
      const blocked = cannotChange();
      if (blocked) return say(blocked);
      if (mode === "work") settings.workModel = args;
      else settings.chatModel = args;
      provider.configure(sessionConfig());
      broadcast(modeInfo());
      say(`Model set to ${args} for ${mode} mode, until the server restarts.`);
    },
  },
  chat: { help: "switch to chat mode (no tools)", run: ({ say }) => switchMode("chat", undefined, say) },
  work: { help: "switch to work mode, optionally for a folder: /work ~/project", run: ({ args, say }) => switchMode("work", args, say) },
  permissions: {
    help: "ask, plan, accept (edits), auto (Claude), or everything (Cursor, opencode): how work mode handles approvals",
    run: ({ args, say }) => {
      const key = args.toLowerCase();
      const wanted = Object.hasOwn(permissionNames, key) ? permissionNames[key] : undefined;
      if (!wanted) return say(`Permissions: ${permissionMode}. Use /permissions ${Object.keys(permissionNames).join(" | ")}`);
      changePermissionMode(wanted, say);
    },
  },
  effort: {
    help: `how hard she thinks: ${efforts.join(" | ")} | default (follow your Claude settings)`,
    claudeOnly: true,
    run: ({ args, say }) => {
      const wanted = args.toLowerCase();
      if (wanted === "default" || isEffort(wanted)) return changeEffort(wanted, say);
      const now = effectiveEffort();
      say(`Effort: ${now ?? "Claude's default"}${settings.effort === "default" ? " (from your Claude settings)" : ""}. Use /effort ${efforts.join(" | ")} | default`);
    },
  },
  rename: {
    help: "rename the companion: /rename Hana (or click her name at the top)",
    run: ({ args, say }) => (args ? rename(args, say) : say(`She is called ${settings.name}. Use /rename <new name>`)),
  },
  setup: {
    help: "work mode: use your own Claude Code setup (settings, hooks, MCP servers): /setup on | off",
    claudeOnly: true,
    run: ({ args, say }) => {
      const wanted = args.toLowerCase();
      if (wanted === "on" || wanted === "off") return changeClaudeSetup(wanted === "on", say);
      say(`Your Claude Code setup is ${claudeSetup ? "on" : "off"} in work mode. Use /setup on | off`);
    },
  },
  plan: { help: "same as /permissions plan", run: ({ say }) => changePermissionMode("plan", say) },
  rc: {
    help: "remote control from claude.ai or the phone (not built in; shows how to do it yourself)",
    claudeOnly: true,
    run: ({ say }) => remoteControlHint(say),
  },
  "remote-control": { help: "same as /rc", claudeOnly: true, run: ({ say }) => remoteControlHint(say) },
  rewind: {
    help: "roll back to an earlier point (not available in the companion)",
    claudeOnly: true,
    run: ({ say }) =>
      say(
        "/rewind is not available in the companion: it relies on Claude Code's own interactive checkpoints. " +
          `To use it, continue this conversation in a terminal${resumeCommandLine()} and run /rewind there. Only one side should write at a time.`,
      ),
  },
  frames: {
    help: "show her with your own pictures instead of the drawn avatar: /frames lists the packs in data/frames, /frames <name> uses one, /frames off goes back",
    run: async ({ args, say }) => {
      const wanted = args.trim();
      if (!wanted) {
        const packs = await listPacks(...packDirs);
        const using = settings.framePack ? `Showing the pack "${settings.framePack}".` : "Showing the drawn avatar.";
        return say(
          `${using} ` +
            (packs.length ? `Packs (yours in data/frames, and those shipped in packs/): ${packs.join(", ")}. Use /frames <name> or /frames off.` : "There are no packs in data/frames yet; docs/frame-packs.md says how to make one."),
        );
      }
      if (wanted.toLowerCase() === "off") {
        settings.framePack = null;
        await saveSettings(settingsPath, settings);
        await refreshPack();
        notesForModel.push("The user switched you back to your drawn avatar: [avatar ...] tags and gestures work again.");
        broadcast(packMessage());
        return say("Back to the drawn avatar.");
      }
      if (!isPackName(wanted)) return say("A pack name is a folder in data/frames: letters, digits, spaces, . _ -");
      const result = await readPack(packDirs, wanted, Object.keys(emotions));
      if (!result.ok) return say(result.reason);
      settings.framePack = wanted;
      await saveSettings(settingsPath, settings);
      activePack = result.pack;
      notesForModel.push("The user switched you to a fixed set of pictures: your look cannot change now, so [avatar ...] tags and gestures do nothing. Your emotions and talking still drive which picture is shown.");
      broadcast(packMessage());
      say(
        [
          `Showing the pack "${wanted}": ${Object.keys(result.pack.emotions).length} emotions, ${result.pack.files.size} pictures.`,
          ...(result.pack.credit ? [`Credit: ${result.pack.credit}`] : []),
          ...result.pack.notes,
        ].join("\n"),
      );
    },
  },
  phone: {
    help: "show the link for controlling her from a phone on this network (`/phone new` makes a new one; needs --lan)",
    run: async ({ args, say, reply, remote }) => {
      if (remote) return say(remoteRefusal);
      if (!lan) return say("Phone access is off. Restart with `anaico --lan` (or `npm start -- --lan`) to turn it on; it is off again at every start.");
      if (args.trim() === "new") {
        lanToken = await saveToken(lanTokenPath, newToken());
        for (const c of clients) if (remoteSockets.has(c)) c.close(); // every signed-in phone has to use the new link
        say("Made a new link. Phones that used the old one are signed out.");
      }
      const links = phoneLinks(port, lanToken);
      reply({ type: "phone", links, qr: qrRows(links[0]) });
    },
  },
  copy: { help: "copy her last reply to the clipboard", run: () => {} },
  export: { help: "download the conversation as a Markdown file", run: () => {} },
  voice: { help: "turn spoken replies on or off", run: () => {} },
};
Object.setPrototypeOf(slashCommands, null); // so "/constructor" is just unknown

/** `cd <folder> && claude --resume <id>` for continuing this conversation in a terminal. */
function resumeCommandLine(): string {
  const folder = sessionCwd();
  const quoted = /^[\w@%+=:,./-]+$/.test(folder) ? folder : `'${folder.replace(/'/g, `'\\''`)}'`;
  return `: cd ${quoted} && claude --resume ${provider.sessionId}`;
}

function remoteControlHint(say: Say): void {
  say(
    "Remote control is not available in the companion. It links a session to claude.ai or the Claude app through Anthropic's servers, " +
      "and a remote client would be answering permission questions outside the approval cards here. " +
      `To use it, start a terminal session with it enabled and keep the browser out of that conversation${resumeCommandLine()} --remote-control`,
  );
}

let pickerOpen = false;

/** The "Choose folder…" button: ask the operating system's folder dialog, then work there. */
async function chooseFolder(say: Say): Promise<void> {
  const blocked = cannotChange();
  if (blocked) return say(blocked);
  if (pickerOpen) return say("The folder dialog is already open.");
  pickerOpen = true;
  broadcast({ type: "picking", on: true });
  try {
    const result = await pickFolder(settings.projectDir);
    if ("error" in result) say(result.error);
    else if ("path" in result) await switchMode("work", result.path, say);
  } finally {
    pickerOpen = false;
    broadcast({ type: "picking", on: false });
  }
}

let shellRunning = false;
let shellAbort: AbortController | null = null;

/** `!command` in the chat box: run it in the project folder and tell the model afterwards, like Claude Code's bash mode. */
async function runBang(command: string, say: Say): Promise<void> {
  if (mode !== "work") return say("!commands run in work mode, in your project folder. Switch to Work first.");
  if (shellRunning) return say("A command is still running; wait for it to finish.");
  shellRunning = true;
  shellAbort = new AbortController();
  const id = randomUUID();
  broadcast({ type: "shell", id, command });
  try {
    const result = await runShell(command, settings.projectDir ?? workspace, { signal: shellAbort.signal });
    const output =
      result.output +
      (result.truncated ? "\n[output cut off]" : "") +
      (result.timedOut ? "\n[stopped after 2 minutes]" : shellAbort.signal.aborted ? "\n[stopped]" : "");
    transcript.shell({ command, output, code: result.code });
    persistTranscript();
    // The model did not see this; tell it with her next message.
    notesForModel.push(
      `the user ran a shell command themselves in ${settings.projectDir ?? workspace}: $ ${command} (exit ${result.code ?? "none"}). It printed: ${output.trim().slice(0, 4000).replace(/\n{2,}/g, "\n") || "(nothing)"}`,
    );
    broadcast({ type: "shell-done", id, output, code: result.code });
  } finally {
    shellRunning = false;
    shellAbort = null;
  }
}

/** Ctrl+C / the stop button: end the command or the reply that is running. */
function stopWork(say: Say): void {
  if (shellAbort) {
    shellAbort.abort();
  } else if (provider.interrupt()) {
    for (const id of pendingPermissions.keys()) broadcast({ type: "permission-cancelled", id });
    pendingPermissions.clear();
    broadcast({ type: "notice", text: "Stopped." });
  } else say("Nothing is running.");
}

/** Where Claude Code is (or would be) running, so where its sessions are stored. */
const sessionCwd = () => (mode === "work" ? sessionConfig().cwd : workspace);
let lastListing: SessionInfo[] = [];

function ago(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

let lastAcpListing: { id: string; title: string; modified: Date }[] = [];

/** Cursor and opencode keep the conversation in their own session. The on-screen log is ours, so resuming starts that screen clean. */
async function resumeAcp(args: string, say: Say): Promise<void> {
  const acp = acpBrain();
  if (!acp) return;
  const blocked = cannotChange();
  if (blocked) return say(blocked);
  const cwd = sessionCwd();
  const label = settings.provider === "cursor" ? "Cursor" : "opencode";
  if (!args) {
    try {
      lastAcpListing = await acp.listSessions(cwd);
    } catch (err) {
      return say(err instanceof Error ? err.message : String(err));
    }
    if (lastAcpListing.length === 0) return say(`No earlier ${label} conversations in ${cwd}.`);
    const lines = lastAcpListing.map(
      (s, i) => `${i + 1}. ${ago(s.modified)} · ${s.title}${s.id === acp.sessionId ? " (current)" : ""}`,
    );
    return say(`Conversations in ${cwd}:\n${lines.join("\n")}\nContinue one with /resume <number>. The screen starts clean; she still remembers it.`);
  }
  const chosen = /^\d+$/.test(args) ? lastAcpListing[Number(args) - 1] : undefined;
  if (!chosen) return say(lastAcpListing.length ? "No such entry. Run /resume to see the list." : "Run /resume first to see the list.");
  if (chosen.id === acp.sessionId) return say("That is the current conversation.");
  acp.resume(chosen.id);
  transcript.clear();
  notesForModel = [];
  pendingPermissions.clear();
  persistTranscript();
  broadcast({ type: "history", items: transcript.snapshot() });
  broadcast(modeInfo());
  say(`Resumed: ${chosen.title}`);
}

async function resumeCommand(args: string, say: Say): Promise<void> {
  if (settings.provider === "cursor" || settings.provider === "opencode") return resumeAcp(args, say);
  if (!provider.resume) return say("/resume needs Claude Code, Cursor or opencode; this model has no saved sessions.");
  const blocked = cannotChange();
  if (blocked) return say(blocked);
  const cwd = sessionCwd();
  if (!args) {
    lastListing = await listSessions(cwd);
    if (lastListing.length === 0) return say(`No earlier conversations in ${cwd}.`);
    const lines = lastListing.map(
      (s, i) => `${i + 1}. ${ago(s.modified)} · ${s.title}${s.id === provider.sessionId ? " (current)" : ""}`,
    );
    return say(`Conversations in ${cwd}:\n${lines.join("\n")}\nContinue one with /resume <number>.`);
  }
  const chosen = /^\d+$/.test(args) ? lastListing[Number(args) - 1] : args.length >= 4 ? lastListing.find((s) => s.id.startsWith(args.toLowerCase())) : undefined;
  if (!chosen) return say(lastListing.length ? "No such entry. Run /resume to see the list." : "Run /resume first to see the list.");
  if (chosen.id === provider.sessionId) return say("That is the current conversation.");
  const path = sessionPath(cwd, chosen.id);
  if (!path || !existsSync(path)) return say("That conversation is no longer on disk.");
  let items;
  try {
    items = await loadSessionItems(path);
  } catch (err) {
    return say(String(err instanceof Error ? err.message : err));
  }
  provider.resume(chosen.id);
  dropHeldMessage();
  const size = await sessionContext(path).catch(() => null);
  convo.contextTokens = size?.contextTokens ?? null;
  convo.lastReplyAt = size ? size.modified.getTime() : null;
  transcript.clear();
  transcript.items = items;
  notesForModel = [];
  pendingPermissions.clear();
  persistTranscript();
  broadcast({ type: "history", items: transcript.snapshot() });
  broadcast(modeInfo());
  broadcast({ type: "notice", text: `Resumed: ${chosen.title}` });
}

function parseSlash(text: string): { name: string; args: string } | null {
  const match = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return match ? { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() } : null;
}

function forgetConversationSize(): void {
  convo.contextTokens = null;
  convo.lastReplyAt = null;
  dropHeldMessage();
}

function resetConversation(): void {
  provider.reset();
  forgetConversationSize();
  transcript.clear();
  persistTranscript();
  notesForModel = [];
  pendingPermissions.clear();
  broadcast({ type: "reset" });
  broadcast(modeInfo());
}

/** Shows the user's message in the log and sends it to the brain. */
function sendUser(text: string, images: ImageInput[], onFinish?: (event: ProviderEvent) => void): void {
  transcript.user(text, images.length);
  broadcast({ type: "user", text, images: images.map((i) => `data:${i.mediaType};base64,${i.data}`) });
  runTurn(text, { images, onFinish });
}

/**
 * Her memory of a long conversation sits in Claude's prompt cache, which expires after about an hour. A message
 * sent after that has to send the whole conversation again at full price, which for a long one is a big part
 * of the usage limit. So the message waits while the user chooses: send it as it is, summarise first (Claude
 * Code's /compact, like "resume from summary" in the terminal), or hold it back.
 */
function offerColdCache(text: string, images: ImageInput[], cold: { tokens: number; idleMinutes: number }): void {
  heldMessage = { text, images };
  broadcast(coldCacheCard(cold));
}

const coldCacheCard = (cold: { tokens: number; idleMinutes: number }) => ({
  type: "cold-cache",
  tokens: formatTokens(cold.tokens),
  idle: formatIdle(cold.idleMinutes),
  text: heldMessage?.text ?? "",
});

function dropHeldMessage(): void {
  if (!heldMessage) return;
  heldMessage = null;
  broadcast({ type: "cold-resolved", choice: "dropped" });
}

function answerColdCache(choice: string, say: Say): void {
  const held = heldMessage;
  if (!held) return;
  if (choice !== "send" && choice !== "summarise" && choice !== "cancel") return;
  if (provider.busy) return say("Wait for her to finish the current reply first.");
  heldMessage = null;
  broadcast({ type: "cold-resolved", choice });
  if (choice === "send") return sendUser(held.text, held.images);
  if (choice === "cancel") return;
  transcript.user("/compact");
  broadcast({ type: "user", text: "/compact" });
  runTurn("/compact", {
    raw: true,
    onFinish: (event) => {
      if (event.type === "done") return sendUser(held.text, held.images);
      // The summary did not happen: do not spend a cold read on the message behind the user's back.
      broadcast({ type: "notice", text: `The summary failed, so this was not sent: ${held.text}` });
    },
  });
}

/** Runs one user turn: streams the reply, applies any [avatar ...] tags as they complete. */
function runTurn(
  userText: string,
  opts: { raw?: boolean; images?: ImageInput[]; onFinish?: (event: ProviderEvent) => void } = {},
): void {
  // Slash commands go to Claude Code as they are: a note in front would stop it seeing the command.
  const toModel = opts.raw ? userText : withNotes(userText);
  let reply = "";
  const applyNewTags = makeTagApplier();

  provider.send(toModel, (event) => {
    if (event.type === "delta") {
      reply += event.text;
      transcript.delta(event.text);
      applyNewTags(reply);
      broadcast(event);
    } else if (event.type === "tool") {
      transcript.tool({ type: "tool", id: event.id, name: event.name, summary: event.summary, status: event.status });
      broadcast(event);
    } else if (event.type === "permission") {
      pendingPermissions.set(event.request.id, event.request);
      broadcast(event);
    } else if (event.type === "permission-cancelled") {
      pendingPermissions.delete(event.id);
      broadcast(event);
    } else if (event.type === "status" || event.type === "notice") {
      broadcast(event);
    } else if (event.type === "limits") {
      account.session = event.session;
      account.week = event.week;
      account.limitsAt = Date.now();
      broadcast(meterInfo());
    } else if (event.type === "model") {
      account.model = event.name;
      broadcast(meterInfo());
    } else {
      pendingPermissions.clear();
      applyNewTags(reply);
      // Let queued avatar changes land before the turn is reported finished.
      avatar.settled().finally(async () => {
        transcript.flush();
        // Pictures she named are shown under her message, once the files exist (she may just have made them).
        const images = event.type === "done" ? await collectShownImages(reply).catch(() => []) : [];
        if (images.length) {
          transcript.images(images);
          broadcast({ type: "images", images: images.map(({ id, name }) => ({ id, name })) });
        }
        if (event.type === "done") {
          // After a /compact, the size the CLI reports still describes the conversation before it.
          const compacted = opts.raw && /^\/compact\b/.test(userText);
          convo.contextTokens = compacted ? null : provider.usage?.contextTokens ?? null;
          convo.lastReplyAt = Date.now();
        }
        persistTranscript();
        broadcast(event);
        broadcast(meterInfo()); // the context grew
        opts.onFinish?.(event);
      });
    }
  }, opts.images);
}

wss.on("connection", (ws) => {
  const remote = remoteSockets.has(ws);
  clients.add(ws);
  ws.send(JSON.stringify({ type: "hello", provider: provider.name, version: avatar.version }));
  void refreshPack().then(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify(packMessage())));
  ws.send(JSON.stringify(modeInfo()));
  ws.send(JSON.stringify(looksInfo()));
  ws.send(JSON.stringify(meterInfo()));
  ws.send(JSON.stringify({ type: "history", items: transcript.snapshot() }));
  const acp = acpBrain();
  if (acp?.lastError) ws.send(JSON.stringify({ type: "notice", text: acp.lastError }));
  if (acp?.replacedSession) {
    acp.replacedSession = false;
    ws.send(JSON.stringify({ type: "notice", text: `Could not resume that ${settings.provider} session, so this is a new conversation.` }));
  }
  for (const request of pendingPermissions.values()) ws.send(JSON.stringify({ type: "permission", request }));
  const cold = heldMessage ? coldCache(convo) ?? { tokens: convo.contextTokens ?? 0, idleMinutes: 0 } : null;
  if (cold) ws.send(JSON.stringify(coldCacheCard(cold)));
  void refreshOllamaModels();
  ws.on("close", () => clients.delete(ws));
  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "user" && typeof msg.text === "string" && (msg.text.trim() || msg.images?.length)) {
      const say: Say = (text) => ws.send(JSON.stringify({ type: "notice", text }));
      const images = parseImages(msg.images);
      if (typeof images === "string") return say(images);
      const bang = images.length ? null : /^!\s*(\S[\s\S]*)$/.exec(msg.text.trim());
      if (bang) return remote ? say(remoteRefusal) : void (await runBang(bang[1], say));
      const command = images.length ? null : parseSlash(msg.text);
      if (command) {
        const known = slashCommands[command.name];
        if (!known) say(`Unknown command /${command.name}. Try /help.`);
        else if (remote && remoteBlocked(command.name, command.args)) say(remoteRefusal);
        else if (known.claudeOnly && settings.provider !== "claude") {
          say(`/${command.name} needs Claude Code; the current brain is ${provider.name}, which does not support it.`);
        } else await known.run({ args: command.args, text: msg.text, say, reply: (out) => ws.send(JSON.stringify(out)), remote });
        return;
      }
      if (heldMessage) return say("Decide what to do with your earlier message first (the question above).");
      const cold = settings.provider === "claude" && !provider.busy ? coldCache(convo) : null;
      if (cold) return offerColdCache(msg.text, images, cold);
      sendUser(msg.text, images);
    } else if (msg.type === "cold-reply" && typeof msg.choice === "string") {
      answerColdCache(msg.choice, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "permission-reply" && typeof msg.id === "string") {
      const decision = msg.decision as Decision;
      const request = pendingPermissions.get(msg.id);
      if (!["allow", "allow-session", "deny"].includes(decision) || !request) return;
      pendingPermissions.delete(msg.id);
      provider.respondPermission(msg.id, decision);
      broadcast({ type: "permission-resolved", id: msg.id, decision });
      // "Allow, and from now on ...": the approval card can switch the permission mode in the same click.
      if (decision !== "deny" && permissionModes.includes(msg.mode) && !(remote && looserThanAsk(msg.mode)) && request.tool !== "ExitPlanMode") {
        changePermissionMode(msg.mode, (text) => ws.send(JSON.stringify({ type: "notice", text })));
      }
      if (request.tool === "ExitPlanMode" && decision !== "deny") {
        // The approved plan ends plan mode inside Claude Code; keep the selector truthful.
        permissionMode = "manual";
        broadcast(modeInfo());
      }
    } else if (msg.type === "mode" && (msg.mode === "chat" || msg.mode === "work")) {
      await switchMode(msg.mode, remote ? undefined : msg.projectDir, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "pick-folder") {
      if (remote) return ws.send(JSON.stringify({ type: "notice", text: remoteRefusal }));
      await chooseFolder((text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "rename" && typeof msg.name === "string") {
      await rename(msg.name, (text) => ws.send(JSON.stringify({ type: "notice", text })));
      ws.send(JSON.stringify(modeInfo())); // puts the old name back in a box whose edit was refused
    } else if (msg.type === "stop") {
      stopWork((text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "effort" && (msg.value === "default" || isEffort(msg.value))) {
      await changeEffort(msg.value, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "claude-setup" && typeof msg.value === "boolean") {
      if (remote && msg.value) return ws.send(JSON.stringify({ type: "notice", text: remoteRefusal }));
      changeClaudeSetup(msg.value, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "permission-mode" && permissionModes.includes(msg.value)) {
      if (remote && looserThanAsk(msg.value)) return ws.send(JSON.stringify({ type: "notice", text: remoteRefusal }));
      changePermissionMode(msg.value, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "provider" && (msg.provider === "claude" || msg.provider === "ollama" || msg.provider === "cursor" || msg.provider === "opencode")) {
      const notice = (text: string) => ws.send(JSON.stringify({ type: "notice", text }));
      if (provider.busy) return notice("Wait for her to finish the current reply first.");
      if (msg.provider === "ollama") {
        await refreshOllamaModels();
        const chosen = typeof msg.model === "string" && msg.model ? msg.model : (settings.ollamaModel ?? ollamaModels?.[0]);
        if (!chosen) {
          return notice(
            ollamaModels === null
              ? `Could not reach Ollama at ${ollamaHost}. Start it with: ollama serve`
              : "Ollama has no models yet. Pull one, for example: ollama pull llama3.2",
          );
        }
        settings.ollamaModel = chosen;
        mode = "chat"; // no tools on this backend
      }
      if (msg.provider === "cursor" && typeof msg.model === "string" && msg.model) settings.cursorModel = msg.model;
      if (msg.provider === "opencode" && typeof msg.model === "string" && msg.model) settings.opencodeModel = msg.model;
      if (msg.provider !== "claude" && (permissionMode === "auto" || permissionMode === "acceptEdits")) permissionMode = "manual";
      if (msg.provider !== "cursor" && msg.provider !== "opencode" && permissionMode === "everything") permissionMode = "manual";
      const switching = settings.provider !== msg.provider;
      settings.provider = msg.provider;
      await saveSettings(settingsPath, settings);
      if (switching) {
        provider.close();
        provider = providers[settings.provider];
        provider.reset(); // a new brain does not share the other one's memory
        forgetConversationSize();
        transcript.clear();
        persistTranscript();
        notesForModel = [];
        pendingPermissions.clear();
        broadcast({ type: "reset" });
      }
      provider.configure(sessionConfig());
      if (provider instanceof CursorProvider || provider instanceof OpenCodeProvider) {
        const label = provider instanceof CursorProvider ? "Cursor" : "opencode";
        try {
          await provider.whenReady();
          await rememberAcpModel();
        } catch (err) {
          notice(err instanceof Error ? err.message : String(err));
        }
        if (provider.replacedSession) {
          provider.replacedSession = false;
          notice(`Could not resume that ${label} session, so this is a new conversation.`);
        }
      }
      broadcast(modeInfo());
    } else if (msg.type === "reset") {
      resetConversation();
    } else if (msg.type === "look-undo") {
      if (await avatar.undo()) {
        notesForModel.push("The user undid your last look change from the menu.");
        transcript.look(["undid the last change"]);
        broadcast({ type: "avatar", version: avatar.version, applied: ["undid the last change"] });
      }
      broadcast(looksInfo());
    } else if (msg.type === "look-save" && typeof msg.name === "string") {
      const saved = await avatar.saveLook(msg.name);
      if (!saved) ws.send(JSON.stringify({ type: "notice", text: "Please give the look a name." }));
      else ws.send(JSON.stringify({ type: "notice", text: `Saved this look as "${saved}".` }));
      broadcast(looksInfo());
    } else if (msg.type === "look-load" && typeof msg.name === "string") {
      if (await avatar.loadLook(msg.name)) {
        notesForModel.push(`The user switched your look to their saved look '${msg.name}' from the menu.`);
        transcript.look([`load=${msg.name}`]);
        broadcast({ type: "avatar", version: avatar.version, applied: [`load=${msg.name}`] });
      }
      broadcast(looksInfo());
    } else if (msg.type === "preset-thumbs") {
      try {
        ws.send(JSON.stringify({ type: "preset-thumbs", svgs: await avatar.presetThumbnails() }));
      } catch (err) {
        console.error("preset thumbnails failed:", err);
      }
    } else if (msg.type === "look-preset" && typeof msg.name === "string") {
      if (await avatar.loadPreset(msg.name)) {
        transcript.look([`base=${msg.name}`]);
        notesForModel.push(`The user switched your look to the '${msg.name}' preset from the menu.`);
        broadcast({ type: "avatar", version: avatar.version, applied: [`base=${msg.name}`] });
      }
      broadcast(looksInfo());
    } else if (msg.type === "look-delete" && typeof msg.name === "string") {
      await avatar.deleteLook(msg.name);
      broadcast(looksInfo());
    } else if (msg.type === "reset-look") {
      await avatar.resetLook();
      provider.reset();
      forgetConversationSize();
      transcript.clear();
      persistTranscript();
      pendingPermissions.clear();
      broadcast({ type: "reset" });
      broadcast(modeInfo());
      broadcast({ type: "avatar", version: avatar.version, applied: ["back to the original look"] });
      broadcast(looksInfo());
    } else if (msg.type === "gesture-frames" && typeof msg.emotion === "string" && typeof msg.gesture === "string") {
      try {
        const version = avatar.version;
        const svgs = await avatar.gestureFrames(msg.emotion, msg.gesture);
        if (svgs) ws.send(JSON.stringify({ type: "gesture-frames", version, emotion: msg.emotion, gesture: msg.gesture, svgs }));
      } catch (err) {
        console.error("gesture frames failed:", err);
      }
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

async function rememberAcpModel(): Promise<void> {
  const acp = acpBrain();
  if (!acp?.modelId) return;
  const key = settings.provider === "opencode" ? "opencodeModel" : "cursorModel";
  if (acp.modelId === settings[key]) return;
  settings[key] = acp.modelId;
  await saveSettings(settingsPath, settings);
}

if (provider instanceof CursorProvider || provider instanceof OpenCodeProvider) {
  const label = provider instanceof CursorProvider ? "cursor" : "opencode";
  void provider
    .whenReady()
    .then(() => rememberAcpModel().then(() => broadcast(modeInfo())))
    .catch((err) => {
      console.error(`[${label}] ${err instanceof Error ? err.message : err}`);
    });
}

server.listen(port, bindHost, () => {
  console.log(`Companion ready: http://${host}:${port}  (${provider.name})`);
  if (lan) console.log(`Phone access is on. Open one of these on the phone (it is a password, keep it to yourself):\n  ${phoneLinks(port, lanToken).join("\n  ")}`);
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
