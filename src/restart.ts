/**
 * `/restart` from the page. A parent that stays up (anaico in a terminal, `npm start`, the desktop app) sets
 * ANAICO_PARENT_RESTARTS and starts a new server when this one exits with RESTART_EXIT. A `--daemon` server has no
 * parent waiting, so it starts the new one itself and updates data/server.pid.
 */
import { spawn, type SpawnOptions } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";

/** Exit code a waiting parent treats as "start me again". Not an error. */
export const RESTART_EXIT = 75;

/** Set on the server by a parent that will spawn it again. Not a user setting. */
export const PARENT_RESTARTS = "ANAICO_PARENT_RESTARTS";

export function parentRestarts(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PARENT_RESTARTS] === "1";
}

export interface DaemonPid {
  pid: number;
  port: number;
}

export function readDaemonPid(file: string): DaemonPid | null {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown; port?: unknown };
    return Number.isInteger(saved.pid) && Number.isInteger(saved.port) ? { pid: saved.pid as number, port: saved.port as number } : null;
  } catch {
    return null;
  }
}

/** The pid file's next contents when this process is the daemon it names, or null when it is someone else's. */
export function replacedDaemonPid(saved: DaemonPid | null, ownPid: number, childPid: number | undefined): DaemonPid | null {
  if (!saved || saved.pid !== ownPid || !Number.isInteger(childPid)) return null;
  return { pid: childPid as number, port: saved.port };
}

/** Leave this process. With a waiting parent, just exit. Otherwise start the replacement first. */
export function handOff(opts: {
  execPath: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  pidFile: string;
  logFile: string;
  ownPid: number;
  exit: (code: number) => void;
  spawnProcess?: typeof spawn;
}): void {
  if (parentRestarts(opts.env)) {
    opts.exit(RESTART_EXIT);
    return;
  }
  const saved = readDaemonPid(opts.pidFile);
  const daemon = saved?.pid === opts.ownPid;
  let log: number | undefined;
  if (daemon) {
    try {
      log = openSync(opts.logFile, "a");
    } catch {
      // The new process can run without the log.
    }
  }
  const options: SpawnOptions = {
    detached: true,
    windowsHide: true,
    cwd: opts.cwd,
    env: opts.env,
    stdio: log === undefined ? "ignore" : ["ignore", log, log],
  };
  const child = (opts.spawnProcess ?? spawn)(opts.execPath, opts.argv.slice(1), options);
  if (log !== undefined) closeSync(log);
  child.unref();
  const next = replacedDaemonPid(saved, opts.ownPid, child.pid);
  if (next) writeFileSync(opts.pidFile, JSON.stringify(next));
  opts.exit(0);
}
