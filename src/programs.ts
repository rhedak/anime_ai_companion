import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/** True when `program` can be started: an executable path, or a name found on the PATH. */
export function isInstalled(program: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const dirs = isAbsolute(program) || program.includes("/") ? [""] : (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    try {
      accessSync(dir ? join(dir, program) : program, constants.X_OK);
      return true;
    } catch {
      // not here
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
