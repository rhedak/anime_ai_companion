#!/usr/bin/env node
/**
 * `anaico` starts the companion, the way `claude` starts Claude Code.
 *
 *   anaico                    start the server and open the browser
 *   anaico --pro [claude args]   also start Claude Code in this folder with the companion channel
 *
 * If a server is already running on the port, it is reused and left running.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 3737);
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: anaico [--pro] [--no-open] [claude args...]

  (no flags)   start the companion and open it in the browser
  --pro        also start Claude Code in the current folder with the companion channel;
               every other argument goes to claude (e.g. --permission-mode auto)
  --no-open    do not open the browser`);
  process.exit(0);
}

const pro = args.includes("--pro");
const open = !args.includes("--no-open");
const rest = args.filter((a) => a !== "--pro" && a !== "--no-open");

async function serverUp(): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

let server: ChildProcess | null = null;
if (!(await serverUp())) {
  server = spawn(process.execPath, [join(root, "src/server.ts"), ...(open ? ["--open"] : [])], { stdio: "inherit" });
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
  console.log(`Companion already running on http://127.0.0.1:${port}, reusing it.`);
}

function stopServer(): void {
  const s = server;
  server = null;
  s?.kill();
}
process.on("SIGINT", () => { stopServer(); process.exit(130); });
process.on("SIGTERM", () => { stopServer(); process.exit(143); });

if (!pro) {
  if (!server) process.exit(0); // nothing of ours to wait for
  console.log("Companion running. Press Ctrl+C to stop.");
} else {
  const attach = spawn(process.execPath, [join(root, "src/attach-cli.ts"), ...rest], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  attach.on("exit", (code) => {
    stopServer();
    process.exit(code ?? 0);
  });
}
