import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { welcomeText } from "./welcome.ts";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { AvatarService, GESTURE_NAMES } from "./avatar.ts";
import { shareNudge } from "./share-nudge.ts";
import { Transcript, claudeSessionExists } from "./transcript.ts";
import { resolveCreatorSrc } from "./creator.ts";
import { brainProgram, isInstalled, programLabel } from "./programs.ts";
import { MAX_IMAGE_BYTES, MAX_MESSAGE_BYTES, parseImages, sniffImageType, type ImageInput } from "./images.ts";
import { listSessions, loadSessionItems, sessionContext, sessionPath, type SessionInfo } from "./sessions.ts";
import { coldCache, type ConversationState } from "./cache-guard.ts";
import { ClaudeCodeProvider } from "./providers/claude-code.ts";
import { CursorProvider } from "./providers/cursor.ts";
import { OpenCodeProvider } from "./providers/opencode.ts";
import { ScriptedProvider } from "./providers/scripted.ts";
import { CURSOR_EVERYTHING_NOTICE, CURSOR_UNRESTRICTED_TEXT, cursorApprovalMode } from "./providers/cursor-acp.ts";
import { choosePersona } from "./persona.ts";
import { basicGreeting } from "../public/script.js";
import { listOllamaModels, OllamaProvider } from "./providers/ollama.ts";
import { prettyModel, type Limit } from "./providers/claude-stream.ts";
import { pickFolder } from "./folder-picker.ts";
import { InstallError, OPENCODE_PIN, cleanInstallLeftovers, installOpencode, managedOpencode, opencodeAsset, opencodeFolder, opencodeUrl } from "./install-opencode.ts";
import { checkAll, formatDoctor, realProbe } from "./doctor.ts";
import { runClaudeLogin } from "./claude-login.ts";
import { randomUUID } from "node:crypto";
import { animatedActivities, drawnActivityNote, gestureNote, packActivities, readCharacters, groupPacks, isPackName, outfitName, packCharacters, packNote, listPacks, packInfo, readPack, type FramePack, type Outfit } from "./frame-pack.ts";
import { createPackInstaller, packIndexUrl, type PackUpdate } from "./pack-install.ts";
import { packUpdateChecksOn } from "./update-setting.ts";
import type { PackIndexEntry } from "./pack-index.ts";
import { isLoopbackAddress, loadToken, newToken, phoneLinks, qrRows, saveToken, socketAllowed } from "./lan.ts";
import { demoMessage } from "./demo.ts";
import { gestureView } from "../public/frames.js";
import { formatClientError, perMinute } from "./client-errors.ts";
import { runShell, shellDisabled } from "./shell.ts";
import { createCardService } from "./card-service.ts";
import { createRequestHandler } from "./http-routes.ts";
import { createTurnService } from "./turn-service.ts";
import { SCENES, sceneById, sceneList, startPlay } from "./scenes.ts";
import { createMemoryService } from "./memory-service.ts";
import { createPersonaService } from "./persona-service.ts";
import { createStudioService } from "./studio-service.ts";
import { createNotes } from "./notes.ts";
import { createQueueService } from "./queue-service.ts";
import { createSkillsService } from "./skills-service.ts";
import type { Say } from "./server-types.ts";
import { loadUserEffort, resolveEffort, efforts, isEffort, type Effort } from "./claude-settings.ts";
import { checkProjectDir, cleanName, DEFAULT_NAME, loadSettings, saveSettings, type ProviderName } from "./settings.ts";
import { permissionModes, type Decision, type Mode, type PermissionMode, type PermissionRequest, type Provider, type SessionConfig } from "./providers/types.ts";
import { dataDir, workspaceDir } from "./paths.ts";
import { handOff } from "./restart.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(root, "public");
const workspace = workspaceDir;
const customCssPath = join(dataDir, "custom.css");
const port = Number(process.env.PORT ?? 3737);
// Local only unless `--lan` is passed: this server can run Claude Code, so reaching it from the network is an
// opt-in made again at every start, and every request from the network needs the token (src/lan.ts).
// `/phone` can also turn it on later, once, after a question answered on this computer (`setLan`); that is in memory only and is off again at every start.
const host = "127.0.0.1";
let lan = process.argv.includes("--lan");
let bindHost = lan ? "0.0.0.0" : host;
const lanTokenPath = join(dataDir, "lan-token");
/** Exists once the tour (`welcomeText`) was shown on this computer: it comes once, then only by `/welcome`. */
const welcomedPath = join(dataDir, "welcomed");
let lanToken = lan ? await loadToken(lanTokenPath) : "";
/** `/phone` asked whether to turn phone access on, and the answer is still due. Only that question can be answered with yes. */
let lanAsked = false;

await mkdir(workspace, { recursive: true });
const personaBase = await readFile(join(root, "persona.md"), "utf8");
const emotions = JSON.parse(await readFile(join(root, "emotions.json"), "utf8"));

const creatorSrc = await resolveCreatorSrc();
const avatar = new AvatarService({
  creatorSrc,
  statePath: join(dataDir, "avatar.json"),
  looksDir: join(dataDir, "looks"),
  emotions,
  defaultPreset: process.env.COMPANION_PRESET ?? "risa",
});
await avatar.start();
/** Said once to the first page that connects: an untouched preset look was redrawn because the creator's preset changed. */
let lookRefreshedNotice: string | null = avatar.refreshed ? `The creator was updated, so ${herName0(avatar.refreshed)}'s drawn look was refreshed to its new version.` : null;
function herName0(preset: string): string {
  return preset.charAt(0).toUpperCase() + preset.slice(1);
}

const personaWork = await readFile(join(root, "persona-work.md"), "utf8");

const settingsPath = join(dataDir, "settings.json");
const firstStart = !existsSync(settingsPath);
const welcome = (): string => welcomeText({ brain: basicMode ? null : provider.name, docs: "https://rhedak.github.io/anime_ai_companion/" });
const settings = await loadSettings(settingsPath);

// A set of pictures shown instead of the drawn avatar (data/frames/<name>, see src/frame-pack.ts).
const framesDir = join(dataDir, "frames");
/** Where packs are looked for: the user's own first, then the ones that come with the app. */
const packDirs = [framesDir, join(root, "packs")];
let activePack: FramePack | null = null;
/**
 * Her name, in two tiers: the one the user gave her (typed, /rename, or a character card), else the name of the character of the picture pack that is on, else the
 * default. A pack of a character she is not called after never renames her over a name the user chose.
 */
const herName = (): string => (settings.nameSet || !activePack?.character ? settings.name : activePack.character.name);
/** The pack's resting picture, kept ready to show her how she looks (brains that can read pictures), and whether the next message should carry it. */
let lookPicture: ImageInput | null = null;
let lookPictureDue = false;
async function loadLookPicture(): Promise<void> {
  lookPicture = null;
  const file = activePack ? activePack.files.get(activePack.emotions.neutral?.idle ?? "") : undefined;
  if (!file) return;
  const bytes = await readFile(file.path).catch(() => null);
  const mediaType = bytes && bytes.length <= MAX_IMAGE_BYTES ? sniffImageType(bytes) : null;
  if (bytes && mediaType) lookPicture = { mediaType, data: bytes.toString("base64") };
}
/** Reads the chosen pack's folder again, so pictures replaced on disk show on the next page load. */
async function refreshPack(): Promise<string[]> {
  if (!settings.framePack) {
    activePack = null;
    return [];
  }
  const result = await readPack(packDirs, settings.framePack, Object.keys(emotions));
  activePack = result.ok ? result.pack : null;
  await loadLookPicture();
  return result.ok ? result.pack.notes : [result.reason];
}
/** What the page needs to ask before a pack is downloaded: its size, and which server is contacted. */
const packOffer = (entry: PackIndexEntry) => ({
  type: "pack-offer",
  id: entry.id,
  name: entry.name,
  bytes: entry.sizes.archiveBytes,
  host: new URL(entry.url).hostname,
  credit: entry.credit,
});
/** What the page asks before a pack on this computer is replaced by newer files: the versions, the size and which server is contacted. */
const packUpdateOffer = (update: PackUpdate) => ({
  type: "pack-update-offer",
  id: update.id,
  name: update.entry.name,
  from: update.installed,
  to: update.available,
  bytes: update.entry.sizes.archiveBytes,
  host: new URL(update.entry.url).hostname,
  credit: update.entry.credit,
});
/**
 * Asks about a newer version of an installed pack, if the pack list (as loaded; the page's own actions load it) has one. With the user's yes to daily update
 * checks the list is refreshed first, so picking a pack notices an update even when the gallery was never opened. Returns the sentence to add to what is said, or "".
 */
async function offerUpdate(id: string): Promise<string> {
  if (await packUpdateChecksOn()) await refreshPackIndex(false);
  const update = await packInstaller.updateFor(id);
  if (!update) return "";
  broadcast(packUpdateOffer(update));
  notes.push(`A newer version of ${update.entry.name} is available (${update.installed} to ${update.available}); the user is asked on the page whether to update. The pictures on this computer stay in use until they agree.`);
  return ` A newer version is available (${update.installed} to ${update.available}); the page asks whether to update.`;
}
/** The outfits of the character the active pack belongs to (installed ones, and ones the pack list offers), for her note and for `[outfit …]`. */
async function outfitsOfActiveCharacter(): Promise<Outfit[]> {
  const id = activePack?.character?.id;
  if (!id) return [];
  const names = await listPacks(...packDirs);
  const chars = await packCharacters(packDirs, names);
  const here: Outfit[] = [];
  for (const pack of names.filter((name) => chars[name]?.id === id)) here.push({ pack, name: outfitName(pack, id), here: true, update: Boolean(await packInstaller.updateFor(pack)) });
  const offered = remotePacks(names)
    .filter((pack) => pack.character?.id === id)
    .map((pack) => ({ pack: pack.id, name: outfitName(pack.id, id), here: false }));
  return [...here, ...offered];
}
let outfitCache: Outfit[] = [];
/**
 * Per character id, the activities that have an animation and the outfit (short name) each is in: what the character's file says (`activity: swimming = bikini`, for an outfit that
 * is not on this computer yet) and what the outfits on this computer have pictures for (a pack a user made counts, with no file written). Read again whenever the outfits are.
 */
let activityIndex: Record<string, Record<string, string>> = {};
async function refreshActivityIndex(): Promise<void> {
  const index: Record<string, Record<string, string>> = {};
  for (const [id, who] of Object.entries(await readCharacters(packDirs))) if (who.activities) index[id] = { ...who.activities };
  const names = await listPacks(...packDirs);
  const characters = await packCharacters(packDirs, names);
  for (const name of names) {
    const who = characters[name];
    if (who) for (const activity of await packActivities(packDirs, name)) (index[who.id] ??= {})[activity] = outfitName(name, who.id);
  }
  activityIndex = index;
  const defaults: Record<string, string> = {};
  for (const [id, who] of Object.entries(await readCharacters(packDirs))) if (who.defaultPack && names.includes(who.defaultPack)) defaults[id] = who.defaultPack;
  defaultPacks = defaults;
}
/** Per character id, the outfit pack that stands for her (the `default:` line of her file) when it is on this computer: what the studio starts from while she is drawn. */
let defaultPacks: Record<string, string> = {};
const refreshOutfits = async () => {
  if (activePack?.character) await refreshPackIndex(false); // the outfits that can be downloaded come from the pack list
  outfitCache = await outfitsOfActiveCharacter();
  await refreshActivityIndex();
};
const drawnActivities = () => activityIndex[avatar.basePreset?.toLowerCase() ?? ""];
const formatMegabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const packMessage = () => ({ type: "pack", pack: activePack ? packInfo(activePack) : null });
/** Downloads a pack from the index into data/frames. The default address is a placeholder until the packs site exists. */
const packInstaller = createPackInstaller({
  destDir: framesDir,
  indexUrl: packIndexUrl(),
  thumbsDir: join(root, "packs", "thumbs"),
});
let packIndexLogged = false;
/** Loads the remote list. A failure is remembered by the installer and said once here; packs on disk are unaffected. */
async function refreshPackIndex(force = false): Promise<void> {
  const loaded = await packInstaller.loadIndex(force);
  if (!loaded.ok && !packIndexLogged) {
    packIndexLogged = true;
    console.error(`Pack index: ${loaded.reason}`);
  }
}
/** Remote packs that are not already on disk, so the gallery can offer them for download. */
function remotePacks(names: string[]): (Pick<PackIndexEntry, "id" | "name" | "description" | "credit" | "aiMade" | "character" | "sizes"> & { host: string })[] {
  const have = new Set(names);
  return (packInstaller.index()?.packs ?? [])
    .filter((pack) => !have.has(pack.id))
    .map((pack) => ({ id: pack.id, name: pack.name, description: pack.description, credit: pack.credit, aiMade: pack.aiMade, character: pack.character, sizes: pack.sizes, host: new URL(pack.url).hostname }));
}
/** The packs the Looks menu offers, and which one is on. `remote` is what can be downloaded. */
const packsMessage = async () => {
  await refreshOutfits();
  const names = await listPacks(...packDirs);
  const updates = (await packInstaller.updates()).map((u) => ({ id: u.id, name: u.entry.name, from: u.installed, to: u.available, bytes: u.entry.sizes.archiveBytes, host: new URL(u.entry.url).hostname }));
  return { type: "packs", names, characters: await packCharacters(packDirs, names), active: settings.framePack, remote: remotePacks(names), updates };
};
await refreshPack();
// Start in work mode when there is a folder to work in, unless --chat says otherwise.
// `anaico` passes the folder it was started from as --project-dir; that folder is only
// pre-filled here, not saved, until the user picks one in the UI.
let mode: Mode = "chat";
/** The short scene `/play` started, if one is on. Memory only: a restart, /clear, work mode or the scene ending clears it. */
let sceneId: string | null = null;
/** That scene's note, with the locked room's counts filled in. Cleared with `sceneId`. */
let sceneNoteText: string | null = null;

function stopScene(): void {
  sceneId = null;
  sceneNoteText = null;
}
{
  const flag = process.argv.indexOf("--project-dir");
  const wanted = flag >= 0 ? process.argv[flag + 1] : settings.projectDir;
  if (wanted) {
    const check = await checkProjectDir(wanted);
    if (check.ok) {
      settings.projectDir = check.dir;
      if ((settings.provider === "claude" || settings.provider === "cursor" || settings.provider === "opencode") && !process.argv.includes("--chat")) mode = "work";
    } else {
      if (settings.projectDir === wanted) settings.projectDir = null;
      console.log(`Starting in chat mode: ${check.reason}`);
    }
  }
}

// Not saved: every start is Ask, except when Cursor's own CLI never asks, in which case Run everything so the menu matches it.
let permissionMode: PermissionMode = "manual";
/** Why Run everything is on, when Cursor's CLI chose it. Told to each new page until the mode is changed. */
let cursorEverythingNotice: string | null = null;
/** Like the permission mode, never saved: hooks run commands, so each start begins isolated. */
let claudeSetup = false;
/** Like the permission mode, never saved: it drives the user's real Chrome, so each start begins without it. */
let claudeChrome = false;

const ollamaHost = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";

/**
 * Basic mode: the chosen brain's program is not installed (or, on a first start, no brain is). She then runs the built-in script and says so
 * (src/providers/scripted.ts) instead of failing at the first message. On a first start another brain that is installed is used instead (in
 * memory; nothing is saved until the user changes something). A brain the user chose that has gone missing is not swapped for another one.
 */
const brainThere = (name: ProviderName): boolean => {
  const program = brainProgram(name);
  return program === null || isInstalled(program);
};
let basicMode = false;
if (settings.provider !== "ollama" && !brainThere(settings.provider)) {
  const other = firstStart ? (["claude", "opencode", "cursor"] as const).find(brainThere) : undefined;
  if (other) settings.provider = other;
  else if (firstStart && ((await listOllamaModels(ollamaHost)) ?? []).length > 0) settings.provider = "ollama";
  else basicMode = true;
}
if (basicMode) mode = "chat"; // no tools to work with
// Cursor's own "unrestricted" never sends an approval request, so Ask would be a lie. Start in Run everything instead.
if (!basicMode && settings.provider === "cursor" && cursorApprovalMode() === "unrestricted") {
  permissionMode = "everything";
  cursorEverythingNotice = CURSOR_EVERYTHING_NOTICE;
}
/** Installed Ollama models, refreshed when a browser connects; null when Ollama is not reachable. */
let ollamaModels: string[] | null = null;

const userEffort = await loadUserEffort();
/** The effort in force: the user's pick, or what their own Claude Code settings give this model. */
function effectiveEffort(modelAlias = mode === "work" ? settings.workModel : settings.chatModel): Effort | null {
  if (settings.provider !== "claude") return null;
  return settings.effort === "default" ? resolveEffort(userEffort, modelAlias) : settings.effort;
}

const sessionConfig = (): SessionConfig => ({
  mode,
  cwd: settings.projectDir ?? workspace,
  model:
    settings.provider === "ollama"
      ? (settings.ollamaModel ?? "")
      : settings.provider === "cursor"
        ? (settings.cursorModel ?? "")
        : settings.provider === "opencode"
          ? (settings.opencodeModel ?? "")
          : mode === "work" ? settings.workModel : settings.chatModel,
  allowedTools: settings.allowedTools,
  permissionMode,
  claudeSetup,
  claudeSkills: skills.enabled(),
  claudeChrome,
  effort: effectiveEffort(),
});

/** The user's own persona file (data/persona.md), read when a conversation starts; null when there is none. */
function readUserPersona(): string | null {
  try {
    return readFileSync(join(dataDir, "persona.md"), "utf8");
  } catch {
    return null;
  }
}
/** Whose voice she speaks in (custom, then the character of the pack that is on, then the default): see src/persona.ts. */
const personaChoice = () => {
  const who = activePack?.character;
  return choosePersona({
    base: personaBase,
    card: cards.personaOverride(),
    userFile: readUserPersona(),
    character: who?.voice ? { name: who.name, text: who.text, voice: who.voice } : null,
  });
};
const persona = (config: SessionConfig) =>
  personaChoice().text.replaceAll("{{name}}", herName()) +
  (config.mode === "work" ? `\n${personaWork}\nProject folder: ${config.cwd}\n` : "") +
  "\n" +
  avatar.promptSection();

// What the chat log shows, and which Claude Code session it belongs to, survive a restart.
const transcript = new Transcript(join(dataDir, "transcript.json"));
const savedLog = await transcript.load();
const claudeResumable =
  savedLog?.provider === "claude" && savedLog.sessionId && (await claudeSessionExists(savedLog.sessionId))
    ? savedLog.sessionId
    : undefined;
if (!claudeResumable && savedLog?.provider === "claude") transcript.clear(); // its session is gone: start clean
if (savedLog?.provider === "basic" && !basicMode) transcript.clear(); // a conversation with the built-in script has nothing to give a real brain
/** How big her memory is and when she last answered: a cold prompt cache makes the next message expensive. */
const convo: ConversationState = {
  contextTokens: claudeResumable ? savedLog?.contextTokens ?? null : null,
  lastReplyAt: claudeResumable ? savedLog?.lastReplyAt ?? null : null,
};
const cursorResumable = savedLog?.provider === "cursor" ? savedLog.sessionId ?? undefined : undefined;
const opencodeResumable = savedLog?.provider === "opencode" ? savedLog.sessionId ?? undefined : undefined;

// --- letting her use the user's own skills: see skills-service.ts ---
const skills = createSkillsService({
  brain: () => settings.provider,
  canUseTools: () => provider.canUseTools,
  busy: () => provider.busy,
  mode: () => mode,
  setup: () => claudeSetup,
  folder: () => settings.projectDir ?? workspace,
  cannotChange: () => cannotChange(),
  reconfigure: () => provider.configure(sessionConfig()),
  pushNote: (text) => notes.push(text),
  broadcast: (msg) => broadcast(msg),
  modeInfo: () => modeInfo(),
  name: () => herName(),
  remoteRefusal: () => remoteRefusal,
});

const ollamaBrain = new OllamaProvider({
  host: ollamaHost,
  model: settings.ollamaModel ?? "",
  persona: () => persona(sessionConfig()),
  // Models the user vouches for when their Ollama cannot report capabilities: COMPANION_OLLAMA_TOOLS=name,name or all.
  forceTools: (process.env.COMPANION_OLLAMA_TOOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
});

const providers: Record<ProviderName, Provider> = {
  claude: new ClaudeCodeProvider({
    config: sessionConfig(),
    chatCwd: workspace,
    persona,
    resumeSessionId: claudeResumable,
  }),
  ollama: ollamaBrain,
  cursor: new CursorProvider({
    config: sessionConfig(),
    chatCwd: workspace,
    persona,
    resumeSessionId: cursorResumable,
  }),
  opencode: new OpenCodeProvider({
    config: sessionConfig(),
    chatCwd: workspace,
    persona,
    resumeSessionId: opencodeResumable,
  }),
};
const scripted = new ScriptedProvider({ presets: () => avatar.presetNames, pack: () => activePack !== null, character: () => activePack?.characterId ?? "" });
let provider: Provider = basicMode ? scripted : providers[settings.provider];

/** Shown when work mode starts with a local model: how well it uses tools is up to the model, and so is the responsibility. */
const OLLAMA_WORK_WARNING =
  "Work mode with a local model is experimental. How well it uses tools depends entirely on the model: small or older ones call them badly and can " +
  "propose a wrong or harmful command or edit with full confidence. Every command, file write and edit still waits for your approval, so read what the card " +
  "shows. The app does not test or vouch for any local model; you are responsible for the result, so keep the project under git.";

/** What the footer shows. Limits belong to the account, so they outlive a /clear; the context belongs to the conversation. */
const account: { model: string | null; session: Limit | null; week: Limit | null; limitsAt: number | null } = {
  model: null,
  session: null,
  week: null,
  limitsAt: null,
};

const meterInfo = () => {
  const usage = provider.usage;
  const ctx = usage?.contextTokens != null && usage.contextWindow ? Math.min(1, usage.contextTokens / usage.contextWindow) : null;
  const claude = settings.provider === "claude";
  return {
    type: "meter",
    model: claude ? (account.model ? prettyModel(account.model) : null) : provider.name,
    effort: claude ? effectiveEffort() : null,
    session: claude ? account.session : null,
    week: claude ? account.week : null,
    limitsAt: account.limitsAt,
    ctx,
  };
};

/** Cursor and opencode both speak ACP, so share the session, model and resume plumbing. */
type AcpBrain = CursorProvider | OpenCodeProvider;
const acpBrain = (): AcpBrain | null => (provider instanceof CursorProvider || provider instanceof OpenCodeProvider ? provider : null);
const cursorBrain = () => (provider instanceof CursorProvider ? provider : null);
const opencodeBrain = () => (provider instanceof OpenCodeProvider ? provider : null);

/** What the work bar and /model show. ACP catalog ids are long; show the short name. */
const shownModel = () => acpBrain()?.modelLabel || sessionConfig().model;

const modeInfo = () => ({
  type: "mode",
  name: herName(),
  // True when the name is the user's: the reset beside it is shown, and a pack's character does not take over.
  nameSet: settings.nameSet,
  mode,
  // "basic": no brain is installed and she runs the built-in script (the page says so in her first message); the menu shows it, and it is not a choice.
  provider: basicMode ? "basic" : settings.provider,
  basic: basicMode,
  canUseTools: settings.provider === "ollama" ? ollamaBrain.canUseToolsFor(settings.ollamaModel) : provider.canUseTools,
  // Only a local model that Ollama says cannot see pictures: everything else may attach (the page hides nothing otherwise).
  cannotSeePictures: settings.provider === "ollama" && ollamaBrain.cannotSeePicturesFor(settings.ollamaModel),
  ollamaModels,
  ollamaModel: settings.ollamaModel,
  cursorModels: cursorBrain()?.availableModels ?? [],
  cursorModel: cursorBrain()?.modelId || settings.cursorModel,
  opencodeModels: opencodeBrain()?.availableModels ?? [],
  opencodeModel: opencodeBrain()?.modelId || settings.opencodeModel,
  projectDir: settings.projectDir,
  model: shownModel(),
  sessionId: provider.sessionId,
  allowedTools: settings.allowedTools,
  permissionMode,
  claudeSetup,
  claudeSkills: skills.enabled(),
  claudeChrome,
  effort: settings.effort,
  effortNow: effectiveEffort(),
  shellOff: shellDisabled(),
});

const looksInfo = () => ({ type: "looks", names: avatar.lookNames, presets: avatar.presetNames, canUndo: avatar.canUndo, current: avatar.basePreset });

async function refreshOllamaModels(announce = true): Promise<void> {
  const before = JSON.stringify([ollamaModels, settings.ollamaModel]);
  ollamaModels = await listOllamaModels(ollamaHost);
  // With Ollama as the brain and no model named (COMPANION_PROVIDER=ollama, OLLAMA_MODEL unset), use the first one installed, as documented.
  // Only in memory: the pick of the user (menu, OLLAMA_MODEL) is what is saved, never this default.
  if (settings.provider === "ollama" && !settings.ollamaModel && ollamaModels?.length) settings.ollamaModel = ollamaModels[0];
  if (announce && JSON.stringify([ollamaModels, settings.ollamaModel]) !== before) broadcast(modeInfo());
}
if (settings.provider === "ollama") {
  await refreshOllamaModels(false); // nobody is connected yet
  ollamaBrain.configure(sessionConfig()); // takes the model chosen above, so the banner names it and the first message uses it
  void ollamaBrain.checkTools();
}

/** Why a message cannot be sent to Ollama yet, said to the user (a turn that fails before the model is asked is not kept in the log). */
function ollamaNotReady(): string {
  if (ollamaModels === null) return `Could not reach Ollama at ${ollamaHost}. Start it with: ollama serve`;
  if (ollamaModels.length === 0) return "Ollama has no models yet. Pull one, for example: ollama pull llama3.2";
  return "No Ollama model is chosen yet. Pick one in the Brain menu, or start with OLLAMA_MODEL=<name>.";
}

/** Approvals waiting for an answer, so a reloaded tab can show them again. */
const pendingPermissions = new Map<string, PermissionRequest>();

const server = createServer(
  createRequestHandler({
    host,
    port,
    publicDir,
    customCssPath,
    lan: () => lan,
    lanToken: () => lanToken,
    transcript,
    packDirs,
    emotionNames: () => Object.keys(emotions),
    activePack: () => activePack,
    packThumb: async (name) => {
      const body = await packInstaller.thumbnail(name);
      return body ? { body, mime: "image/webp" } : null;
    },
  }),
);

const allowedOrigins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

// Browsers connect on /ws, and only from our own origin. From the network (--lan) that also takes the token cookie.
const remoteSockets = new WeakSet<WebSocket>();
server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const local = isLoopbackAddress(req.socket.remoteAddress);
  const ok = local ? allowedOrigins.has(String(req.headers.origin)) : lan && socketAllowed(req, lanToken);
  if (path === "/ws" && ok) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!local) remoteSockets.add(ws);
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

const clients = new Set<WebSocket>();
const broadcast = (msg: unknown) => {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
  // Whatever changed the mode, brain or conversation may have changed the footer too.
  if ((msg as { type?: string }).type === "mode") {
    const meter = JSON.stringify(meterInfo());
    for (const c of clients) if (c.readyState === c.OPEN) c.send(meter);
  }
};

// A local model can only do work mode if Ollama says it takes tool calls: ask now, and again whenever the model changes.
// After `broadcast`, which the answer calls: asked earlier, a fast Ollama could reply before it existed (it crashed the start).
ollamaBrain.onToolSupport(() => broadcast(modeInfo()));
if (settings.provider === "ollama") void ollamaBrain.checkTools();

await mkdir(dataDir, { recursive: true });

/** Save the visible log and the session it belongs to (debounced a little: turns end often). */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistTranscript(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    transcript
      .save({ provider: basicMode ? "basic" : settings.provider, sessionId: provider.sessionId, ...convo })
      .catch((err) => console.error("could not save the transcript:", err));
  }, 300);
}

// Problems with the model's avatar tags, passed back to it with the next user message.
const notes = createNotes();
/** A new conversation starts with nothing waiting, except what she must know about her pictures while a pack is on (they replace the look her prompt describes). */
function renewNotes(): void {
  notes.clear();
  lookPictureDue = false;
  if (!activePack) notes.pushLazy(() => drawnActivityNote(drawnActivities()));
  if (activePack) {
    // Worked out when the message goes out: at a server start the pack list has not been read yet, and she must be told her outfits all the same.
    const pack = activePack;
    notes.pushLazy(() => packNote(pack, outfitCache, herName(), activityIndex[pack.character?.id ?? ""]));
    lookPictureDue = true;
  }
}
// A pack was chosen in an earlier run: read her outfits (the pack list included, for at most a moment) so her first message already tells her about them.
await Promise.race([refreshOutfits().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1500))]);
renewNotes();
if (avatar.refreshed) notes.push(`The creator was updated and your drawn look was redrawn from its new '${avatar.refreshed}' preset: you look a little different now.`);

/** How many problems the page may report to the log per minute. */
const pageErrorLimit = perMinute();

/** Why a settings change cannot happen right now, or null. */
function cannotChange(): string | null {
  if (provider.busy) return "Wait for her to finish the current reply first.";
  return null;
}

async function switchMode(wanted: Mode, dir: unknown, say: Say): Promise<void> {
  const blocked = cannotChange();
  if (blocked) return say(blocked);
  if (wanted === "work") {
    if (settings.provider === "ollama") await ollamaBrain.checkTools(); // ask again: the model may have changed, or Ollama just started
    if (!provider.canUseTools) {
      return say(
        settings.provider === "ollama"
          ? `Ollama does not report that ${settings.ollamaModel || "this model"} can use tools, so work mode is off for it. Pick a tool-capable model (a recent Qwen or Llama, for example), or, if you know this one works, start the server with COMPANION_OLLAMA_TOOLS=${settings.ollamaModel || "<model>"}.`
          : basicMode
            ? "Work mode needs a brain, and none is installed yet. opencode is the easiest (free, no account): press the Install opencode card, or run npm install -g opencode-ai and restart this app."
            : "This model cannot use tools. Switch to Claude Code, Cursor, opencode or a tool-capable Ollama model for work mode.",
      );
    }
    const folder = typeof dir === "string" && dir.trim() ? dir : settings.projectDir;
    if (!folder) return say("Choose a project folder first.");
    const check = await checkProjectDir(folder);
    if (!check.ok) return say(check.reason);
    settings.projectDir = check.dir;
    await saveSettings(settingsPath, settings);
  }
  const before = { mode, cwd: sessionConfig().cwd };
  if (wanted === "work" && before.mode !== "work" && sceneId) {
    const title = sceneById(sceneId)?.title ?? "the scene";
    stopScene();
    notes.push(`The scene "${title}" stopped because this is work mode. Talk normally again.`);
  }
  mode = wanted;
  provider.configure(sessionConfig());
  // Claude Code sends the system prompt it recorded when the conversation began, which keeps the prompt cache
  // intact across restarts but means the work-mode rules in the new persona never reach her. Tell her instead.
  const now = sessionConfig();
  if (settings.provider === "claude" && transcript.items.length > 0 && (before.mode !== mode || (mode === "work" && before.cwd !== now.cwd))) {
    notes.push(
      mode === "work"
        ? `the user switched you to work mode. ${personaWork.replace(/\s+/g, " ").trim()} Project folder: ${now.cwd}.`
        : "the user switched you back to chat mode: you have no tools now, and the work-mode rules no longer apply.",
    );
  }
  broadcast(modeInfo());
  if (wanted === "work") void skills.maybeNotice(say);
  if (wanted === "work" && before.mode !== "work" && settings.provider === "ollama") say(OLLAMA_WORK_WARNING); // once on entering, not again when the folder is set
}

/** Works in the middle of a reply too (Claude Code takes the change live), so an approval card can switch it. */
async function changeEffort(value: Effort | "default", say: Say): Promise<void> {
  if (settings.provider !== "claude") return say("Effort only applies to Claude.");
  const blocked = cannotChange();
  if (blocked) return say(blocked);
  settings.effort = value;
  await saveSettings(settingsPath, settings);
  provider.configure(sessionConfig()); // restarts claude with --effort; the conversation carries on
  broadcast(modeInfo());
}

function changeClaudeSetup(on: boolean, say: Say): void {
  const blocked = cannotChange();
  if (blocked) say(blocked);
  else if (!provider.canUseTools) say("This model cannot use tools, so there is no Claude Code setup to load.");
  else {
    claudeSetup = on;
    provider.configure(sessionConfig()); // restarts claude; the conversation carries on
    if (on && mode === "work") {
      say("Using your Claude Code setup in work mode: your user and project settings, hooks, rules and MCP servers now apply.");
    }
  }
  broadcast(modeInfo());
}

function changeClaudeChrome(on: boolean, say: Say): void {
  const blocked = cannotChange();
  if (blocked) say(blocked);
  else if (settings.provider !== "claude") say("Chrome is a Claude Code feature.");
  else if (!provider.canUseTools) say("This model cannot use tools, so there is no browser to connect.");
  else {
    claudeChrome = on;
    provider.configure(sessionConfig()); // restarts claude; the conversation carries on
    // She only hears about it with the next message: the running conversation keeps its first prompt.
    notes.push(
      on
        ? "the user turned Chrome on for this session: Claude in Chrome is connected, so you can use the browser tools in their real Chrome. Each action still needs their approval, and a site they have not allowed will ask them."
        : "the user turned Chrome off: the browser tools are gone.",
    );
    say(
      on
        ? "Chrome is on in work mode: she can use your browser through the Claude in Chrome extension. It needs that extension, signed into the same Claude account. Browser actions use the same approvals as her other tools, and this turns off the next time the server starts."
        : "Chrome is off again.",
    );
  }
  broadcast(modeInfo());
}

// --- her notes about the user (data/memory.md): see memory-service.ts ---
const memory = createMemoryService({
  file: join(dataDir, "memory.md"),
  mode: () => mode,
  broadcast: (msg) => broadcast(msg),
  openFile: (path) => openBrowser(path),
  remoteRefusal: () => remoteRefusal,
  settings,
  saveSettings: () => saveSettings(settingsPath, settings),
  pushNote: (text) => notes.push(text),
});

// --- her own persona (data/persona.md) and the [persona …] proposal: see persona-service.ts ---
const personaVoice = createPersonaService({
  file: join(dataDir, "persona.md"),
  mode: () => mode,
  broadcast: (msg) => broadcast(msg),
  openFile: (path) => openBrowser(path),
  remoteRefusal: () => remoteRefusal,
  pushNote: (text) => notes.push(text),
  current: () => ({ choice: personaChoice(), characterName: activePack?.character?.name ?? "" }),
  name: () => herName(),
});

// --- the pack studio: pictures of her in a new outfit, made on this computer; see studio-service.ts and docs/pack-studio.md ---
const studio = createStudioService({
  mode: () => mode,
  activeSource: () => settings.framePack,
  drawnSource: () => defaultPacks[avatar.basePreset?.toLowerCase() ?? ""] ?? null,
  dataDir,
  framesDir,
  settings,
  saveSettings: () => saveSettings(settingsPath, settings),
  // The studio is refused from a phone, so what it draws, proposes and reports goes to sockets on this computer only.
  broadcast: (msg) => {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === c.OPEN && !remoteSockets.has(c)) c.send(data);
  },
  remoteRefusal: () => remoteRefusal,
  sources: () => listPacks(...packDirs),
  readSource: async (name) => {
    const found = await readPack(packDirs, name, Object.keys(emotions));
    if (!found.ok) return null;
    const { pack } = found;
    const read = async (file: string | undefined) => {
      const entry = file ? pack.files.get(file) : undefined;
      return entry ? readFile(entry.path) : undefined;
    };
    const neutral = pack.emotions.neutral;
    const rest = await read(neutral?.idle);
    if (!rest) return null;
    return { neutral: rest, blink: await read(neutral.blink), talk: await Promise.all([0, 1, 2].map((k) => read(neutral.talk[k]))), character: pack.characterId ?? null };
  },
  refreshPacks: async () => broadcast(await packsMessage()),
  pushNote: (text) => notes.push(text),
});

// --- character cards: see card-service.ts ---
const cards = createCardService({
  file: join(dataDir, "character.json"),
  personaBase,
  // A card that names her gives her a name of her own (the user's choice, so it wins over a pack character's name).
  settings: {
    get name() {
      return herName();
    },
    set name(value: string) {
      settings.name = value;
      settings.nameSet = true;
    },
  },
  saveSettings: () => saveSettings(settingsPath, settings),
  pushNote: (text) => notes.push(text),
  busy: () => provider.busy,
  transcript,
  persist: () => persistTranscript(),
  broadcast: (msg) => broadcast(msg),
  modeInfo: () => modeInfo(),
  remoteRefusal: () => remoteRefusal,
});
await cards.load();

async function rename(input: string, say: Say): Promise<void> {
  if (/^\s*(reset|default)\s*$/i.test(input)) {
    if (!settings.nameSet) return say(`She already goes by ${herName()}.`);
    settings.nameSet = false;
    settings.name = DEFAULT_NAME;
    await saveSettings(settingsPath, settings);
    notes.push(`the user took away the name they gave you: your name is ${herName()} again.`);
    broadcast(modeInfo());
    return say(`She goes by ${herName()} again${activePack?.character ? " (the name of the character of the pack that is on)" : ""}.`);
  }
  const name = cleanName(input);
  if (!name) return say("A name can have 1 to 24 letters, numbers, spaces and . ' - _");
  if (settings.nameSet && name === settings.name) return say(`She is already called ${name}.`);
  settings.name = name;
  settings.nameSet = true;
  await saveSettings(settingsPath, settings);
  // Her running session keeps the old prompt until it restarts, so tell her directly.
  notes.push(`the user renamed you: your name is now ${name}. This replaces any other name you were given, including the name of a character.`);
  broadcast(modeInfo());
  say(`She is called ${name} now. /rename reset goes back.`);
}

function changePermissionMode(value: PermissionMode, say: Say): void {
  if (!provider.canUseTools) say("This model cannot use tools, so there are no permissions.");
  else if (value === "everything" && settings.provider !== "cursor" && settings.provider !== "opencode") {
    say(settings.provider === "ollama" ? "A local model here has Ask and Plan only: every command, file write and edit asks first." : "Run everything is a Cursor or opencode mode. Claude stays on Ask, Plan, Accept edits or Auto.");
  } else if (settings.provider !== "claude" && (value === "auto" || value === "acceptEdits")) {
    say(
      settings.provider === "ollama"
        ? "A local model here has Ask and Plan. Auto, Accept edits and Run everything are not available for it: every command, file write and edit asks first."
        : `${settings.provider === "cursor" ? "Cursor" : "opencode"} here has Ask, Plan and Run everything. Auto and Accept edits are Claude Code modes.`,
    );
  } else {
    permissionMode = value;
    if (value !== "everything") cursorEverythingNotice = null;
    if (provider.setPermissionMode) provider.setPermissionMode(value);
    else provider.configure(sessionConfig());
    if (value === "everything") {
      say(
        settings.provider === "cursor"
          ? "Run everything: she runs tools without a card, unless Cursor still asks. A deny rule still blocks. This resets to Ask the next time the server starts."
          : "Run everything: opencode runs every tool without a card. This resets to Ask the next time the server starts.",
      );
    }
  }
  broadcast(modeInfo());
}

const permissionNames: Record<string, PermissionMode> = { ask: "manual", plan: "plan", accept: "acceptEdits", auto: "auto", everything: "everything" };
/** The name the user types and the documentation uses ("ask"), not the internal one ("manual"). */
const permissionLabel = (mode: PermissionMode): string => Object.entries(permissionNames).find(([, v]) => v === mode)?.[0] ?? mode;

interface CommandContext {
  /** Everything after the command name. */
  args: string;
  /** The full line as typed. */
  text: string;
  say: Say;
  /** Sends one message to the page that typed the command (not stored, not sent to other tabs). */
  reply: (msg: unknown) => void;
  /** The command came from a device on the network (--lan), not from this machine. */
  remote: boolean;
}

/** What a phone may not do: anything that loosens approvals past Run everything, or that runs on this machine without a card. Naming a project folder by its path, and Run everything, are allowed. */
const remoteRefusal = "That is only possible on the computer itself, not from a phone.";
/** Auto and Accept edits stay on the computer. Run everything may be chosen from a phone. */
const remoteBlockedMode = (mode: unknown) => mode === "acceptEdits" || mode === "auto";

/** The slash commands that would turn on Auto or Accept edits, load the user's hooks, or drive Chrome on this computer. `/work <path>` and `/permissions everything` are allowed. */
function remoteBlocked(name: string, args: string): boolean {
  const a = args.trim().toLowerCase();
  if (name === "restart") return true; // it stops and starts the server on this computer
  if (name === "setup") return a === "on";
  if (name === "chrome") return a === "on"; // it drives the browser on this computer
  if (name === "memory") return a === "auto"; // saving notes without asking loosens a card
  if (name === "permissions") return Object.hasOwn(permissionNames, a) && remoteBlockedMode(permissionNames[a]);
  return false;
}

/** Shows a picture pack (by folder name) or, with null, the drawn avatar again. Used by /frames and the Looks menu. */
async function choosePack(name: string | null, say: Say): Promise<void> {
  if (name === null) {
    if (!settings.framePack) return say("Already showing the drawn avatar.");
    const hadVoice = Boolean(activePack?.character?.voice);
    const hadName = !settings.nameSet && Boolean(activePack?.character);
    settings.framePack = null;
    await saveSettings(settingsPath, settings);
    await refreshPack();
    lookPictureDue = false;
    notes.push(`The user switched you back to your drawn avatar: [avatar ...] tags and gestures work again.${hadVoice ? " Your usual manner of speaking is back too: you no longer speak as the character of the pictures." : ""}${hadName ? ` Your name is ${herName()} again.` : ""}${drawnActivityNote(drawnActivities())}`);
    broadcast(modeInfo());
    broadcast(packMessage());
    broadcast(await packsMessage());
    return say("Back to the drawn avatar.");
  }
  if (!isPackName(name)) return say("A pack name is a folder in data/frames: letters, digits, spaces, . _ -");
  const result = await readPack(packDirs, name, Object.keys(emotions));
  if (!result.ok) {
    const offered = await packInstaller.find(name);
    if (!offered) {
      const note = packInstaller.indexNote();
      return say(note ? `${result.reason} ${note}` : result.reason);
    }
    // Nothing is fetched until the user says yes to the question the page shows (the size and who is contacted).
    broadcast(packOffer(offered));
    return say(`"${name}" is not on this computer yet. The page asks whether to download it (${formatMegabytes(offered.sizes.archiveBytes)}).`);
  }
  const sameCharacter = Boolean(result.pack.character && result.pack.character.id === activePack?.character?.id);
  settings.framePack = name;
  await saveSettings(settingsPath, settings);
  activePack = result.pack;
  await loadLookPicture();
  await refreshOutfits();
  notes.push(packNote(result.pack, outfitCache, herName(), activityIndex[result.pack.character?.id ?? ""]));
  lookPictureDue = true;
  broadcast(modeInfo()); // her name may be the character's now
  broadcast(packMessage());
  broadcast(await packsMessage());
  const updateLine = await offerUpdate(name); // a pack that came from the pack list may have newer files: asked after switching, never before
  // Another outfit of the character already shown: its credit and terms were seen then, so only the change is said.
  if (sameCharacter) return say(`Showing the pack "${name}".${updateLine}`);
  say(
    [
      `Showing the pack "${name}": ${Object.keys(result.pack.emotions).length} emotions, ${result.pack.files.size} pictures.${updateLine}`,
      ...(result.pack.credit ? [`Credit: ${result.pack.credit}`] : []),
      ...result.pack.notes,
    ].join("\n"),
  );
}

/**
 * She changes into another outfit of her character (`[outfit casual]` in a reply). Only outfits of the character of the pack that is on: the tag cannot
 * name any other pack. An outfit that is on this computer is shown at once; one that is not raises the same question the gallery asks (size and host),
 * and nothing is fetched until the user says yes, after which it is shown.
 */
let outfitAsked: { pack: string; at: number } | null = null;

async function wearOutfit(wanted: string): Promise<void> {
  if (!activePack?.character) return notes.push("You have no other outfits: [outfit …] changes nothing.");
  const outfits = await outfitsOfActiveCharacter();
  const choice = outfits.find((o) => o.name === wanted || o.pack.toLowerCase() === wanted);
  const list = outfits.map((o) => o.name).join(", ");
  if (!choice) return notes.push(`You have no outfit called "${wanted}". Your outfits: ${list}.`);
  if (choice.pack === activePack.name) return notes.push(`You already wear ${choice.name}.`);
  if (choice.here) {
    await choosePack(choice.pack, () => {});
    if (activePack?.name !== choice.pack) notes.push(`You could not change into ${choice.name}.`);
    return;
  }
  // The same reply can ask twice (the activity's outfit and her own tag): one question is enough.
  if (outfitAsked?.pack === choice.pack && Date.now() - outfitAsked.at < 60_000) return;
  outfitAsked = { pack: choice.pack, at: Date.now() };
  const entry = await packInstaller.find(choice.pack);
  if (!entry) return notes.push(`${choice.name} is not available right now (the pack list could not be reached), so you stay in ${outfitName(activePack.name, activePack.character.id)}.`);
  broadcast(packOffer(entry));
  notes.push(`${choice.name} is not on this computer yet. The user was asked whether to download it (${formatMegabytes(entry.sizes.archiveBytes)}); you stay in your current outfit until they agree, and then you wear it.`);
}

// --- activities: what she is doing with the user (`[activity swimming]`); in memory only, so a restart or /clear ends it ---
let activity: string | null = null;
const activityMessage = () => ({ type: "activity", name: activity });

/** She started an activity (or, with null, ended it). The outfit that goes with it is put on unless she named another one in the same reply. */
function setActivity(name: string | null, outfitChosen: boolean): void {
  if (name === activity) return;
  activity = name;
  broadcast(activityMessage());
  if (!name) return;
  const outfit = (activePack ? animatedActivities(activePack, activityIndex[activePack.character?.id ?? ""]) : {})[name];
  // Worked out when the message goes out: by then the outfit that goes with it is on (or the user said no), and whether the animation plays is known.
  notes.pushLazy(() => {
    const playing = Boolean(activePack?.activities[name]);
    return (
      `You are doing "${name}" with the user now (the tag is invisible to them). ` +
      (playing ? "Its animation keeps looping until the activity ends. " : "No animation plays for it with the pictures you wear now: use emotions that fit. ") +
      "Write [activity end] when the user is done; they can also end it with the stop button."
    );
  });
  if (!activePack) void offerPackForActivity(name).catch((err) => console.error("activity offer failed:", err));
  if (outfit && !outfitChosen && activePack?.character && outfit !== outfitName(activePack.name, activePack.character.id)) {
    void wearOutfit(outfit).catch((err) => console.error("outfit change failed:", err));
  }
}

/**
 * She started an activity while she is drawn, and her character has a picture pack that animates it (the character file says so): the page asks whether to switch to the
 * pack (an outfit that is not on this computer then raises the usual download question). Animations for the drawn body do not exist yet; without a yes the activity just goes on.
 */
async function offerPackForActivity(name: string): Promise<void> {
  const id = avatar.basePreset?.toLowerCase() ?? "";
  const outfit = drawnActivities()?.[name];
  const who = (await readCharacters(packDirs))[id];
  if (!who || !outfit) return;
  const pack = `${id}-${outfit}`;
  if (!isPackName(pack)) return;
  const here = (await listPacks(...packDirs)).includes(pack);
  if (!here && !(await packInstaller.find(pack))) return; // neither here nor on the pack list: nothing to offer
  if (activity !== name || activePack) return; // ended, or a pack was chosen, meanwhile
  broadcast({ type: "activity-offer", activity: name, pack, character: who.name, outfit });
}

function endActivityByUser(): void {
  if (!activity) return;
  const was = activity;
  activity = null;
  broadcast(activityMessage());
  notes.push(`The user ended the activity "${was}".`);
}

/**
 * Slash commands typed in the chat box. Only a lone `/word` counts, so paths still reach the
 * model. `copy`, `export` and `voice` run in the browser; they are listed here so /help shows them.
 */
/**
 * Looks for newer files of the picture packs the pack list put on this computer, by itself, at most once a day, and only when the user said yes to update
 * checks in the desktop app (`packUpdateChecksOn`). It fetches the list (the one request this adds) and says what it found; nothing is downloaded: the page asks
 * per pack when the user picks it or presses Update in the gallery. Runs when a page connects and once an hour while the server is up.
 */
const packCheckPath = join(dataDir, "pack-check.json");
let lastPackUpdateKey = "";
async function backgroundPackCheck(): Promise<void> {
  if (!(await packUpdateChecksOn())) return;
  const last = Number(JSON.parse(await readFile(packCheckPath, "utf8").catch(() => "{}"))?.lastCheck) || 0;
  if (Date.now() >= last && Date.now() - last < 24 * 3600_000) return;
  await refreshPackIndex(true);
  await writeFile(packCheckPath, JSON.stringify({ lastCheck: Date.now() })).catch(() => {});
  const updates = await packInstaller.updates();
  const key = updates.map((u) => `${u.id}@${u.entry.hashes.sha256}`).join(",");
  if (!updates.length || key === lastPackUpdateKey) return;
  lastPackUpdateKey = key;
  broadcast(await packsMessage());
  broadcast({ type: "notice", text: `Newer versions of picture packs on this computer: ${updates.map((u) => `${u.entry.name} (${u.installed} to ${u.available})`).join(", ")}. Looks → Packs… shows an Update on each; picking one asks before anything is downloaded.` });
}
setInterval(() => void backgroundPackCheck().catch(() => {}), 3600_000).unref();

/**
 * Moves the listener between this machine only and the whole network without a restart, for `/phone` in the desktop app (which starts the server without `--lan`).
 * The page on this machine stays connected (its WebSocket is already upgraded), and phones are signed out when it goes off. Returns what went wrong, or null.
 */
async function setLan(on: boolean): Promise<string | null> {
  if (on === lan) return null;
  const before = bindHost;
  const after = on ? "0.0.0.0" : host;
  if (on) lanToken = await loadToken(lanTokenPath);
  const listenOn = (where: string) =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, where, () => {
        server.off("error", reject);
        resolve();
      });
    });
  server.close(); // stops accepting new connections; open ones carry on
  try {
    await listenOn(after);
  } catch (err) {
    await listenOn(before).catch(() => {});
    return `Could not change phone access: ${err instanceof Error ? err.message : err}`;
  }
  bindHost = after;
  lan = on;
  if (!on) for (const c of clients) if (remoteSockets.has(c)) c.close();
  console.log(on ? "Phone access turned on from /phone (until the next start)." : "Phone access turned off.");
  return null;
}

/** `/play` lists the scenes or starts the one named; `/play end` stops it. She opens it herself. Work mode switches to chat first. */
async function playCommand(args: string, say: Say): Promise<void> {
  const arg = args.trim();
  if (/^(end|stop|off)$/i.test(arg)) {
    if (!sceneId) return say("No scene is on.");
    const title = sceneById(sceneId)?.title ?? sceneId;
    const room = sceneId === "room";
    stopScene();
    say(`Stopped ${title}.`);
    if (room) {
      notes.push(
        `The user gave up on "The locked room". The plan you wrote is still in the conversation. Explain the thread that tied the correct choices together, and name each correct choice in order. A few sentences, then talk normally. If you never wrote a plan, say the room was not set up.`,
      );
      // She is still writing the opening: the note rides on the next message. Otherwise she explains now.
      if (!provider.busy) {
        broadcast({ type: "auto-turn" });
        turns.run("The user stopped the locked room. Explain the thread now.");
      }
      return;
    }
    notes.push(`The user ended the scene "${title}". Talk normally again.`);
    return;
  }
  if (basicMode) return say("A scene needs a real brain. This is the built-in script, so pick a brain in the menu and then /play.");
  const blocked = cannotChange();
  if (blocked) return say(blocked);
  if (turns.holding()) return say("Decide what to do with your earlier message first (the question above).");
  if (settings.provider === "claude" && coldCache(convo)) {
    return say("This chat has gone cold, so starting a scene would reread all of it. Send a message first (you will be asked), then /play.");
  }
  const switched = mode !== "chat";
  if (switched) {
    await switchMode("chat", undefined, say);
    if (mode !== "chat") return;
  }
  const lead = switched ? "Switched to chat. " : "";
  if (!arg) {
    if (sceneId) return say(`Already playing ${sceneById(sceneId)?.title ?? sceneId}. /play end stops it.`);
    if (SCENES.length !== 1) return say(`${lead}Scenes: ${sceneList()}`);
  }
  const started = startPlay(arg || SCENES[0].id);
  if (!started.ok) return say(`${lead}${started.text}`);
  if (sceneId === started.scene.id) return say(`Already playing ${started.scene.title}. /play end stops it.`);
  sceneId = started.scene.id;
  sceneNoteText = started.note;
  say(`${lead}${started.scene.title}. ${started.blurb} /play end stops it.`);
  // The first reply writes the whole story before any of it can be shown, so the page says so at once.
  if (started.scene.id === "room") {
    say("Setting up the game. Please wait.");
    broadcast({ type: "auto-turn" });
  }
  turns.run("The user started a short scene with /play. Open it now.");
}

/** True once `/restart` has been accepted, so a second one does not start another hand-off. */
let restarting = false;

/** Close what this process holds, then let the parent (or this process, for a daemon) start a new server. */
function beginRestart(): void {
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    provider.close();
    avatar.close();
    handOff({
      execPath: process.execPath,
      argv: process.argv,
      env: process.env,
      cwd: process.cwd(),
      pidFile: join(dataDir, "server.pid"),
      logFile: join(dataDir, "server.log"),
      ownPid: process.pid,
      exit: (code) => process.exit(code),
    });
  };
  for (const c of clients) c.close();
  server.closeAllConnections();
  server.close(leave);
  setTimeout(leave, 1000).unref();
}

const slashCommands: Record<
  string,
  {
    help: string;
    /** Needs Claude Code underneath: with another brain the command says so instead of pretending. */
    claudeOnly?: boolean;
    run: (ctx: CommandContext) => void | Promise<void>;
  }
> = {
  welcome: {
    help: "a short tour of what is here, and the command for each thing",
    run: ({ say }) => say(welcome()),
  },
  help: {
    help: "list these commands",
    run: ({ say }) => {
      const claude = settings.provider === "claude";
      say(
        Object.entries(slashCommands)
          .map(([name, c]) => `/${name}: ${c.help}${c.claudeOnly && !claude ? " (needs Claude Code)" : ""}`)
          .join("\n") +
          "\n!command: run a shell command in your project folder (work mode), e.g. !git status\nCtrl+C (or the stop button): stop her reply or a running !command",
      );
    },
  },
  clear: { help: "forget the conversation and start fresh", run: () => resetConversation() },
  new: { help: "same as /clear", run: () => resetConversation() },
  compact: {
    help: "summarise the conversation to free up context",
    claudeOnly: true,
    run: ({ text, say }) => {
      if (provider.busy) return say("Wait for her to finish the current reply first.");
      transcript.user(text);
      broadcast({ type: "user", text });
      turns.run(text, { raw: true });
    },
  },
  resume: {
    help: "list earlier conversations in this folder, then /resume <number> to continue one",
    run: ({ args, say }) => resumeCommand(args, say),
  },
  status: {
    help: "show the brain, model, mode, folder and session",
    run: ({ say }) => {
      const info = modeInfo();
      say(
        [
          `Brain: ${provider.name}`,
          `Mode: ${info.mode}${mode === "work" ? ` · permissions: ${permissionLabel(permissionMode)}` : ""}`,
          `Folder: ${settings.projectDir ?? "(none)"}`,
          `Session: ${provider.sessionId ?? "(none)"}`,
        ].join("\n"),
      );
    },
  },
  cost: {
    help: "what this conversation has used so far (an estimate)",
    claudeOnly: true,
    run: ({ say }) => {
      const u = provider.usage;
      if (!u) return say("This brain does not report usage.");
      if (u.turns === 0) return say("Nothing yet: usage shows after her next reply.");
      const context = u.contextTokens === null ? "unknown" : `~${u.contextTokens.toLocaleString("en-US")} tokens`;
      say(
        `This conversation: about $${u.costUsd.toFixed(4)} at API prices (a subscription is not billed per token).\n` +
          `Context in use: ${context}. /compact frees it up.`,
      );
    },
  },
  model: {
    help: "show or set the model, e.g. /model opus (until the server restarts)",
    run: async ({ args, say }) => {
      if (settings.provider === "ollama") return say("Pick the Ollama model in the dropdown.");
      if (settings.provider === "cursor" || settings.provider === "opencode") {
        const label = settings.provider === "cursor" ? "Cursor" : "opencode";
        if (!args) return say(`Model: ${shownModel() || `(waiting for ${label})`}`);
        const blocked = cannotChange();
        if (blocked) return say(blocked);
        if (settings.provider === "cursor") settings.cursorModel = args;
        else settings.opencodeModel = args;
        await saveSettings(settingsPath, settings);
        provider.configure(sessionConfig());
        broadcast(modeInfo());
        return say(`Model set to ${args}.`);
      }
      const current = mode === "work" ? settings.workModel : settings.chatModel;
      if (!args) return say(`Model: ${current} (${mode} mode)`);
      if (!/^[A-Za-z0-9][\w.\-\[\]]{0,59}$/.test(args)) return say("That does not look like a model name.");
      const blocked = cannotChange();
      if (blocked) return say(blocked);
      if (mode === "work") settings.workModel = args;
      else settings.chatModel = args;
      provider.configure(sessionConfig());
      broadcast(modeInfo());
      say(`Model set to ${args} for ${mode} mode, until the server restarts.`);
    },
  },
  chat: { help: "switch to chat mode (no tools)", run: ({ say }) => switchMode("chat", undefined, say) },
  work: { help: "switch to work mode, optionally for a folder: /work ~/project", run: ({ args, say }) => switchMode("work", args, say) },
  permissions: {
    help: "ask, plan, accept (edits), auto (Claude), or everything (Cursor, opencode): how work mode handles approvals",
    run: ({ args, say }) => {
      const key = args.toLowerCase();
      const wanted = Object.hasOwn(permissionNames, key) ? permissionNames[key] : undefined;
      if (!wanted) return say(`Permissions: ${permissionLabel(permissionMode)}. Use /permissions ${Object.keys(permissionNames).join(" | ")}`);
      changePermissionMode(wanted, say);
    },
  },
  effort: {
    help: `how hard she thinks: ${efforts.join(" | ")} | default (follow your Claude settings)`,
    claudeOnly: true,
    run: ({ args, say }) => {
      const wanted = args.toLowerCase();
      if (wanted === "default" || isEffort(wanted)) return changeEffort(wanted, say);
      const now = effectiveEffort();
      say(`Effort: ${now ?? "Claude's default"}${settings.effort === "default" ? " (from your Claude settings)" : ""}. Use /effort ${efforts.join(" | ")} | default`);
    },
  },
  rename: {
    help: "rename the companion: /rename Hana (or click her name at the top); /rename reset goes back to the character's name (or Risa)",
    run: ({ args, say }) => (args ? rename(args, say) : say(`She is called ${herName()}${settings.nameSet ? "" : activePack?.character ? " (the name of the character of the pack that is on)" : ""}. /rename <new name> gives her a name of your own, /rename reset goes back.`)),
  },
  setup: {
    help: "work mode: use your own Claude Code setup (settings, hooks, MCP servers): /setup on | off",
    claudeOnly: true,
    run: ({ args, say }) => {
      const wanted = args.toLowerCase();
      if (wanted === "on" || wanted === "off") return changeClaudeSetup(wanted === "on", say);
      say(`Your Claude Code setup is ${claudeSetup ? "on" : "off"} in work mode. Use /setup on | off`);
    },
  },
  chrome: {
    help: "work mode: let her use your Chrome through the Claude in Chrome extension (the extension must already be installed and signed into the same account): /chrome on | off",
    claudeOnly: true,
    run: ({ args, say }) => {
      const wanted = args.toLowerCase();
      if (wanted === "on" || wanted === "off") return changeClaudeChrome(wanted === "on", say);
      say(`Chrome is ${claudeChrome ? "on" : "off"} in work mode. Use /chrome on | off`);
    },
  },
  persona: {
    help: "whose voice she speaks in (your own persona, the character of the pack that is on, or the default): /persona | show | edit | reset",
    run: async ({ args, say, remote }) => personaVoice.command(args, say, remote),
  },
  memory: {
    help: "her notes about you (data/memory.md): /memory | add <note> | forget <number|all> | edit | ask | auto | off",
    run: async ({ args, say, remote }) => memory.command(args, say, remote),
  },
  card: {
    help: "character cards: /card import <file.png|.json> | apply [greeting] [lore] [orders] | cancel | export | reset",
    run: ({ args, say, reply, remote }) => cards.command(args, say, reply, remote),
  },
  studio: {
    help: "make a picture pack of your own on this computer with an image model you run: /studio on | off | handover [outfit] | backend <address, xai, gemini, openai, grok-web, gemini-web or chatgpt-web> | budget <dollars>",
    run: ({ args, say, remote, reply }) => studio.command(args, say, remote, reply),
  },
  skills: {
    help: "work mode: let her use your own skills (~/.claude/skills) by name; your hooks stay off: /skills on | off",
    claudeOnly: true,
    run: ({ args, say, remote }) => skills.command(args, say, remote),
  },
  plan: { help: "same as /permissions plan", run: ({ say }) => changePermissionMode("plan", say) },
  rc: {
    help: "remote control from claude.ai or the phone (not built in; shows how to do it yourself)",
    claudeOnly: true,
    run: ({ say }) => remoteControlHint(say),
  },
  "remote-control": { help: "same as /rc", claudeOnly: true, run: ({ say }) => remoteControlHint(say) },
  rewind: {
    help: "roll back to an earlier point (not available in the companion)",
    claudeOnly: true,
    run: ({ say }) =>
      say(
        "/rewind is not available in the companion: it relies on Claude Code's own interactive checkpoints. " +
          `To use it, continue this conversation in a terminal${resumeCommandLine()} and run /rewind there. Only one side should write at a time.`,
      ),
  },
  restart: {
    help: "restart the server (the page reconnects; the conversation stays; phone access and permissions go back to a fresh start). Not from a phone",
    run: async ({ say, remote }) => {
      if (remote) return say(remoteRefusal);
      if (restarting) return say("Already restarting.");
      restarting = true;
      say("Restarting. The page reconnects in a moment. Phone access and permissions go back to how they are at every start, and the conversation stays.");
      try {
        await transcript.save({ provider: basicMode ? "basic" : settings.provider, sessionId: provider.sessionId, ...convo });
      } catch (err) {
        console.error("could not save the transcript:", err);
      }
      await new Promise((r) => setTimeout(r, 200));
      beginRestart();
    },
  },
  doctor: {
    help: "check what the app needs (Node, the character creator, the brains, opencode, her data folder) and say what is missing; it only looks, nothing is changed",
    run: async ({ say, remote }) => {
      if (remote) return say(remoteRefusal); // it names folders and programs on this computer
      say("Looking at what the app needs… (nothing is changed)");
      try {
        say(formatDoctor(await checkAll(realProbe(root, port, true))));
      } catch (err) {
        say(`The check could not finish: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
  "claude-login": {
    help: "sign in to Claude Code again (runs `claude auth login`, which opens your browser); use it when she says Claude Code is not signed in",
    claudeOnly: true,
    run: async ({ say, remote }) => {
      if (remote) return say(remoteRefusal); // it opens a sign-in on this computer
      say("Starting Claude Code's own sign-in (`claude auth login`)…");
      const ok = await runClaudeLogin(say, brainProgram("claude") ?? "claude");
      if (ok) {
        if (settings.provider === "claude") provider.close(); // the next message starts claude again with the new login and resumes the conversation
        say("Done. Send your message again.");
      }
    },
  },
  "install-opencode": {
    help: "install the opencode this app was made for (a fixed version, checked against a known checksum) into the app's own folder; it asks first, is used instead of any other opencode, and leaves yours alone",
    run: ({ say, reply, remote }) => {
      if (remote) return say(remoteRefusal); // it fetches and runs a program
      const asset = opencodeAsset();
      if (!asset) return say(`There is no pinned opencode download for this computer (${process.platform} ${process.arch}). Install opencode from https://opencode.ai, or set OPENCODE_BIN to its program.`);
      if (process.env.OPENCODE_BIN) return say(`OPENCODE_BIN (${process.env.OPENCODE_BIN}) is set, and it wins over a copy the app installs, so installing one would change nothing. Unset OPENCODE_BIN to use the app's own copy.`);
      const have = managedOpencode();
      if (have) return say(`The app's own opencode ${OPENCODE_PIN.version} is already installed (${have}) and is the one she uses; any other opencode on this computer is ignored. To fetch it again, delete the folder ${opencodeFolder()} and run /install-opencode.`);
      reply(opencodeOffer(true) as Record<string, unknown>);
      say(`The page asks whether to install opencode ${OPENCODE_PIN.version} for the app only (${Math.round(asset.bytes / 1048576)} MB from registry.npmjs.org, into ${opencodeFolder()}). Nothing is fetched until you say yes. By hand: ${opencodeUrl(asset)}, unpacked into that folder.`);
    },
  },
  frames: {
    help: "show her with pictures instead of the drawn avatar: /frames lists the packs, /frames <name> uses one (when the pack list has it and it is not installed, the page asks first, with the size, before downloading it), /frames off goes back",
    run: async ({ args, say }) => {
      const wanted = args.trim();
      if (!wanted) {
        await refreshPackIndex(false);
        const packs = await listPacks(...packDirs);
        const remote = remotePacks(packs);
        const using = settings.framePack ? `Showing the pack "${settings.framePack}".` : "Showing the drawn avatar.";
        if (!packs.length && !remote.length) return say(`${using} There are no packs in data/frames yet; docs/frame-packs.md says how to make one.`);
        // By character, as the gallery shows them: the packs on this computer (yours in data/frames, and those shipped in packs/), then the ones the pack list offers.
        const newer = new Set((await packInstaller.updates()).map((u) => u.id));
        const lines = groupPacks(packs, await packCharacters(packDirs, packs), remote).map(
          (g) => `- ${g.who?.name ?? "Other"}: ${[g.here.map((n) => (newer.has(n) ? `${n} (update available)` : n)).join(", "), g.offered.length ? `${g.here.length ? "(" : ""}not installed yet: ${g.offered.join(", ")}${g.here.length ? ")" : ""}` : ""].filter(Boolean).join(" ")}`,
        );
        const hint = remote.length || newer.size ? "/frames <name> uses one (it asks first when it has to be downloaded or updated), /frames off goes back." : "/frames <name> uses one, /frames off goes back.";
        return say(`${using} Packs, by character:\n${lines.join("\n")}\n${hint}`);
      }
      await choosePack(wanted.toLowerCase() === "off" ? null : wanted, say);
    },
  },
  show: {
    help: "she shows all her emotions, a blink, talking and her gestures, one at a time, naming each (no model call)",
    run: () => broadcast(demoMessage(Object.keys(emotions), GESTURE_NAMES, activePack)),
  },
  phone: {
    help: "show the link for controlling her from a phone on this network (it asks first if phone access is off; `/phone new` makes a new link, `/phone off` turns it off)",
    run: async ({ args, say, reply, remote }) => {
      if (remote) return say(remoteRefusal);
      if (args.trim() === "off") {
        if (!lan) return say("Phone access is already off.");
        const failed = await setLan(false);
        return say(failed ?? "Phone access is off: phones are signed out and only this computer can reach her.");
      }
      if (!lan) {
        // The answer comes from the page on this computer (`lan-answer`), and only to this question.
        lanAsked = true;
        reply({ type: "lan-offer" });
        return say("Phone access is off. The page asks whether to turn it on. It stays on until you restart, and is off again at every start.");
      }
      if (args.trim() === "new") {
        lanToken = await saveToken(lanTokenPath, newToken());
        for (const c of clients) if (remoteSockets.has(c)) c.close(); // every signed-in phone has to use the new link
        say("Made a new link. Phones that used the old one are signed out.");
      }
      const links = phoneLinks(port, lanToken);
      reply({ type: "phone", links, qr: qrRows(links[0]) });
    },
  },
  play: {
    help: "play a short scene in chat (work mode switches to chat): /play lists them; /play key or /play room (counts: /play room 5 1 3 1); the room asks you to wait while she writes it, and she explains the thread when you finish or stop; /play end stops it",
    run: ({ args, say }) => playCommand(args, say),
  },
  copy: { help: "copy her last reply to the clipboard", run: () => {} },
  export: { help: "download the conversation as a Markdown file", run: () => {} },
  voice: { help: "turn spoken replies on or off", run: () => {} },
};
Object.setPrototypeOf(slashCommands, null); // so "/constructor" is just unknown

/** `cd <folder> && claude --resume <id>` for continuing this conversation in a terminal. */
function resumeCommandLine(): string {
  const folder = sessionCwd();
  const quoted = /^[\w@%+=:,./-]+$/.test(folder) ? folder : `'${folder.replace(/'/g, `'\\''`)}'`;
  return `: cd ${quoted} && claude --resume ${provider.sessionId}`;
}

function remoteControlHint(say: Say): void {
  say(
    "Remote control is not available in the companion. It links a session to claude.ai or the Claude app through Anthropic's servers, " +
      "and a remote client would be answering permission questions outside the approval cards here. " +
      `To use it, start a terminal session with it enabled and keep the browser out of that conversation${resumeCommandLine()} --remote-control`,
  );
}

let pickerOpen = false;

/** The "Choose folder…" button: ask the operating system's folder dialog, then work there. */
async function chooseFolder(say: Say): Promise<void> {
  const blocked = cannotChange();
  if (blocked) return say(blocked);
  if (pickerOpen) return say("The folder dialog is already open.");
  pickerOpen = true;
  broadcast({ type: "picking", on: true });
  try {
    const result = await pickFolder(settings.projectDir);
    if ("error" in result) say(result.error);
    else if ("path" in result) await switchMode("work", result.path, say);
  } finally {
    pickerOpen = false;
    broadcast({ type: "picking", on: false });
  }
}

let installAbort: AbortController | null = null;
void cleanInstallLeftovers(); // a scratch folder from an install that was cut short by closing the app

/**
 * The question shown before anything is fetched, saying who is contacted, how much and where it goes. Null when opencode is already there, or when
 * there is no pinned build for this machine (then the page falls back to saying how to install it by hand).
 */
function opencodeOffer(force = false): Record<string, unknown> | null {
  const asset = opencodeAsset();
  // OPENCODE_BIN is the user's own choice and wins over a copy we install, so installing one would not make it start: no offer then.
  if (!asset || process.env.OPENCODE_BIN || managedOpencode()) return null;
  // Another opencode on the PATH is enough for the automatic offers (nothing is missing), but `/install-opencode` asks for the pinned one all the same: the app's own copy is then used instead.
  if (!force && isInstalled("opencode")) return null;
  return {
    type: "install-offer",
    brain: "opencode",
    version: OPENCODE_PIN.version,
    host: "registry.npmjs.org",
    megabytes: Math.round(asset.bytes / 1048576),
    folder: opencodeFolder(),
    others: isInstalled("opencode"), // another opencode is on this computer: the card says the app's own copy is used instead and the other stays untouched
  };
}

/** Installs the pinned opencode, telling every page how far it is. The page that asked then picks the brain, as if from the menu. */
async function installOpencodeFor(say: Say): Promise<void> {
  if (installAbort) return say("opencode is already being installed.");
  const abort = (installAbort = new AbortController());
  let shown = -1;
  try {
    await installOpencode({
      signal: abort.signal,
      onProgress: (p) => {
        const percent = p.stage === "download" && p.total ? Math.floor(((p.received ?? 0) / p.total) * 100) : null;
        if (percent !== null && percent === shown) return;
        if (percent !== null) shown = percent;
        broadcast({ type: "install-progress", stage: p.stage, percent });
      },
    });
    installedJustNow = true;
    broadcast({ type: "install-done", ok: true });
  } catch (err) {
    broadcast({ type: "install-done", ok: false, text: err instanceof InstallError ? err.message : `Could not install opencode: ${err instanceof Error ? err.message : String(err)}` });
  } finally {
    installAbort = null;
  }
}

let shellRunning = false;
let shellAbort: AbortController | null = null;

/** `!command` in the chat box: run it in the project folder and tell the model afterwards, like Claude Code's bash mode. */
async function runBang(command: string, say: Say): Promise<void> {
  if (shellDisabled()) return say("!commands are turned off on this server (COMPANION_NO_SHELL is set).");
  if (mode !== "work") return say("!commands run in work mode, in your project folder. Switch to Work first.");
  if (shellRunning) return say("A command is still running; wait for it to finish.");
  shellRunning = true;
  shellAbort = new AbortController();
  const id = randomUUID();
  broadcast({ type: "shell", id, command });
  try {
    const result = await runShell(command, settings.projectDir ?? workspace, { signal: shellAbort.signal });
    const output =
      result.output +
      (result.truncated ? "\n[output cut off]" : "") +
      (result.timedOut ? "\n[stopped after 2 minutes]" : shellAbort.signal.aborted ? "\n[stopped]" : "");
    transcript.shell({ command, output, code: result.code });
    persistTranscript();
    // The model did not see this; tell it with her next message.
    notes.push(
      `the user ran a shell command themselves in ${settings.projectDir ?? workspace}: $ ${command} (exit ${result.code ?? "none"}). It printed: ${output.trim().slice(0, 4000).replace(/\n{2,}/g, "\n") || "(nothing)"}`,
    );
    broadcast({ type: "shell-done", id, output, code: result.code });
  } finally {
    shellRunning = false;
    shellAbort = null;
  }
}

/** Ctrl+C / the stop button: end the command or the reply that is running. */
function stopWork(say: Say): void {
  if (shellAbort) {
    shellAbort.abort();
  } else if (provider.interrupt()) {
    queue.drop();
    for (const id of pendingPermissions.keys()) broadcast({ type: "permission-cancelled", id });
    pendingPermissions.clear();
    broadcast({ type: "notice", text: "Stopped." });
  } else say("Nothing is running.");
}

/** Where Claude Code is (or would be) running, so where its sessions are stored. */
const sessionCwd = () => (mode === "work" ? sessionConfig().cwd : workspace);
let lastListing: SessionInfo[] = [];

function ago(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

let lastAcpListing: { id: string; title: string; modified: Date }[] = [];

/** Cursor and opencode keep the conversation in their own session. The on-screen log is ours, so resuming starts that screen clean. */
async function resumeAcp(args: string, say: Say): Promise<void> {
  const acp = acpBrain();
  if (!acp) return;
  const blocked = cannotChange();
  if (blocked) return say(blocked);
  const cwd = sessionCwd();
  const label = settings.provider === "cursor" ? "Cursor" : "opencode";
  if (!args) {
    try {
      lastAcpListing = await acp.listSessions(cwd);
    } catch (err) {
      return say(err instanceof Error ? err.message : String(err));
    }
    if (lastAcpListing.length === 0) return say(`No earlier ${label} conversations in ${cwd}.`);
    const lines = lastAcpListing.map(
      (s, i) => `${i + 1}. ${ago(s.modified)} · ${s.title}${s.id === acp.sessionId ? " (current)" : ""}`,
    );
    return say(`Conversations in ${cwd}:\n${lines.join("\n")}\nContinue one with /resume <number>. The screen starts clean; she still remembers it.`);
  }
  const chosen = /^\d+$/.test(args) ? lastAcpListing[Number(args) - 1] : undefined;
  if (!chosen) return say(lastAcpListing.length ? "No such entry. Run /resume to see the list." : "Run /resume first to see the list.");
  if (chosen.id === acp.sessionId) return say("That is the current conversation.");
  acp.resume(chosen.id);
  transcript.clear();
  renewNotes();
  pendingPermissions.clear();
  persistTranscript();
  broadcast({ type: "history", items: transcript.snapshot() });
  broadcast(modeInfo());
  say(`Resumed: ${chosen.title}`);
}

async function resumeCommand(args: string, say: Say): Promise<void> {
  if (settings.provider === "cursor" || settings.provider === "opencode") return resumeAcp(args, say);
  if (!provider.resume) return say("/resume needs Claude Code, Cursor or opencode; this model has no saved sessions.");
  const blocked = cannotChange();
  if (blocked) return say(blocked);
  const cwd = sessionCwd();
  if (!args) {
    lastListing = await listSessions(cwd);
    if (lastListing.length === 0) return say(`No earlier conversations in ${cwd}.`);
    const lines = lastListing.map(
      (s, i) => `${i + 1}. ${ago(s.modified)} · ${s.title}${s.id === provider.sessionId ? " (current)" : ""}`,
    );
    return say(`Conversations in ${cwd}:\n${lines.join("\n")}\nContinue one with /resume <number>.`);
  }
  const chosen = /^\d+$/.test(args) ? lastListing[Number(args) - 1] : args.length >= 4 ? lastListing.find((s) => s.id.startsWith(args.toLowerCase())) : undefined;
  if (!chosen) return say(lastListing.length ? "No such entry. Run /resume to see the list." : "Run /resume first to see the list.");
  if (chosen.id === provider.sessionId) return say("That is the current conversation.");
  const path = sessionPath(cwd, chosen.id);
  if (!path || !existsSync(path)) return say("That conversation is no longer on disk.");
  let items;
  try {
    items = await loadSessionItems(path);
  } catch (err) {
    return say(String(err instanceof Error ? err.message : err));
  }
  provider.resume(chosen.id);
  turns.dropHeld();
  const size = await sessionContext(path).catch(() => null);
  convo.contextTokens = size?.contextTokens ?? null;
  convo.lastReplyAt = size ? size.modified.getTime() : null;
  transcript.clear();
  transcript.items = items;
  renewNotes();
  pendingPermissions.clear();
  persistTranscript();
  broadcast({ type: "history", items: transcript.snapshot() });
  broadcast(modeInfo());
  broadcast({ type: "notice", text: `Resumed: ${chosen.title}` });
}

function parseSlash(text: string): { name: string; args: string } | null {
  const match = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return match ? { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() } : null;
}

function forgetConversationSize(): void {
  convo.contextTokens = null;
  convo.lastReplyAt = null;
  skills.forgetOffer();
  cards.forgetLore();
  memory.forgetTold(); // a new conversation is told her notes again
  personaVoice.forgetTold();
  studio.forgetTold();
  turns.dropHeld();
}

/** In basic mode an empty conversation opens by saying what she is and how to get a real brain: shown like a reply, nothing was asked of anything. */
function greetBasic(): void {
  if (!basicMode || provider.busy || transcript.items.length > 0) return;
  const said = basicGreeting(herName());
  transcript.delta(said);
  transcript.flush();
  persistTranscript();
  broadcast({ type: "delta", text: said });
  broadcast({ type: "done" });
}

/** Set when the page's one-click install of opencode has just finished: the new conversation with it opens by saying so (see greetInstalled). */
let installedJustNow = false;

/**
 * After the one-click install the page switches her to opencode, which starts an empty conversation; without a word on it the empty chat is the only sign that
 * it worked. Said like a reply (kept in the history, shown on every open page), and nothing was asked of the model.
 */
function greetInstalled(): void {
  if (!installedJustNow || settings.provider !== "opencode" || provider.busy || transcript.items.length > 0) return;
  installedJustNow = false;
  const said = "[emotion:happy] opencode is installed and I am using it now. Say hello to start!";
  transcript.delta(said);
  transcript.flush();
  persistTranscript();
  broadcast({ type: "delta", text: said });
  broadcast({ type: "done" });
}

function resetConversation(): void {
  queue.drop();
  provider.reset();
  forgetConversationSize();
  transcript.clear();
  persistTranscript();
  renewNotes();
  stopScene();
  activity = null;
  pendingPermissions.clear();
  broadcast({ type: "reset" });
  broadcast(activityMessage());
  broadcast(modeInfo());
  cards.greet();
  greetBasic();
}

// --- messages typed while she is still answering: see queue-service.ts ---
const queue = createQueueService({
  busy: () => provider.busy,
  held: () => turns.holding(),
  send: (text, images) => turns.send(text, images),
  broadcast: (msg) => broadcast(msg),
});

// --- a turn, from the message to the saved reply: see turn-service.ts ---
const turns = createTurnService({
  provider: () => provider,
  brain: () => settings.provider,
  avatar,
  transcript,
  activePack: () => activePack,
  wearOutfit: (name: string) => void wearOutfit(name).catch((err) => console.error("outfit change failed:", err)),
  activity: setActivity,
  chatMode: () => mode === "chat",
  sceneNote: () => (mode === "chat" && sceneId ? sceneNoteText : null),
  sceneEndedByHer: () => {
    stopScene();
  },
  takeLookPicture: () => {
    const picture = lookPictureDue && lookPicture ? lookPicture : null;
    lookPictureDue = false;
    // Only brains that read pictures get it: Claude, and an Ollama model that says it can. Everyone else has the description.
    const sees = !basicMode && (settings.provider === "claude" || (settings.provider === "ollama" && ollamaBrain.canSeePicturesFor(settings.ollamaModel)));
    return picture && sees ? [picture] : [];
  },
  notReady: () =>
    settings.provider === "ollama" && !settings.ollamaModel
      ? ollamaNotReady()
      : settings.provider === "cursor" && mode === "work" && permissionMode === "manual" && cursorApprovalMode() === "unrestricted"
        ? CURSOR_UNRESTRICTED_TEXT
        : null,
  emotionNames: () => Object.keys(emotions),
  folder: () => sessionConfig().cwd,
  broadcast: (msg) => broadcast(msg),
  persist: () => persistTranscript(),
  convo,
  account,
  pendingPermissions,
  meterInfo: () => meterInfo(),
  looksInfo: () => looksInfo(),
  notes,
  memory,
  persona: personaVoice,
  studio,
  cards,
  skills,
  queue,
});

// Background subagents outlive the reply that started them, so the page needs to hear when they end.
const backgroundMessage = () => ({ type: "background", tasks: provider.backgroundTasks ?? [] });
for (const p of Object.values(providers)) {
  p.onBackground?.(() => {
    if (p === provider) broadcast(backgroundMessage());
  });
}

// A turn the brain starts on its own (a background subagent finished) is shown like any reply.
for (const p of Object.values(providers)) {
  p.onUnprompted?.(() => {
    broadcast({ type: "auto-turn" });
    return turns.turnHandler("", { raw: true });
  });
}

wss.on("connection", (ws) => {
  const remote = remoteSockets.has(ws);
  clients.add(ws);
  void backgroundPackCheck().catch(() => {});
  // `remote` is only for this socket: the page then types a folder instead of opening the dialog, which runs on this computer.
  ws.send(JSON.stringify({ type: "hello", provider: provider.name, version: avatar.version, ...(remote ? { remote: true } : {}) }));
  void refreshPack()
    .then(async () => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify(packMessage()));
      ws.send(JSON.stringify(activityMessage()));
      if (lookRefreshedNotice) {
        ws.send(JSON.stringify({ type: "notice", text: lookRefreshedNotice }));
        lookRefreshedNotice = null;
      }
      if (avatar.refreshOffer) ws.send(JSON.stringify({ type: "look-refresh-offer", preset: avatar.refreshOffer.preset, name: herName0(avatar.refreshOffer.preset) }));
      ws.send(JSON.stringify(await packsMessage()));
      // The pack she was last shown with is not on this computer (it is downloaded on demand now): ask, rather than silently showing the drawn avatar.
      if (settings.framePack && !activePack) {
        const offered = await packInstaller.find(settings.framePack);
        if (offered && ws.readyState === ws.OPEN) ws.send(JSON.stringify(packOffer(offered)));
      }
    })
    .catch((err) => console.error("could not send the packs:", err));
  if (!remote) void studio.stateMessage().then((m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)));
  ws.send(JSON.stringify(modeInfo()));
  if (cursorEverythingNotice) ws.send(JSON.stringify({ type: "notice", text: cursorEverythingNotice }));
  ws.send(JSON.stringify(looksInfo()));
  ws.send(JSON.stringify(meterInfo()));
  ws.send(JSON.stringify(backgroundMessage()));
  ws.send(JSON.stringify(queue.message()));
  void skills.maybeNotice((text) => ws.send(JSON.stringify({ type: "notice", text })));
  ws.send(JSON.stringify({ type: "history", items: transcript.snapshot() }));
  // After the history, which the page draws over everything shown before it.
  if (!remote && process.env.COMPANION_NO_WELCOME !== "1" && !existsSync(welcomedPath)) {
    ws.send(JSON.stringify({ type: "notice", text: welcome() }));
    void mkdir(dataDir, { recursive: true }).then(() => writeFile(welcomedPath, "1\n")).catch(() => {});
  }
  cards.greet(); // an empty conversation opens with her greeting, if the card has one
  greetBasic();
  const offer = basicMode && !remote ? opencodeOffer() : null; // with no brain at all, the way out is one click away
  if (offer) ws.send(JSON.stringify(offer));
  const acp = acpBrain();
  if (acp?.lastError) ws.send(JSON.stringify({ type: "notice", text: acp.lastError }));
  if (acp?.replacedSession) {
    acp.replacedSession = false;
    ws.send(JSON.stringify({ type: "notice", text: `Could not resume that ${settings.provider} session, so this is a new conversation.` }));
  }
  for (const request of pendingPermissions.values()) ws.send(JSON.stringify({ type: "permission", request }));
  for (const offer of memory.pending()) ws.send(JSON.stringify({ type: "memory-offer", ...offer }));
  for (const offer of personaVoice.pending()) ws.send(JSON.stringify({ type: "persona-offer", ...offer }));
  const question = turns.heldQuestion();
  if (question) ws.send(JSON.stringify(question));
  void refreshOllamaModels();
  ws.on("close", () => clients.delete(ws));
  let commandChain: Promise<void> = Promise.resolve();
  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "user" && typeof msg.text === "string" && (msg.text.trim() || msg.images?.length)) {
      const say: Say = (text) => ws.send(JSON.stringify({ type: "notice", text }));
      const images = parseImages(msg.images);
      if (typeof images === "string") return say(images);
      // A command is a command with a picture attached too: it runs here and the model never sees either.
      const bang = /^!\s*(\S[\s\S]*)$/.exec(msg.text.trim());
      const command = bang ? null : parseSlash(msg.text);
      if ((bang || command) && images.length) say("Commands run on their own, so the attached picture was not sent.");
      if (bang) return remote ? say(remoteRefusal) : void (await runBang(bang[1], say));
      if (command) {
        // One at a time, in the order they were typed: a command that waits for something (`/frames` asks the pack list) must not be answered after the
        // quick ones sent behind it. Only commands queue; stopping and every other message stay immediate.
        commandChain = commandChain
          .then(async () => {
            const known = slashCommands[command.name];
            if (!known) say(`Unknown command /${command.name}. Try /help.`);
            else if (remote && remoteBlocked(command.name, command.args)) say(remoteRefusal);
            else if (known.claudeOnly && settings.provider !== "claude") {
              say(`/${command.name} needs Claude Code; the current brain is ${provider.name}, which does not support it.`);
            } else await known.run({ args: command.args, text: msg.text, say, reply: (out) => ws.send(JSON.stringify(out)), remote });
          })
          .catch((err) => {
            console.error(`/${command.name} failed:`, err);
            say(`/${command.name} failed: ${err instanceof Error ? err.message : String(err)}`);
          });
        return;
      }
      turns.submit(msg.text, images, say);
    } else if (msg.type === "card-reply" && (msg.choice === "apply" || msg.choice === "cancel")) {
      await cards.answer(msg.choice, msg.use, (text) => ws.send(JSON.stringify({ type: "notice", text })), remote);
    } else if (msg.type === "memory-reply") {
      memory.answer(msg.id, msg.choice, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "persona-reply") {
      personaVoice.answer(msg.id, msg.choice, (text) => ws.send(JSON.stringify({ type: "notice", text })), remote);
    } else if (msg.type === "memory-undo") {
      memory.undo(msg.fact, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "unqueue" && typeof msg.id === "string") {
      queue.remove(msg.id);
    } else if (msg.type === "claude-skills" && typeof msg.value === "boolean") {
      if (remote && msg.value) return ws.send(JSON.stringify({ type: "notice", text: remoteRefusal }));
      skills.change(msg.value, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "skills-reply") {
      skills.answer(msg.choice, remote, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "cold-reply" && typeof msg.choice === "string") {
      turns.answerCold(msg.choice, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "permission-reply" && typeof msg.id === "string") {
      const decision = msg.decision as Decision;
      const request = pendingPermissions.get(msg.id);
      if (!["allow", "allow-session", "deny"].includes(decision) || !request) return;
      pendingPermissions.delete(msg.id);
      provider.respondPermission(msg.id, decision);
      broadcast({ type: "permission-resolved", id: msg.id, decision });
      // "Allow, and from now on ...": the approval card can switch the permission mode in the same click.
      if (decision !== "deny" && permissionModes.includes(msg.mode) && !(remote && remoteBlockedMode(msg.mode)) && request.tool !== "ExitPlanMode") {
        changePermissionMode(msg.mode, (text) => ws.send(JSON.stringify({ type: "notice", text })));
      }
      if (request.tool === "ExitPlanMode" && decision !== "deny") {
        // The approved plan ends plan mode inside Claude Code; keep the selector truthful.
        permissionMode = "manual";
        broadcast(modeInfo());
      }
    } else if (msg.type === "mode" && (msg.mode === "chat" || msg.mode === "work")) {
      // A phone may name the folder (it must exist; home and `/` are still refused). The system dialog stays on the computer (`pick-folder`).
      await switchMode(msg.mode, msg.projectDir, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "install-brain" && msg.brain === "opencode" && (msg.choice === "yes" || msg.choice === "stop")) {
      // It fetches and runs a program, so it is a decision for the person at the computer, never a phone.
      if (remote) return ws.send(JSON.stringify({ type: "notice", text: remoteRefusal }));
      if (msg.choice === "stop") installAbort?.abort();
      else await installOpencodeFor((text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "pick-folder") {
      if (remote) return ws.send(JSON.stringify({ type: "notice", text: remoteRefusal }));
      await chooseFolder((text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "rename" && typeof msg.name === "string") {
      await rename(msg.name, (text) => ws.send(JSON.stringify({ type: "notice", text })));
      ws.send(JSON.stringify(modeInfo())); // puts the old name back in a box whose edit was refused
    } else if (msg.type === "stop") {
      stopWork((text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "effort" && (msg.value === "default" || isEffort(msg.value))) {
      await changeEffort(msg.value, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "claude-setup" && typeof msg.value === "boolean") {
      if (remote && msg.value) return ws.send(JSON.stringify({ type: "notice", text: remoteRefusal }));
      changeClaudeSetup(msg.value, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "claude-chrome" && typeof msg.value === "boolean") {
      if (remote && msg.value) {
        ws.send(JSON.stringify({ type: "notice", text: remoteRefusal }));
        ws.send(JSON.stringify(modeInfo())); // the checkbox snaps back; turning it on stays on the computer
        return;
      }
      changeClaudeChrome(msg.value, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "permission-mode" && permissionModes.includes(msg.value)) {
      if (remote && remoteBlockedMode(msg.value)) return ws.send(JSON.stringify({ type: "notice", text: remoteRefusal }));
      changePermissionMode(msg.value, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (msg.type === "provider" && (msg.provider === "claude" || msg.provider === "ollama" || msg.provider === "cursor" || msg.provider === "opencode")) {
      const notice = (text: string) => ws.send(JSON.stringify({ type: "notice", text }));
      if (provider.busy) return notice("Wait for her to finish the current reply first.");
      const program = brainProgram(msg.provider);
      if (program && !isInstalled(program)) {
        const offer = msg.provider === "opencode" && !remote ? opencodeOffer() : null;
        if (offer) {
          ws.send(JSON.stringify(offer));
          return notice(`opencode is not installed, so she stays on ${provider.name}. I can install it for you: answer the question below.`);
        }
        return notice(`${programLabel(msg.provider)} is not installed or not on PATH, so she stays on ${provider.name}.`);
      }
      if (msg.provider === "ollama") {
        await refreshOllamaModels();
        const chosen = typeof msg.model === "string" && msg.model ? msg.model : (settings.ollamaModel ?? ollamaModels?.[0]);
        if (!chosen) {
          return notice(
            ollamaModels === null
              ? `Could not reach Ollama at ${ollamaHost}. Start it with: ollama serve`
              : "Ollama has no models yet. Pull one, for example: ollama pull llama3.2",
          );
        }
        settings.ollamaModel = chosen;
        mode = "chat"; // work mode is offered again once Ollama says this model takes tool calls (checked below)
      }
      if (msg.provider === "cursor" && typeof msg.model === "string" && msg.model) settings.cursorModel = msg.model;
      if (msg.provider === "opencode" && typeof msg.model === "string" && msg.model) settings.opencodeModel = msg.model;
      if (msg.provider !== "claude" && (permissionMode === "auto" || permissionMode === "acceptEdits")) permissionMode = "manual";
      if (msg.provider !== "cursor" && msg.provider !== "opencode" && permissionMode === "everything") permissionMode = "manual";
      const switching = settings.provider !== msg.provider || basicMode;
      basicMode = false;
      settings.provider = msg.provider;
      // Cursor's CLI already runs without asking: match it when she is switched onto Cursor, and say so once.
      if (switching && settings.provider === "cursor" && cursorApprovalMode() === "unrestricted") {
        permissionMode = "everything";
        cursorEverythingNotice = CURSOR_EVERYTHING_NOTICE;
        broadcast({ type: "notice", text: CURSOR_EVERYTHING_NOTICE });
      } else if (settings.provider !== "cursor") cursorEverythingNotice = null;
      await saveSettings(settingsPath, settings);
      if (switching) {
        queue.drop();
        provider.close();
        provider = providers[settings.provider];
        provider.reset(); // a new brain does not share the other one's memory
        forgetConversationSize();
        transcript.clear();
        persistTranscript();
        renewNotes();
        pendingPermissions.clear();
        broadcast({ type: "reset" });
        broadcast(backgroundMessage());
        cards.greet();
        greetInstalled();
      }
      provider.configure(sessionConfig());
      if (settings.provider === "ollama") await ollamaBrain.checkTools(); // waited for, so the page hears the new model's answer once, not "no tools" first
      if (provider instanceof CursorProvider || provider instanceof OpenCodeProvider) {
        const label = provider instanceof CursorProvider ? "Cursor" : "opencode";
        try {
          await provider.whenReady();
          await rememberAcpModel();
        } catch (err) {
          notice(err instanceof Error ? err.message : String(err));
        }
        if (provider.replacedSession) {
          provider.replacedSession = false;
          notice(`Could not resume that ${label} session, so this is a new conversation.`);
        }
      }
      broadcast(modeInfo());
    } else if (msg.type === "reset") {
      resetConversation();
    } else if (msg.type === "look-undo") {
      if (await avatar.undo()) {
        notes.push("The user undid your last look change from the menu.");
        transcript.look(["undid the last change"]);
        broadcast({ type: "avatar", version: avatar.version, applied: ["undid the last change"] });
      }
      broadcast(looksInfo());
    } else if (msg.type === "look-save" && typeof msg.name === "string") {
      const saved = await avatar.saveLook(msg.name);
      if (!saved) ws.send(JSON.stringify({ type: "notice", text: "Please give the look a name." }));
      else ws.send(JSON.stringify({ type: "notice", text: `Saved this look as "${saved}".` }));
      broadcast(looksInfo());
    } else if (msg.type === "look-load" && typeof msg.name === "string") {
      if (await avatar.loadLook(msg.name)) {
        if (settings.framePack) await choosePack(null, () => {}); // a drawn look was picked: show it
        notes.push(`The user switched your look to their saved look '${msg.name}' from the menu.`);
        transcript.look([`load=${msg.name}`]);
        broadcast({ type: "avatar", version: avatar.version, applied: [`load=${msg.name}`] });
      }
      broadcast(looksInfo());
    } else if (msg.type === "client-error") {
      // The page reporting a problem of its own: into the log, so it can be read here (rate limited).
      const line = pageErrorLimit() ? formatClientError(msg, remote ? "a phone" : "this computer") : null;
      if (line) console.error(line);
    } else if (msg.type === "lan-answer") {
      // The answer to the question /phone asked: only from this computer, never from a phone, and only while that question is open.
      if (remote || !lanAsked) return;
      lanAsked = false;
      const say: Say = (text) => ws.send(JSON.stringify({ type: "notice", text }));
      if (msg.yes !== true) return say("Phone access stays off.");
      const failed = await setLan(true);
      if (failed) return say(failed);
      const links = phoneLinks(port, lanToken);
      ws.send(JSON.stringify({ type: "phone", links, qr: qrRows(links[0]) }));
    } else if (msg.type === "look-refresh-answer") {
      const preset = avatar.refreshOffer?.preset;
      if (preset && (await avatar.answerRefresh(msg.yes === true))) {
        if (settings.framePack) await choosePack(null, () => {}); // a drawn look was chosen: show it
        transcript.look([`base=${preset}`]);
        notes.push(`The creator was updated and the user reloaded your drawn look from the '${preset}' preset.`);
        broadcast({ type: "avatar", version: avatar.version, applied: [`base=${preset}`] });
      }
      broadcast(looksInfo());
    } else if (msg.type === "activity-end") {
      endActivityByUser(); // ending is harmless, so a phone may do it too
    } else if (msg.type === "pack-select" && (msg.name === null || typeof msg.name === "string")) {
      await choosePack(msg.name, (text) => ws.send(JSON.stringify({ type: "notice", text })));
    } else if (typeof msg.type === "string" && msg.type.startsWith("studio-")) {
      await studio.message(msg, (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)), remoteSockets.has(ws));
    } else if (msg.type === "pack-catalog") {
      // The gallery is opening: ask the index so a pack that is not installed can still be shown and downloaded.
      await refreshPackIndex(false);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(await packsMessage()));
    } else if (msg.type === "pack-install" && typeof msg.name === "string") {
      const id = msg.name;
      const before = await packInstaller.installed(id); // set when this is an update of a pack from the list, not a first download
      const wasShown = settings.framePack === id;
      const installed = await packInstaller.install(id, (event) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "pack-progress", ...event }));
      });
      if (!installed.ok) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "pack-progress", id, phase: "error", message: installed.reason }));
          ws.send(JSON.stringify({ type: "notice", text: installed.reason }));
        }
      } else {
        const say: Say = (text) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "notice", text }));
        };
        const now = before && installed.status === "installed" ? await packInstaller.installed(id) : null;
        if (now) say(`Updated ${id} to version ${now.version}.`);
        if (now && !wasShown) {
          // An update of a pack that is not the one on screen: the files are replaced, and what she is showing stays as it is.
          broadcast(await packsMessage());
        } else {
          if (now) notes.push("Your pictures were just replaced by a newer version of this pack.");
          await choosePack(id, say);
        }
      }
    } else if (msg.type === "preset-thumbs") {
      try {
        ws.send(JSON.stringify({ type: "preset-thumbs", svgs: await avatar.presetThumbnails() }));
      } catch (err) {
        console.error("preset thumbnails failed:", err);
      }
    } else if (msg.type === "look-preset" && typeof msg.name === "string") {
      if (await avatar.loadPreset(msg.name)) {
        if (settings.framePack) await choosePack(null, () => {}); // a drawn look was picked: show it
        transcript.look([`base=${msg.name}`]);
        notes.push(`The user switched your look to the '${msg.name}' preset from the menu.`);
        broadcast({ type: "avatar", version: avatar.version, applied: [`base=${msg.name}`] });
      }
      broadcast(looksInfo());
    } else if (msg.type === "look-delete" && typeof msg.name === "string") {
      await avatar.deleteLook(msg.name);
      broadcast(looksInfo());
    } else if (msg.type === "reset-look") {
      await avatar.resetLook();
      if (settings.framePack) await choosePack(null, () => {}); // the original look is a drawn one: show it
      notes.push("The user reset your look to the original one from the menu.");
      transcript.look(["back to the original look"]);
      broadcast({ type: "avatar", version: avatar.version, applied: ["back to the original look"] });
      broadcast(looksInfo());
    } else if (msg.type === "gesture-frames" && typeof msg.emotion === "string" && typeof msg.gesture === "string") {
      try {
        const version = avatar.version;
        const svgs = await avatar.gestureFrames(msg.emotion, msg.gesture);
        const view = gestureView(avatar.character, msg.gesture);
        if (svgs) ws.send(JSON.stringify({ type: "gesture-frames", version, emotion: msg.emotion, gesture: msg.gesture, svgs, ...(view ? { view } : {}) }));
      } catch (err) {
        console.error("gesture frames failed:", err);
      }
    } else if (msg.type === "frames" && typeof msg.emotion === "string") {
      try {
        const version = avatar.version;
        const svgs = await avatar.frames(msg.emotion);
        ws.send(JSON.stringify({ type: "frames", version, emotion: msg.emotion, svgs }));
      } catch (err) {
        console.error("frames failed:", err);
      }
    }
  });
});

async function rememberAcpModel(): Promise<void> {
  const acp = acpBrain();
  if (!acp?.modelId) return;
  const key = settings.provider === "opencode" ? "opencodeModel" : "cursorModel";
  if (acp.modelId === settings[key]) return;
  settings[key] = acp.modelId;
  await saveSettings(settingsPath, settings);
}

if (provider instanceof CursorProvider || provider instanceof OpenCodeProvider) {
  const label = provider instanceof CursorProvider ? "cursor" : "opencode";
  void provider
    .whenReady()
    .then(() => rememberAcpModel().then(() => broadcast(modeInfo())))
    .catch((err) => {
      console.error(`[${label}] ${err instanceof Error ? err.message : err}`);
    });
}

server.listen(port, bindHost, () => {
  console.log(`Companion ready: http://${host}:${port}  (${provider.name})`);
  if (lan) console.log(`Phone access is on. Open one of these on the phone (it is a password, keep it to yourself):\n  ${phoneLinks(port, lanToken).join("\n  ")}`);
  if (process.argv.includes("--open")) openBrowser(`http://${host}:${port}`);
  void shareNudge(
    [
      { name: "anime_ai_companion", dir: root, url: "https://github.com/rhedak/anime_ai_companion" },
      { name: "anime-character-creator", dir: resolve(creatorSrc, "../.."), url: "https://github.com/rhedak/anime-character-creator" },
    ],
    join(dataDir, "nudge.json"),
  );
});

function openBrowser(url: string): void {
  const [cmd, ...args] =
    process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
}

const shutdown = () => {
  provider.close();
  avatar.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
