import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { AvatarService } from "./avatar.ts";
import { shareNudge } from "./share-nudge.ts";
import { Transcript, claudeSessionExists, type ShownRecord } from "./transcript.ts";
import { findAvatarTags, findImageTags } from "./avatar-tags.ts";
import { resolveCreatorSrc } from "./creator.ts";
import { MAX_MESSAGE_BYTES, parseImages, type ImageInput } from "./images.ts";
import { listSessions, loadSessionItems, sessionPath, type SessionInfo } from "./sessions.ts";
import { ClaudeCodeProvider } from "./providers/claude-code.ts";
import { listOllamaModels, OllamaProvider } from "./providers/ollama.ts";
import { prettyModel, type Limit } from "./providers/claude-stream.ts";
import { randomUUID } from "node:crypto";
import { checkShownImage } from "./shown-images.ts";
import { runShell } from "./shell.ts";
import { loadUserEffort, resolveEffort, efforts, isEffort, type Effort } from "./claude-settings.ts";
import { checkProjectDir, loadSettings, saveSettings, type ProviderName } from "./settings.ts";
import { permissionModes, type Decision, type Mode, type PermissionMode, type PermissionRequest, type Provider, type SessionConfig } from "./providers/types.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(root, "public");
const workspace = join(root, "workspace");
const customCssPath = join(root, "data/custom.css");
const port = Number(process.env.PORT ?? 3737);
// Local only: this server can run Claude Code, so never expose it on the network.
const host = "127.0.0.1";

await mkdir(workspace, { recursive: true });
const personaBase = await readFile(join(root, "persona.md"), "utf8");
const emotions = JSON.parse(await readFile(join(root, "emotions.json"), "utf8"));

const creatorSrc = await resolveCreatorSrc();
const avatar = new AvatarService({
  creatorSrc,
  python: process.env.PYTHON ?? "python3",
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
      if (settings.provider === "claude" && !process.argv.includes("--chat")) mode = "work";
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
      : mode === "work" ? settings.workModel : settings.chatModel,
  allowedTools: settings.allowedTools,
  permissionMode,
  claudeSetup,
  effort: effectiveEffort(),
});

const persona = (config: SessionConfig) =>
  personaBase +
  (config.mode === "work" ? `\n${personaWork}\nProject folder: ${config.cwd}\n` : "") +
  "\n" +
  avatar.promptSection();

// What the chat log shows, and which Claude Code session it belongs to, survive a restart.
const transcript = new Transcript(join(root, "data/transcript.json"));
const savedLog = await transcript.load();
const resumable =
  savedLog?.provider === "claude" && savedLog.sessionId && (await claudeSessionExists(savedLog.sessionId))
    ? savedLog.sessionId
    : undefined;
if (!resumable && savedLog?.provider === "claude") transcript.clear(); // its session is gone: start clean

const providers: Record<ProviderName, Provider> = {
  claude: new ClaudeCodeProvider({
    config: sessionConfig(),
    chatCwd: workspace,
    persona,
    resumeSessionId: resumable,
  }),
  ollama: new OllamaProvider({
    host: ollamaHost,
    model: settings.ollamaModel ?? "",
    persona: () => persona(sessionConfig()),
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

const modeInfo = () => ({
  type: "mode",
  mode,
  provider: settings.provider,
  canUseTools: provider.canUseTools,
  ollamaModels,
  ollamaModel: settings.ollamaModel,
  projectDir: settings.projectDir,
  model: sessionConfig().model,
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
    `connect-src 'self' ws://${host}:${port} ws://localhost:${port}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

const server = createServer(async (req, res) => {
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

// Browsers connect on /ws, and only from our own origin.
server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/ws" && allowedOrigins.has(String(req.headers.origin))) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
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
      .save({ provider: settings.provider, sessionId: provider.sessionId })
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
    if (!provider.canUseTools) return say("This model cannot use tools. Switch to Claude Code for work mode.");
    const folder = typeof dir === "string" && dir.trim() ? dir : settings.projectDir;
    if (!folder) return say("Choose a project folder first.");
    const check = await checkProjectDir(folder);
    if (!check.ok) return say(check.reason);
    settings.projectDir = check.dir;
    await saveSettings(settingsPath, settings);
  }
  mode = wanted;
  provider.configure(sessionConfig());
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

function changePermissionMode(value: PermissionMode, say: Say): void {
  if (!provider.canUseTools) say("This model cannot use tools, so there are no permissions.");
  else {
    permissionMode = value;
    if (provider.setPermissionMode) provider.setPermissionMode(value);
    else provider.configure(sessionConfig());
  }
  broadcast(modeInfo());
}

const permissionNames: Record<string, PermissionMode> = { ask: "manual", plan: "plan", accept: "acceptEdits", auto: "auto" };

interface CommandContext {
  /** Everything after the command name. */
  args: string;
  /** The full line as typed. */
  text: string;
  say: Say;
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
    claudeOnly: true,
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
    run: ({ args, say }) => {
      if (settings.provider === "ollama") return say("Pick the Ollama model in the dropdown.");
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
  work: { help: "switch to work mode, optionally for a folder: /work ~/project", claudeOnly: true, run: ({ args, say }) => switchMode("work", args, say) },
  permissions: {
    help: "ask, plan, accept (edits) or auto: how work mode handles approvals",
    claudeOnly: true,
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
  setup: {
    help: "work mode: use your own Claude Code setup (settings, hooks, MCP servers): /setup on | off",
    claudeOnly: true,
    run: ({ args, say }) => {
      const wanted = args.toLowerCase();
      if (wanted === "on" || wanted === "off") return changeClaudeSetup(wanted === "on", say);
      say(`Your Claude Code setup is ${claudeSetup ? "on" : "off"} in work mode. Use /setup on | off`);
    },
  },
  plan: { help: "same as /permissions plan", claudeOnly: true, run: ({ say }) => changePermissionMode("plan", say) },
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

async function resumeCommand(args: string, say: Say): Promise<void> {
  if (!provider.resume) return say("/resume needs Claude Code; this model has no saved sessions.");
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

function resetConversation(): void {
  provider.reset();
  transcript.clear();
  persistTranscript();
  notesForModel = [];
  pendingPermissions.clear();
  broadcast({ type: "reset" });
  broadcast(modeInfo());
}

/** Runs one user turn: streams the reply, applies any [avatar ...] tags as they complete. */
function runTurn(userText: string, opts: { raw?: boolean; images?: ImageInput[] } = {}): void {
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
        persistTranscript();
        broadcast(event);
        broadcast(meterInfo()); // the context grew
      });
    }
  }, opts.images);
}

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "hello", provider: provider.name, version: avatar.version }));
  ws.send(JSON.stringify(modeInfo()));
  ws.send(JSON.stringify(looksInfo()));
  ws.send(JSON.stringify(meterInfo()));
  ws.send(JSON.stringify({ type: "history", items: transcript.snapshot() }));
  for (const request of pendingPermissions.values()) ws.send(JSON.stringify({ type: "permission", request }));
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
      if (bang) return void (await runBang(bang[1], say));
      const command = images.length ? null : parseSlash(msg.text);
      if (command) {
        const known = slashCommands[command.name];
        if (!known) say(`Unknown command /${command.name}. Try /help.`);
        else if (known.claudeOnly && settings.provider !== "claude") {
          say(`/${command.name} needs Claude Code; the current brain is ${provider.name}, which does not support it.`);
        } else await known.run({ args: command.args, text: msg.text, say });
        return;
      }
      transcript.user(msg.text, images.length);
      broadcast({ type: "user", text: msg.text, images: images.map((i) => `data:${i.mediaType};base64,${i.data}`) });
      runTurn(msg.text, { images });
    } else if (msg.type === "permission-reply" && typeof msg.id === "string") {
      const decision = msg.decision as Decision;
      const request = pendingPermissions.get(msg.id);
      if (!["allow", "allow-session", "deny"].includes(decision) || !request) return;
      pendingPermissions.delete(msg.id);
      provider.respondPermission(msg.id, decision);
      broadcast({ type: "permission-resolved", id: msg.id, decision });
      // "Allow, and from now on ...": the approval card can switch the permission mode in the same click.
      if (decision !== "deny" && permissionModes.includes(msg.mode) && request.tool !== "ExitPlanMode") {
        changePermissionMode(msg.mode, (text) => ws.send(JSON.stringify({ type: "notice", text })));
      }
      if (request.tool === "ExitPlanMode" && decision !== "deny") {
        // The approved plan ends plan mode inside Claude Code; keep the selector truthful.
        permissionMode = "manual";
        broadcast(modeInfo());
      }
    } else if (msg.type === "mode" && (msg.mode === "chat" || msg.mode === "work")) {
      await switchMode(msg.mode, msg.projectDir, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "stop") {
      stopWork((text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "effort" && (msg.value === "default" || isEffort(msg.value))) {
      await changeEffort(msg.value, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "claude-setup" && typeof msg.value === "boolean") {
      changeClaudeSetup(msg.value, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "permission-mode" && permissionModes.includes(msg.value)) {
      changePermissionMode(msg.value, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "provider" && (msg.provider === "claude" || msg.provider === "ollama")) {
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
      const switching = settings.provider !== msg.provider;
      settings.provider = msg.provider;
      await saveSettings(settingsPath, settings);
      if (switching) {
        provider.close();
        provider = providers[settings.provider];
        provider.reset(); // a new brain does not share the other one's memory
        transcript.clear();
        persistTranscript();
        notesForModel = [];
        pendingPermissions.clear();
        broadcast({ type: "reset" });
      }
      provider.configure(sessionConfig());
      broadcast(modeInfo());
    } else if (msg.type === "reset") {
      resetConversation();
    } else if (msg.type === "look-undo") {
      if (await avatar.undo()) {
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
