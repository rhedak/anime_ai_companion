import { readFile, writeFile, mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, parse } from "node:path";
import { isEffort, type Effort } from "./claude-settings.ts";
import { isPackName } from "./frame-pack.ts";
import { checkBackendUrl } from "./studio/backend.ts";

export type ProviderName = "claude" | "ollama" | "cursor" | "opencode";

/** What happens to a note she proposes in chat: she asks first, she saves it (with an undo), or notes are off. */
export type MemorySaving = "ask" | "auto" | "off";
export const isMemorySaving = (v: unknown): v is MemorySaving => v === "ask" || v === "auto" || v === "off";

export interface Settings {
  /** Which backend powers her. */
  provider: ProviderName;
  /** Model used when the provider is Ollama. */
  ollamaModel: string | null;
  /** Model id from the Cursor agent's catalog. Null until the first session picks one. */
  cursorModel: string | null;
  /** Model id from opencode's catalog, `provider/model`. Null keeps opencode's own default. */
  opencodeModel: string | null;
  /** Folder she works in, in work mode. null until the user picks one. */
  projectDir: string | null;
  chatModel: string;
  workModel: string;
  /** What the companion is called. */
  name: string;
  /** The user gave her this name (typed, /rename, or a card): then it wins over the name of the character of a picture pack. False: she goes by the character's name while a pack is on. */
  nameSet: boolean;
  /** A folder in data/frames shown instead of the drawn avatar (see src/frame-pack.ts); null is the drawn one. */
  framePack: string | null;
  /** The image backend the pack studio talks to: plain http on this computer, or null. Never a key: those come from the environment. */
  studioBackend: string | null;
  /** What one pack made with a paid image service may cost in all, in dollars. */
  studioBudgetUsd: number;
  /** How hard Claude thinks: a level, or "default" to follow the user's own Claude Code settings. */
  effort: Effort | "default";
  /** How her notes about the user get saved (chat only). Asking is the default. */
  memorySaving: MemorySaving;
  /** Tools pre-approved in work mode. Reads in the folder are cheap; everything else asks. */
  allowedTools: string[];
}

export const DEFAULT_NAME = "Risa";

const defaults = (): Settings => ({
  provider: "claude",
  ollamaModel: null,
  cursorModel: null,
  opencodeModel: null,
  projectDir: null,
  chatModel: "haiku",
  workModel: "sonnet",
  name: "Risa",
  nameSet: false,
  framePack: null,
  studioBackend: null,
  studioBudgetUsd: 5,
  effort: "default",
  memorySaving: "ask",
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
  settings.name = cleanName(String(settings.name)) ?? DEFAULT_NAME;
  // Settings from before this flag: a name that is not the default was the user's own choice.
  settings.nameSet = typeof saved.nameSet === "boolean" ? saved.nameSet : settings.name !== DEFAULT_NAME;
  if (typeof settings.framePack !== "string" || !isPackName(settings.framePack)) settings.framePack = null;
  settings.studioBackend = checkBackendUrl(process.env.COMPANION_IMAGE_BACKEND ?? settings.studioBackend);
  settings.studioBudgetUsd = typeof settings.studioBudgetUsd === "number" && settings.studioBudgetUsd >= 0.5 && settings.studioBudgetUsd <= 200 ? settings.studioBudgetUsd : 5;
  if (settings.effort !== "default" && !isEffort(settings.effort)) settings.effort = "default";
  if (!isMemorySaving(settings.memorySaving)) settings.memorySaving = "ask";
  if (process.env.COMPANION_MODEL) settings.chatModel = process.env.COMPANION_MODEL;
  if (
    process.env.COMPANION_PROVIDER === "ollama" ||
    process.env.COMPANION_PROVIDER === "claude" ||
    process.env.COMPANION_PROVIDER === "cursor" ||
    process.env.COMPANION_PROVIDER === "opencode"
  ) {
    settings.provider = process.env.COMPANION_PROVIDER;
  }
  if (process.env.OLLAMA_MODEL) settings.ollamaModel = process.env.OLLAMA_MODEL;
  if (process.env.COMPANION_OPENCODE_MODEL) settings.opencodeModel = process.env.COMPANION_OPENCODE_MODEL;
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
  const { provider, ollamaModel, cursorModel, opencodeModel, projectDir, effort, name, nameSet, framePack, studioBackend, studioBudgetUsd, memorySaving } = settings;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ ...existing, provider, ollamaModel, cursorModel, opencodeModel, projectDir, effort, name, nameSet, framePack, studioBackend, studioBudgetUsd, memorySaving }, null, 2));
}

/**
 * A companion name: 1 to 24 letters, digits, spaces and a little punctuation, or null. The name goes
 * into her system prompt, so nothing that could carry instructions (brackets, newlines, quotes) is allowed.
 */
export function cleanName(input: string): string | null {
  const name = input.replace(/\s+/g, " ").trim();
  return /^[\p{L}\p{N} .'’_-]{1,24}$/u.test(name) && /[\p{L}\p{N}]/u.test(name) ? name : null;
}

export type FolderCheck = { ok: true; dir: string } | { ok: false; reason: string };

/**
 * A work folder must exist and be a directory, and must not be the filesystem
 * root or the whole home directory: she can edit files and run commands there,
 * so the user should pick a project, not everything.
 */
export async function checkProjectDir(input: string): Promise<FolderCheck> {
  const wanted = input.trim().replace(/^~(?=$|[\\/])/, homedir());
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
