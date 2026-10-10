import { readFile, writeFile, mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, parse } from "node:path";
import { isEffort, type Effort } from "./claude-settings.ts";

export type ProviderName = "claude" | "ollama";

export interface Settings {
  /** Which backend powers her. */
  provider: ProviderName;
  /** Model used when the provider is Ollama. */
  ollamaModel: string | null;
  /** Folder she works in, in work mode. null until the user picks one. */
  projectDir: string | null;
  chatModel: string;
  workModel: string;
  /** How hard Claude thinks: a level, or "default" to follow the user's own Claude Code settings. */
  effort: Effort | "default";
  /** Tools pre-approved in work mode. Reads in the folder are cheap; everything else asks. */
  allowedTools: string[];
}

const defaults = (): Settings => ({
  provider: "claude",
  ollamaModel: null,
  projectDir: null,
  chatModel: "haiku",
  workModel: "sonnet",
  effort: "default",
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
  if (settings.effort !== "default" && !isEffort(settings.effort)) settings.effort = "default";
  if (process.env.COMPANION_MODEL) settings.chatModel = process.env.COMPANION_MODEL;
  if (process.env.COMPANION_PROVIDER === "ollama" || process.env.COMPANION_PROVIDER === "claude") {
    settings.provider = process.env.COMPANION_PROVIDER;
  }
  if (process.env.OLLAMA_MODEL) settings.ollamaModel = process.env.OLLAMA_MODEL;
  if (process.env.COMPANION_WORK_MODEL) settings.workModel = process.env.COMPANION_WORK_MODEL;
  return settings;
}

/**
 * Writes the settings the UI changes (provider, Ollama model, project folder) and
 * leaves everything else in the file as the user wrote it, so models set through
 * environment variables are not frozen into it.
 */
export async function saveSettings(path: string, settings: Settings): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // first save
  }
  const { provider, ollamaModel, projectDir, effort } = settings;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ ...existing, provider, ollamaModel, projectDir, effort }, null, 2));
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
