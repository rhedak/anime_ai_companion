import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * True when `program` can be started: an executable path, or a name found on the PATH. On Windows a program has an extension (claude.exe,
 * opencode.cmd), so each of PATHEXT is tried as well.
 */
export function isInstalled(program: string, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): boolean {
  const dirs = isAbsolute(program) || program.includes("/") || program.includes("\\") ? [""] : (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const extensions = platform === "win32" ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)] : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      try {
        accessSync(dir ? join(dir, program + extension) : program + extension, constants.X_OK);
        return true;
      } catch {
        // not here
      }
    }
  }
  return false;
}

/** The command each CLI brain starts, as its provider spawns it. Ollama is a server, not a program. */
export function brainProgram(provider: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (provider === "claude") return "claude";
  if (provider === "cursor") return env.CURSOR_AGENT ?? "cursor-agent";
  if (provider === "opencode") return env.OPENCODE_BIN ?? "opencode";
  return null;
}

const PROGRAM_VARIABLE: Record<string, string> = { cursor: "CURSOR_AGENT", opencode: "OPENCODE_BIN" };

/** How to name a brain's program to the user: its name, and when an environment variable chose it, that variable (`CURSOR_AGENT=1` is not a program). */
export function programLabel(provider: string, env: NodeJS.ProcessEnv = process.env): string {
  const program = brainProgram(provider, env) ?? provider;
  const variable = PROGRAM_VARIABLE[provider];
  return variable && env[variable] !== undefined ? `${program} (the value of ${variable})` : program;
}
