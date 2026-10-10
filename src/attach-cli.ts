/**
 * `npm run attach` starts an interactive Claude Code session with the companion
 * channel loaded, in the folder you ran it from. Extra arguments go to `claude`:
 *
 *   cd ~/my-project && npm --prefix ~/anime_ai_companion run attach -- --permission-mode auto
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 3737);

try {
  await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
} catch {
  console.error(`The companion server is not running on port ${port}. Start it first:  npm start`);
  process.exit(1);
}

const configPath = join(root, "data/attach-mcp.json");
await mkdir(dirname(configPath), { recursive: true });
await writeFile(
  configPath,
  JSON.stringify({
    mcpServers: {
      companion: {
        command: process.execPath,
        args: [join(root, "src/channel-shim.ts")],
        env: { COMPANION_PORT: String(port) },
      },
    },
  }, null, 2),
);

const cwd = process.env.INIT_CWD ?? process.cwd();
console.log(`Starting Claude Code in ${cwd} with the companion channel.`);
console.log("(Claude Code will ask you to confirm the development channel: choose the local-development option.)\n");

const child = spawn(
  "claude",
  ["--mcp-config", configPath, "--dangerously-load-development-channels", "server:companion", ...process.argv.slice(2)],
  { cwd, stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error(`Could not start claude: ${err.message}`);
  process.exit(1);
});
