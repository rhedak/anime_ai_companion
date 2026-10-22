/**
 * What `npm start` runs: the server, and again when the page's `/restart` asks (exit 75).
 * Ctrl+C stops it, and does not start another.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../src/server.ts", import.meta.url));
let child = null;
let stopping = false;

function launch() {
  child = spawn(process.execPath, [server, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, ANAICO_PARENT_RESTARTS: "1" },
  });
  child.on("exit", (code) => {
    if (stopping) process.exit(code ?? 0);
    if (code === 75) return launch();
    process.exit(code ?? 1);
  });
}

function stop() {
  stopping = true;
  child?.kill("SIGTERM");
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
launch();
