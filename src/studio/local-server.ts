import { spawn, type ChildProcess } from "node:child_process";
import { dirname } from "node:path";

/**
 * The user's own local image server, started and stopped from the pack studio (docs/pack-studio.md, "Your own Python for a local model"). The program
 * and the script are the user's, named by whole paths in their settings and confirmed on a card; this module only runs `<python> <script> --port <n>
 * --device <d>` as a child process of the app (no shell), keeps the last lines it printed, and stops it. It listens where the script says it does: the
 * app talks to it on 127.0.0.1 only (src/studio/backend.ts).
 */

export const DEVICES = ["mps", "cuda", "cpu"] as const;
export type Device = (typeof DEVICES)[number];
export const isDevice = (value: unknown): value is Device => typeof value === "string" && (DEVICES as readonly string[]).includes(value);

export type LocalStatus = "stopped" | "starting" | "running" | "failed";

export interface LocalSnapshot {
  status: LocalStatus;
  /** The command it was started with, as text. */
  command: string | null;
  /** The last lines it printed (output and errors). */
  log: string[];
  /** Why it is not running, when it failed or stopped by itself. */
  problem: string | null;
}

const MAX_LOG_LINES = 80;
const MAX_LINE = 400;
/** How long a server may take to answer /health before it counts as failed (the model itself loads later, on the first picture). */
const START_WAIT_MS = 30_000;

/** The environment the user's server gets: this app's own, without anything that looks like a key, token or secret (the server has no use for them, and it is a program of the user's own choosing). */
export function serverEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) if (!/(KEY|TOKEN|SECRET|PASSWORD)$/i.test(name)) out[name] = value;
  return out;
}

export function commandText(python: string, script: string, port: number, device: Device): string {
  const part = (path: string) => (/\s/.test(path) ? `"${path}"` : path);
  return `${part(python)} ${part(script)} --port ${port} --device ${device}`;
}

export class LocalServer {
  private child: ChildProcess | null = null;
  private snapshot: LocalSnapshot = { status: "stopped", command: null, log: [], problem: null };
  private pending = "";
  private generation = 0;

  private readonly changed: () => void;
  private readonly env: () => NodeJS.ProcessEnv;

  constructor(changed: () => void, env: () => NodeJS.ProcessEnv = () => process.env) {
    this.changed = changed;
    this.env = env;
  }

  get state(): LocalSnapshot {
    return { ...this.snapshot, log: [...this.snapshot.log] };
  }

  private set(patch: Partial<LocalSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.changed();
  }

  private line(text: string): void {
    const clean = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, MAX_LINE);
    if (!clean.trim()) return;
    this.snapshot.log = [...this.snapshot.log, clean].slice(-MAX_LOG_LINES);
  }

  private take(chunk: Buffer): void {
    const parts = (this.pending + chunk.toString("utf8")).split(/\r?\n/);
    this.pending = parts.pop() ?? "";
    for (const part of parts) this.line(part);
    this.changed();
  }

  /** Starts the server and resolves once it answers /health (or says why not). It never starts a second one. */
  async start(python: string, script: string, port: number, device: Device, health: (signal: AbortSignal) => Promise<boolean>): Promise<void> {
    if (this.child) throw new Error("The local image server is already running. Stop it first.");
    const mine = ++this.generation;
    const command = commandText(python, script, port, device);
    this.pending = "";
    this.snapshot = { status: "starting", command, log: [], problem: null };
    this.changed();
    // No shell: the paths are arguments, so a name with a space or a symbol means what it says. It runs in the script's own folder.
    const child = spawn(python, [script, "--port", String(port), "--device", device], { cwd: dirname(script), env: serverEnv(this.env()), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => this.take(chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.take(chunk));
    const gone = new Promise<string>((resolve) => {
      child.once("error", (error) => resolve(`It could not be started: ${error.message}`));
      child.once("exit", (code, signal) => resolve(signal ? `It was stopped (${signal}).` : `It exited with code ${code} before it answered.`));
    });
    child.once("exit", () => {
      if (this.generation !== mine) return;
      if (this.pending.trim()) this.line(this.pending);
      this.pending = "";
      this.child = null;
      if (this.snapshot.status === "running") this.set({ status: "stopped", problem: "It stopped." });
    });
    child.once("error", () => {
      if (this.generation === mine) this.child = null;
    });
    const deadline = Date.now() + START_WAIT_MS;
    while (Date.now() < deadline) {
      const early = await Promise.race([gone, new Promise<null>((r) => setTimeout(() => r(null), 300))]);
      if (early !== null) {
        if (this.generation === mine) this.set({ status: "failed", problem: early });
        throw new Error(early);
      }
      if (await health(AbortSignal.timeout(800))) {
        if (this.generation === mine) this.set({ status: "running", problem: null });
        return;
      }
    }
    await this.stop();
    const problem = `It did not answer at port ${port} within ${START_WAIT_MS / 1000} seconds. See what it printed below.`;
    this.set({ status: "failed", problem });
    throw new Error(problem);
  }

  /** Stops it: a polite end first, then a forced one. A server the app did not start is never touched. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.generation++;
    this.child = null;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("exit", () => {
        clearTimeout(force);
        resolve();
      });
      if (child.exitCode !== null || child.signalCode !== null) {
        clearTimeout(force);
        return resolve();
      }
      child.kill("SIGTERM");
    });
    this.set({ status: "stopped", problem: null });
  }
}
