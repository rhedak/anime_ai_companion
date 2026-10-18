import type { ChildProcessWithoutNullStreams, SpawnOptions, SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";
import crossSpawn from "cross-spawn";

/**
 * Starts a command-line brain (`claude`, `cursor-agent`, `opencode`). On macOS and Linux this is plain `spawn`. On Windows an npm-installed
 * tool is a `.cmd` shim that `spawn` cannot start by itself (Node refuses it since 20.12), and cross-spawn looks the command up on the PATH
 * (PATHEXT) and runs a shim through cmd.exe with its arguments escaped. A native `.exe` (Claude Code's own installer) needs none of that.
 */
export function spawnCli(command: string, args: string[], options: SpawnOptions): ChildProcessWithoutNullStreams {
  return crossSpawn(command, args, options) as ChildProcessWithoutNullStreams;
}

/** The same lookup for a command that is run once to ask it something (`--version`), as the doctor does. */
export function spawnCliSync(command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string> {
  return crossSpawn.sync(command, args, options);
}
