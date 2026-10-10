import { readFile, writeFile, mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, parse } from "node:path";

export interface Settings {
  /** Folder she works in, in work mode. null until the user picks one. */
  projectDir: string | null;
  chatModel: string;
  workModel: string;
  /** Tools pre-approved in work mode. Reads in the folder are cheap; everything else asks. */
  allowedTools: string[];
}

const defaults = (): Settings => ({
  projectDir: null,
  chatModel: "haiku",
  workModel: "sonnet",
  allowedTools: ["Read", "Grep", "Glob"],
});

/** Saved settings, then environment overrides (COMPANION_MODEL, COMPANION_WORK_MODEL). */
export async function loadSettings(path: string): Promise<Settings> {
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // first run
  }
  const settings = { ...defaults(), ...saved };
  if (process.env.COMPANION_MODEL) settings.chatModel = process.env.COMPANION_MODEL;
  if (process.env.COMPANION_WORK_MODEL) settings.workModel = process.env.COMPANION_WORK_MODEL;
  return settings;
}

export async function saveSettings(path: string, settings: Settings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(settings, null, 2));
}

export type FolderCheck = { ok: true; dir: string } | { ok: false; reason: string };

/**
 * A work folder must exist and be a directory, and must not be the filesystem
 * root or the whole home directory: she can edit files and run commands there,
 * so the user should pick a project, not everything.
 */
export async function checkProjectDir(input: string): Promise<FolderCheck> {
  const wanted = input.trim().replace(/^~(?=$|\/)/, homedir());
  if (!wanted) return { ok: false, reason: "Please enter a folder." };
  let dir: string;
  try {
    dir = await realpath(wanted);
    if (!(await stat(dir)).isDirectory()) return { ok: false, reason: `${wanted} is not a folder.` };
  } catch {
    return { ok: false, reason: `${wanted} does not exist.` };
  }
  if (dir === parse(dir).root || dir === (await realpath(homedir()))) {
    return { ok: false, reason: "Pick a project folder, not your whole home directory or the disk root." };
  }
  return { ok: true, dir };
}
