#!/usr/bin/env node
/**
 * `anaico` starts the companion, the way `claude` starts Claude Code.
 *
 *   anaico                    start the server in work mode for this folder, and open the browser
 *   anaico --chat             start in chat mode instead (the folder is still pre-filled)
 *   anaico --daemon           run the server in the background; it keeps running after the terminal closes
 *   anaico --status | --stop | --restart    look at, stop or restart that background server
 *   anaico --doctor           check what the companion needs (Node, a brain, the creator, the port) and say what is missing
 *
 * If a server is already running on the port, it is reused and left running.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 3737);
const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  console.log(`anaico ${pkg.version} (character creator ${pkg.creator?.ref ?? "unpinned"})`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: anaico [--chat] [--no-open] [--lan]
       anaico --daemon [--chat] [--no-open] [--lan]
       anaico --status | --stop | --restart [--chat] [--no-open] [--lan]
       anaico --doctor | --version

  (no flags)   start the companion in work mode for the current folder and open the browser
  --chat       start in chat mode (no tools); the current folder is still pre-filled for Work
  --no-open    do not open the browser
  --lan        also let devices on your network in (your phone): it prints a link with a secret token, and
               /phone in the chat shows it again. Off again at every start. Only on a network you trust.

  --daemon     run the server in the background; it keeps running after you close the terminal.
               Log: data/server.log
  --status     say whether the background server is running
  --stop       stop the background server
  --restart    stop it and start it again (in the current folder; takes --chat and --no-open)
  --version    print the version, and the character creator release it is pinned to
  --doctor     check what it needs (Node, a brain, the character creator, the port) and say what is missing;
               it only looks, it changes nothing`);
  process.exit(0);
}

const daemon = args.includes("--daemon");
const status = args.includes("--status");
const stop = args.includes("--stop");
const restart = args.includes("--restart");
const chat = args.includes("--chat");
const open = !args.includes("--no-open");
const lan = args.includes("--lan");
const known = new Set(["--no-open", "--lan", "--chat", "--daemon", "--status", "--stop", "--restart", "--doctor", "--version", "-v", "--help", "-h"]);
const unknown = args.filter((a) => !known.has(a));
if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(" ")}${unknown.includes("--pro") ? " (the --pro terminal mode was removed; use the Work mode in the browser, and /setup on to load your own Claude Code setup)" : ""}\nTry: anaico --help`);
  process.exit(2);
}
if (args.includes("--doctor")) {
  const { doctor } = await import("./doctor.ts");
  process.exit(await doctor(root, port));
}
const url = `http://127.0.0.1:${port}`;

async function serverUp(): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- the background server: data/server.pid says which process it is ----

const pidFile = join(root, "data/server.pid");
const logFile = join(root, "data/server.log");

interface Daemon {
  pid: number;
  port: number;
}

function readDaemon(): Daemon | null {
  try {
    const saved = JSON.parse(readFileSync(pidFile, "utf8"));
    return Number.isInteger(saved.pid) && Number.isInteger(saved.port) ? saved : null;
  } catch {
    return null;
  }
}

/** True only if this pid is alive and really is our server, so a reused pid is never signalled. */
function isOurServer(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).includes("src/server.ts");
  } catch {
    return false;
  }
}

async function stopDaemon(): Promise<"stopped" | "not-running"> {
  const saved = readDaemon();
  if (!saved || !isOurServer(saved.pid)) {
    rmSync(pidFile, { force: true });
    return "not-running";
  }
  process.kill(saved.pid, "SIGTERM");
  for (let i = 0; i < 40 && isOurServer(saved.pid); i++) await sleep(250);
  if (isOurServer(saved.pid)) process.kill(saved.pid, "SIGKILL");
  rmSync(pidFile, { force: true });
  return "stopped";
}

function startDaemon(): number {
  mkdirSync(dirname(logFile), { recursive: true });
  try {
    if (statSync(logFile).size > 1_000_000) renameSync(logFile, `${logFile}.old`); // keep the log small
  } catch {
    // no log yet
  }
  const log = openSync(logFile, "a");
  const serverArgs = ["--project-dir", process.cwd(), ...(chat ? ["--chat"] : []), ...(open ? ["--open"] : []), ...(lan ? ["--lan"] : [])];
  // detached: its own session, so closing this terminal does not signal it.
  const child = spawn(process.execPath, [join(root, "src/server.ts"), ...serverArgs], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.unref();
  writeFileSync(pidFile, JSON.stringify({ pid: child.pid, port }));
  return child.pid!;
}

if (status || stop || restart || daemon) {
  const saved = readDaemon();
  const running = saved !== null && isOurServer(saved.pid);

  if (status) {
    if (running) console.log(`Companion running in the background (pid ${saved.pid}) on http://127.0.0.1:${saved.port}. Log: ${logFile}`);
    else if (await serverUp()) console.log(`A companion server is running on ${url}, but not as a background server started with --daemon (stop it in its own terminal).`);
    else console.log("The background companion is not running.");
    process.exit(0);
  }

  if (stop || restart) {
    if (running) {
      await stopDaemon();
      console.log("Stopped the background companion.");
    } else if (await serverUp()) {
      console.error(`A server is running on ${url}, but it was not started with --daemon, so I will not touch it. Stop it in its own terminal (Ctrl+C).`);
      process.exit(1);
    } else {
      rmSync(pidFile, { force: true });
      console.log(stop ? "The background companion is not running." : "It was not running; starting it.");
    }
    if (stop) process.exit(0);
  }

  // --daemon or --restart: start it
  if (await serverUp()) {
    console.log(`Companion already running on ${url}, leaving it as it is (use --restart to apply new options${lan ? ", such as --lan" : ""}).`);
    process.exit(0);
  }
  const pid = startDaemon();
  for (let i = 0; i < 60 && !(await serverUp()); i++) await sleep(500);
  if (!(await serverUp())) {
    console.error(`The companion did not come up; see ${logFile}.`);
    rmSync(pidFile, { force: true });
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    process.exit(1);
  }
  console.log(`Companion running in the background (pid ${pid}) on ${url}. Stop it with: anaico --stop. Log: ${logFile}`);
  process.exit(0);
}

let server: ChildProcess | null = null;
if (!(await serverUp())) {
  const serverArgs = ["--project-dir", process.cwd(), ...(chat ? ["--chat"] : []), ...(open ? ["--open"] : []), ...(lan ? ["--lan"] : [])];
  server = spawn(process.execPath, [join(root, "src/server.ts"), ...serverArgs], { stdio: "inherit" });
  const started = server;
  started.on("exit", (code) => {
    if (server === started) process.exit(code ?? 1);
  });
  for (let i = 0; i < 60 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await serverUp())) {
    console.error("The companion server did not come up; see the messages above.");
    server.kill();
    process.exit(1);
  }
} else {
  console.log(`Companion already running on http://127.0.0.1:${port}, reusing it (its folder and mode stay as they are${lan ? "; --lan only applies to a server this command starts, so stop it first" : ""}).`);
}

function stopServer(): void {
  const s = server;
  server = null;
  s?.kill();
}
process.on("SIGINT", () => { stopServer(); process.exit(130); });
process.on("SIGTERM", () => { stopServer(); process.exit(143); });

if (!server) process.exit(0); // nothing of ours to wait for
console.log("Companion running. Press Ctrl+C to stop.");
