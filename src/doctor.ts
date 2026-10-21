/**
 * `anaico --doctor`: looks at what the app needs and says what is missing, in plain words. It only looks: nothing is installed,
 * started or signed in. Every check goes through a `Probe`, so the checks can be tested without this machine's real setup.
 */
import { OPENCODE_PIN, opencodeAsset, opencodeFolder, opencodeUrl } from "./install-opencode.ts";
import { spawnCli, spawnCliSync } from "./spawn-cli.ts";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { MIN_NODE, tooOld } from "../bin/check-node.js";

export type Level = "ok" | "warn" | "fail";
export interface DoctorLine {
  level: Level;
  text: string;
  /** What to do about it, when there is something to do. */
  hint?: string;
}

export interface Probe {
  env: Record<string, string | undefined>;
  nodeVersion: string;
  /** This repository's folder. */
  root: string;
  home: string;
  port: number;
  /** Runs a program for its output; null when it is not there or does not answer. The app's own `/doctor` answers asynchronously, so the server is never held up by a program that hangs. */
  run(command: string, args: string[]): string | null | Promise<string | null>;
  /** True when the checks run inside the app (`/doctor`): its own server holds the port, so the port is not tested, and where the app keeps things is what is described. */
  app?: boolean;
  exists(path: string): boolean;
  readText(path: string): string | null;
  writable(dir: string): boolean;
  /** The body of a GET, or null when nothing answers. */
  get(url: string): Promise<string | null>;
  portFree(port: number): Promise<boolean>;
}

/** Asks a program something once (`--version`) without blocking: null when it is not there, fails, or has not answered in `ms`. */
function askProgram(command: string, args: string[], ms: number): Promise<string | null> {
  return new Promise((resolveAnswer) => {
    let out = "";
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolveAnswer(value);
    };
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch {
      return resolveAnswer(null);
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, ms);
    child.stdout?.on("data", (c) => (out += String(c)));
    child.stderr?.on("data", (c) => (out += String(c)));
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 ? out.trim() : null));
  });
}

export function realProbe(root: string, port: number, inApp = false): Probe {
  return {
    env: process.env,
    nodeVersion: process.versions.node,
    root,
    home: homedir(),
    port,
    ...(inApp ? { app: true } : {}),
    run(command, args) {
      if (inApp) return askProgram(command, args, 6000);
      const result = spawnCliSync(command, args, { encoding: "utf8", timeout: 8000 });
      if (result.error || result.status !== 0) return null;
      return `${result.stdout}${result.stderr}`.trim();
    },
    exists: existsSync,
    readText(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    writable(dir) {
      try {
        accessSync(dir, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    async get(url) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        return await res.text();
      } catch {
        return null;
      }
    },
    portFree(p) {
      return new Promise((resolvePort) => {
        const server = createServer();
        server.once("error", () => resolvePort(false));
        server.listen(p, "127.0.0.1", () => server.close(() => resolvePort(true)));
      });
    },
  };
}

const firstLine = (text: string) => text.split("\n")[0].trim();

export async function checkAll(p: Probe): Promise<DoctorLine[]> {
  const lines: DoctorLine[] = [];
  const add = (level: Level, text: string, hint?: string) => lines.push({ level, text, hint });

  // Node
  if (tooOld(p.nodeVersion)) add("fail", `Node ${p.nodeVersion} is too old`, `Install Node ${MIN_NODE} or newer: https://nodejs.org`);
  else add("ok", `Node ${p.nodeVersion} (needs ${MIN_NODE.replace(/\.0$/, "")} or newer)`);

  // Dependencies
  if (p.exists(join(p.root, "node_modules", "ws"))) add("ok", "npm packages are installed");
  else add("fail", "npm packages are not installed", "Run: npm install");

  // The character creator: its TypeScript draws her, in this process (no Python, no other program)
  const creatorRoot = resolve(p.root, "../anime-character-creator");
  const sibling = join(creatorRoot, "ts/src");
  const pinned = (() => {
    try {
      return JSON.parse(p.readText(join(p.root, "package.json")) ?? "{}").creator?.ref as string | undefined;
    } catch {
      return undefined;
    }
  })();
  const clonedRoot = pinned ? join(p.env.ANAICO_HOME ?? join(p.home, ".anaico"), "creator", pinned) : "";
  const cloned = clonedRoot ? join(clonedRoot, "ts/src") : "";
  const hasTypeScript = (dir: string) => p.exists(join(dir, "render.ts"));
  const notTypeScript = (dir: string, what: string) =>
    add("fail", `Character creator: ${dir} (${what}) has no render.ts, so it is not the creator's TypeScript`, "Point it at the creator's ts/src folder. The releases before its TypeScript kept the Python package in src/, which this version no longer reads.");
  if (p.env.CREATOR_SRC) {
    if (!p.exists(p.env.CREATOR_SRC)) add("fail", `CREATOR_SRC points at ${p.env.CREATOR_SRC}, which does not exist`, "Fix the path, or unset CREATOR_SRC to use a checkout next to this repo or the pinned release.");
    else if (!hasTypeScript(p.env.CREATOR_SRC)) notTypeScript(p.env.CREATOR_SRC, "CREATOR_SRC");
    else add("ok", `Character creator: ${p.env.CREATOR_SRC} (CREATOR_SRC)`);
  } else if (p.exists(sibling)) {
    if (!hasTypeScript(sibling)) notTypeScript(sibling, "the checkout next to this repo");
    else {
      // The release this version was made for (package.json) is what a fresh install gets; a checkout of the creator's main may be ahead of it.
      const at = pinned ? await p.run("git", ["-C", creatorRoot, "describe", "--tags", "--always"]) : null;
      if (pinned && at && at !== pinned) {
        add("warn", `Character creator: the checkout next to this repo is at ${at}, not the release this version pins (${pinned})`, `Fine for development, but a fresh install uses ${pinned}. To match it: git -C ${creatorRoot} checkout ${pinned}`);
      } else add("ok", `Character creator: the checkout next to this repo (${sibling})`);
    }
  } else if (clonedRoot && p.exists(clonedRoot)) {
    if (hasTypeScript(cloned)) add("ok", `Character creator ${pinned}: already fetched (${cloned})`);
    else notTypeScript(cloned, `the copy fetched for ${pinned}`);
  } else if (await p.run("git", ["--version"])) {
    const older = p.exists(join(creatorRoot, "src")) ? ` The checkout next to this repo (${creatorRoot}) has no ts/src, a release before the TypeScript, so it is not used.` : "";
    add("warn", `Character creator ${pinned ?? ""}: not here yet, so the first start downloads it into ${cloned || "~/.anaico/creator"}`, `That needs internet once. Or clone it next to this repo: git clone https://github.com/rhedak/anime-character-creator.git ../anime-character-creator.${older}`);
  } else add("fail", "Character creator: not found, and git is not installed to fetch it", "Install git, or clone https://github.com/rhedak/anime-character-creator.git next to this repo and run again.");

  // Brains: at least one must be there. Whether you are signed in is the brain's own business, so this does not try.
  const dataRoot = p.env.ANAICO_DATA ? resolve(p.env.ANAICO_DATA) : join(p.root, "data");
  // The opencode that would run: the user's own choice (OPENCODE_BIN), else the pinned copy this app installed, else whatever is on the PATH.
  const asset = opencodeAsset();
  const pinnedFolder = opencodeFolder(dataRoot);
  const managed = asset && p.exists(join(pinnedFolder, asset.program)) ? join(pinnedFolder, asset.program) : null;
  const opencodeProgram = p.env.OPENCODE_BIN ?? managed ?? "opencode";
  const [claude, cursor, opencode, onPath] = await Promise.all([
    p.run("claude", ["--version"]),
    p.run("cursor-agent", ["--version"]),
    p.run(opencodeProgram, ["--version"]),
    managed || p.env.OPENCODE_BIN ? p.run("opencode", ["--version"]) : null, // another copy on the PATH, which is then not the one used
  ]);
  const host = (p.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
  const tags = await p.get(`${host}/api/tags`);
  let ollamaModels: number | null = null;
  try {
    if (tags) ollamaModels = (JSON.parse(tags).models ?? []).length;
  } catch {
    ollamaModels = null;
  }
  const found: string[] = [];
  if (claude) found.push("Claude Code");
  if (cursor) found.push("Cursor");
  if (opencode) found.push("opencode");
  if (ollamaModels !== null) found.push("Ollama");
  const brain = (name: string, version: string | null, note: string) =>
    version ? add("ok", `${name} ${firstLine(version)}`, note) : add("warn", `${name}: not found`, `Only needed if you want to use it. ${note}`);
  brain("Claude Code", claude, "Sign in once by running `claude` in a terminal.");
  brain("Cursor", cursor, "Sign in once with `cursor-agent login`, or set CURSOR_API_KEY.");
  if (p.env.OPENCODE_BIN) {
    add(opencode ? "ok" : "warn", `opencode: OPENCODE_BIN (${p.env.OPENCODE_BIN}) is used${opencode ? `, ${firstLine(opencode)}` : ", but it does not answer"}; it wins over the app's own copy`, "Unset OPENCODE_BIN to use the app's own copy (/install-opencode installs it).");
  } else if (managed) {
    add(opencode ? "ok" : "warn", `opencode: the app's own copy is used (${opencode ? firstLine(opencode) : "it does not answer"}), the pinned version ${OPENCODE_PIN.version}, in ${pinnedFolder}${onPath ? `; another opencode on the PATH (${firstLine(onPath)}) is not used` : ""}`, opencode ? undefined : "Type /install-opencode to fetch it again.");
  } else if (opencode) {
    add("ok", `opencode: ${firstLine(opencode)}, found on the PATH`, `It is not the version this app was made for (${OPENCODE_PIN.version}). Type /install-opencode in the app to install that one for the app only; it is then used instead of this one. Sign in once with \`opencode auth login\`.`);
  } else if (asset) {
    add("warn", "opencode: not found", `Only needed if you want to use it. Type /install-opencode in the app: it asks, then downloads the pinned version ${OPENCODE_PIN.version} (checked against a known checksum) into ${pinnedFolder}. By hand: ${opencodeUrl(asset)} unpacked there.`);
  } else {
    add("warn", "opencode: not found", `Only needed if you want to use it. There is no pinned download for this computer (${process.platform} ${process.arch}); install it from https://opencode.ai.`);
  }
  if (ollamaModels === null) add("warn", `Ollama: nothing answers at ${host}`, "Only needed for local models. Install it from https://ollama.com, run `ollama serve`, and `ollama pull llama3.2`.");
  else if (ollamaModels === 0) add("warn", `Ollama answers at ${host}, but has no models`, "Pull one, for example: ollama pull llama3.2");
  else add("ok", `Ollama at ${host} with ${ollamaModels} model${ollamaModels === 1 ? "" : "s"}`);
  if (!found.length) add("fail", "No brain found: she needs Claude Code, Cursor, opencode or Ollama", "Install one of them (the README says how), then run this again.");

  // Port
  if (p.app) add("ok", `Running on port ${p.port}`);
  else if (await p.portFree(p.port)) add("ok", `Port ${p.port} is free`);
  else if ((await p.get(`http://127.0.0.1:${p.port}/`)) !== null) add("ok", `Port ${p.port}: something answers, probably the companion is already running`, "`anaico --status` says whether it is the background one.");
  else add("warn", `Port ${p.port} is in use by something that is not answering as a web page`, "Set PORT=<another number> to use a different one.");

  // Where her data lives
  const data = dataRoot;
  if (p.exists(data) ? p.writable(data) : p.writable(p.root)) add("ok", p.app ? `Her data folder is writable (${data}: settings, chat log, her look)` : "data/ is writable (settings, chat log, her look)");
  else add("fail", "data/ is not writable", `Fix the permissions on ${p.exists(data) ? data : p.root}.`);

  return lines;
}

const mark: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };

export function formatDoctor(lines: DoctorLine[]): string {
  const body = lines.map((l) => `${mark[l.level]} ${l.text}${l.hint && l.level !== "ok" ? `\n    ${l.hint}` : ""}`).join("\n");
  const fails = lines.filter((l) => l.level === "fail").length;
  const warns = lines.filter((l) => l.level === "warn").length;
  const summary = fails
    ? `${fails} problem${fails === 1 ? "" : "s"} to fix before it will start.`
    : warns
      ? "Ready to start. The ! lines are optional."
      : "Everything looks fine.";
  return `${body}\n\n${summary}`;
}

/** Runs the checks, prints them, and returns the exit code (1 when something must be fixed). */
export async function doctor(root: string, port: number, probe: Probe = realProbe(root, port)): Promise<number> {
  console.log("anaico doctor: looking at what the companion needs (nothing is changed)\n");
  const lines = await checkAll(probe);
  console.log(formatDoctor(lines));
  return lines.some((l) => l.level === "fail") ? 1 : 0;
}
