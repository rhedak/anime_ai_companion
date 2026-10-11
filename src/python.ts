import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The Python that runs the render worker: `PYTHON` if set, else the project's own environment
 * (`uv sync` creates `.venv`, on a Python new enough for the character creator), else `python3` on the PATH.
 */
export function pythonCommand(): string {
  if (process.env.PYTHON) return process.env.PYTHON;
  const venv = join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return existsSync(venv) ? venv : "python3";
}
