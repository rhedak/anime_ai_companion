import { spawn } from "node:child_process";

export interface ShellResult {
  /** stdout and stderr in the order they arrived, without colour codes. */
  output: string;
  /** null if it was killed. */
  code: number | null;
  timedOut: boolean;
  truncated: boolean;
}

export interface ShellOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Aborting stops the command and everything it started. */
  signal?: AbortSignal;
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * Runs one line in the user's shell, non-interactively (no terminal, no input), in `cwd`. It is
 * what typing `!command` does: the command comes straight from the user and nothing asks first.
 */
export function runShell(command: string, cwd: string, opts: ShellOptions = {}): Promise<ShellResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxBytes = opts.maxBytes ?? 100_000;
  return new Promise((resolve) => {
    // detached: its own process group, so a timeout can end the whole pipeline it started.
    const child = spawn(process.env.SHELL || "/bin/sh", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, TERM: "dumb", NO_COLOR: "1", GIT_PAGER: "cat", PAGER: "cat" },
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let timedOut = false;
    const take = (chunk: Buffer) => {
      if (size >= maxBytes) {
        truncated = true;
        return;
      }
      const room = maxBytes - size;
      chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
      if (chunk.length > room) truncated = true;
      size += Math.min(chunk.length, room);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const killGroup = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    opts.signal?.addEventListener("abort", killGroup, { once: true });
    const finish = (code: number | null, extra = "") => {
      clearTimeout(timer);
      resolve({ output: Buffer.concat(chunks).toString("utf8").replace(ANSI, "") + extra, code, timedOut, truncated });
    };
    child.on("error", (err) => finish(127, `Could not start the shell: ${err.message}\n`));
    child.on("close", (code) => finish(code));
  });
}
