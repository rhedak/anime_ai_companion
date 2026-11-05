import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Worker } from "node:worker_threads";
import type { Mode } from "./providers/types.ts";
import { isPackName } from "./frame-pack.ts";
import { addPicture, applyEdit, readEdits, restoreOriginal } from "./pack-edits.ts";
import { ACTIVITY_NAME, addFrame, clearTalk, createDraft, deleteDraft, frameName, framePath, isDraftId, isFileId, listDrafts, readDraft, removeFrame, setTalk, talkByModel, talkByScript, writeDraft, type ActivityDraft } from "./studio/activity.ts";
import type { Broadcast, Say } from "./server-types.ts";
import { HANDOVER_GUIDE, handoverPrompt } from "./studio/handover.ts";
import { ASSISTED, BackendError, DEFAULT_LOCAL_BACKEND, LOCAL_MODEL_GUIDE, checkBackendUrl, hasKey, keyName, keyNamesFor, makeBackend, BROWSER_BACKENDS, CHATGPT_WEB, GEMINI_WEB, PAID_SERVICES, type BackendInfo, type ImageBackend } from "./studio/backend.ts";
import { knownFrameNames, readRecords } from "./studio/build.ts";
import { processText } from "./studio/process.ts";
import { pickKey } from "./studio/cutout.ts";
import { prepareUpload } from "./studio/upload.ts";
import { cleanText, MAX_LOOK, MAX_OUTFIT, parseJob, type Job } from "./studio/job.ts";
import { decode, encodePng, flatten } from "./studio/raster.ts";
import { assistFolder, type AssistRequest } from "./studio/assisted.ts";
import { MAX_IMAGE_BYTES, sniffImageType, type ImageInput } from "./images.ts";
import type { StudioEvent } from "./studio/runner.ts";
import { findStudioTags, usableName, type StudioProposal } from "./studio/tags.ts";
import { commandText, isDevice, LocalServer, type Device, type LocalStatus } from "./studio/local-server.ts";
import { exportPack, importPack } from "./studio/transfer.ts";
import { drawFrame, editText, FRAME_NAME, thumbnail } from "./studio/frame-edit.ts";
import { checkPath } from "./settings.ts";
import { detectLocalImageModels, hubCacheDir } from "./studio/local-models.ts";
import type { Flags } from "./studio/checks.ts";
import { encodeWebp, type Raster } from "./studio/raster.ts";
import type { KeyName } from "./studio/cutout.ts";

/** The pictures of a source pack the studio reads: its rest picture, and its blink and mouth pictures to learn where her face is. */
/** A new character's id and name from what the user typed: the id is the name in lower case with dashes, and never a folder name the app uses. Null when nothing usable is left. */
export function characterFrom(value: unknown): { id: string; name: string } | null {
  const name = cleanText(value, 40);
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || id === "thumbs" || id === "characters") return null;
  return { id, name };
}

export interface SourceFrames {
  neutral: Buffer;
  blink?: Buffer;
  talk: (Buffer | undefined)[];
  /** The `character:` of its look.txt. */
  character: string | null;
}

/** What the pack studio needs from the server around it. */
export interface StudioDeps {
  /** Sends one message to the chat brain with one picture attached (the brain's reply comes back as `[studio step="…"]` suggestions). */
  askBrain?: (text: string, image?: ImageInput) => void;
  /** Switches to chat mode the way /chat does (the server's own switch, so the same checks apply). True when it is in chat mode afterwards. */
  switchToChat?: () => Promise<boolean>;
  /** True when the brain that is selected can see pictures (the same test as the chat's attach button). */
  canSeePictures?: () => boolean;
  /** data/ */
  dataDir: string;
  /** data/frames: where a finished pack is installed. */
  framesDir: string;
  settings: { studioBackend: string | null; studioBudgetUsd?: number; studioLocalBackend?: string | null; studioPython?: string | null; studioServer?: string | null };
  saveSettings(): Promise<void>;
  broadcast: Broadcast;
  remoteRefusal(): string;
  /** The packs a new one can be drawn from (all of them, shipped and installed). */
  sources(): Promise<string[]>;
  /** Which character each of those packs belongs to ({ pack folder: { id, name } }), so the page can group outfits under their character. Optional: without it every pack stands alone. */
  characters?(names: string[]): Promise<Record<string, { id: string; name: string }>>;
  readSource(name: string): Promise<SourceFrames | null>;
  /** Whether a character of this id already exists (shipped or the user's own): a new character must not take its place. Optional: without it only the user's own folder is checked. */
  characterExists?(id: string): Promise<boolean>;
  /** The pack she is wearing now, or null (the drawn avatar): a new outfit is drawn from it unless the user picks another. */
  activeSource(): string | null;
  /** While she is drawn: the pack of her own character to start from, if it is on this computer. */
  drawnSource?(): string | null;
  /** Tell the page about the packs again (a new one is there). */
  refreshPacks(): Promise<void>;
  /** A picture of the pack she wears was changed on disk: show the pack again (the page keeps the pictures it has loaded). Optional. */
  reloadPack?(name: string): Promise<void>;
  /** Something to tell her with her next message. */
  pushNote(text: string): void;
  /** Chat or work: the brain's proposals are for chat only (in work mode a file she reads could talk her into one). */
  mode(): Mode;
  /** The folder of an installed pack (its pictures and its text files), or null. It is only read: a new pack is made from a copy. */
  packFolder(name: string): Promise<string | null>;
  /** The brain in use ("claude", "cursor", …): the browser makers need Claude in Chrome, which only Claude Code has. */
  brain?(): string;
  /** Claude in Chrome is on (`/chrome on`, work mode): the browser makers can drive the user's Chrome. */
  chromeOn?(): boolean;
  /** Tests give a stand-in for the environment; the app reads its own. */
  env?: NodeJS.ProcessEnv;
  /** The Hugging Face cache to look for image models in (tests give a folder of their own). */
  hubDir?: string;
  /** Tests give a stand-in; the app builds the HTTP client. */
  makeBackend?: (url: string) => ImageBackend;
  workerUrl?: URL;
}

type Send = (msg: unknown) => void;
type Review = { tiles: { name: string; thumb: string | null; flagged: boolean; flags: string[]; variant?: "pasted" | "whole"; alt?: string | null; altVariant?: "pasted" | "whole"; altFlags?: string[] }[]; flagged: { name: string; flags: string[] }[]; pasteAvailable?: boolean };

interface Pending {
  job: Job;
  source: SourceFrames;
  info: BackendInfo;
}

interface Running {
  job: Job;
  dir: string;
  worker: Worker;
  phase: "base" | "build" | "assemble" | "step";
  info: BackendInfo;
}

/** A job that waits for the user: to pick one of the base pictures, or to look at the pack and say yes. */
interface Waiting {
  kind: "pick" | "review";
  job: Job;
  dir: string;
  info: BackendInfo;
  candidates: number[];
  review: Review | null;
}

/**
 * The edit chain on a base the user has not approved yet: the picture the next step changes, the steps drawn so far (each with its
 * pictures), what she suggested, and the steps before the current one (for undo). Nothing here reaches the pack until the base is approved.
 */
interface Chain {
  jobId: string;
  current: string;
  currentThumb: string | null;
  /** Before each kept picture: the base it replaced, and what that step had kept before (for undo). */
  history: { file: string; thumb: string | null; n: number; kept: number | null }[];
  steps: { n: number; change: string; kept: number | null; candidates: { seed: number; file: string; thumb: string | null }[] }[];
  suggestions: string[];
}

/** A seed the user typed or the page sent: a whole number the image makers take. Null for anything else. */
function validSeed(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 2 ** 31 - 1 ? n : null;
}

/** What she is told about the studio (src/studio/skill.md). Read once; the app runs from a folder that has it. */
const SKILL = (() => {
  try {
    return readFileSync(new URL("./studio/skill.md", import.meta.url), "utf8");
  } catch {
    return "";
  }
})();

/** What the user is told before anything is drawn, and again with the result. */
export const RESPONSIBILITY =
  "You are responsible for what is drawn and for which image model you use. The app adds no filter of its own, and the model's own terms apply to every picture.";

/**
 * The pack studio: pictures of a character in a new outfit, made on this computer by an image model the user runs (docs/pack-studio.md).
 *
 * It is a draft maker with an off switch. Off at every start, refused from a phone, one job at a time, and nothing is drawn before the user has
 * read a card that names the backend, the model and the folder. The brain has no part in it yet; the page's form is the only way in.
 *
 * A job goes: question, base pictures (the user picks one), the rest of the pack (checked, retried), review (the user may have a picture made
 * again), install. The steps run in a worker thread (src/studio/); this file is the state machine around them.
 */
export function createStudioService(deps: StudioDeps) {
  let on = false;
  let pending: Pending | null = null;
  let running: Running | null = null;
  let waiting: Waiting | null = null;
  let chain: Chain | null = null;
  let pendingReference: Buffer | null = null;
  /** What the page would need to show a job again after a reload: the last thing said, and the candidate pictures so far. */
  let lastText = "";
  const shown = new Map<number, string>();
  /** The pictures of the pack drawn so far (the ones the review shows), so they can be looked at while the rest are still being drawn. */
  const previews = new Map<string, { thumb: string | null; flagged: boolean; flags: string[] }>();
  /** Has she been told about the studio in this conversation? */
  let told: "on" | "off" | null = null;
  /** What she last proposed for the form (or for a redraw), so a page that connects or reloads can show it. */
  let proposal: (StudioProposal & { id: string }) | null = null;
  /** The packs a new one can be drawn from, as of the last time the page asked: she is told them. */
  let knownSources: string[] = [];
  const disabled = process.env.COMPANION_NO_STUDIO === "1";
  const budget = () => deps.settings.studioBudgetUsd ?? 5;
  const isLocal = (url: string | null): url is string => Boolean(url) && !PAID_SERVICES.includes(url as string) && !BROWSER_BACKENDS.includes(url as string) && url !== ASSISTED;
  /** Chooses the backend, and keeps the last address of a model on this computer so the list can go back to it. */
  const setBackend = (url: string): void => {
    if (isLocal(deps.settings.studioBackend)) deps.settings.studioLocalBackend = deps.settings.studioBackend;
    if (isLocal(url)) deps.settings.studioLocalBackend = url;
    deps.settings.studioBackend = url;
  };
  /** The choices of the page's "Image maker" list. The local entry is always there: the saved address, or the reference server's. Choosing it without a model running only shows how to set one up (`localHelp`). */
  const backendChoices = (): { value: string; label: string; kind: "local" | "paid" | "browser" | "assisted"; cost: "free" | "per-picture" | "allowance"; keyNames: string[] }[] => {
    const saved = deps.settings.studioBackend;
    const local = (saved && !PAID_SERVICES.includes(saved) && !BROWSER_BACKENDS.includes(saved) && saved !== ASSISTED ? saved : deps.settings.studioLocalBackend) ?? DEFAULT_LOCAL_BACKEND;
    return [
      { value: local, label: `A model on this computer (${local})`, kind: "local" as const, cost: "free" as const, keyNames: [] },
      { value: "xai", label: "xAI Grok Imagine API (paid per picture, XAI_API_KEY)", kind: "paid" as const, cost: "per-picture" as const, keyNames: keyNamesFor("xai") },
      { value: "gemini", label: "Google Gemini API (paid per picture, GEMINI_API_KEY)", kind: "paid" as const, cost: "per-picture" as const, keyNames: keyNamesFor("gemini") },
      { value: "openai", label: "OpenAI API (paid per picture, OPENAI_API_KEY)", kind: "paid" as const, cost: "per-picture" as const, keyNames: keyNamesFor("openai") },
      { value: "grok-web", label: "Grok Imagine website through your Chrome (uses Claude and your Grok allowance)", kind: "browser" as const, cost: "allowance" as const, keyNames: [] },
      { value: "gemini-web", label: "Google Gemini website through your Chrome (uses Claude and your Gemini allowance)", kind: "browser" as const, cost: "allowance" as const, keyNames: [] },
      { value: "chatgpt-web", label: "ChatGPT website through your Chrome (uses Claude and your ChatGPT allowance)", kind: "browser" as const, cost: "allowance" as const, keyNames: [] },
      { value: ASSISTED, label: "By hand: you draw each picture on any website or tool you like (free, slow, any brain)", kind: "assisted" as const, cost: "free" as const, keyNames: [] },
    ];
  };
  /** What the open job has cost so far (a paid backend only), also kept in the job's folder so a carried-on job keeps counting. */
  let spent = 0;
  const readSpend = async (dir: string): Promise<number> => {
    const n = Number(JSON.parse(await readFile(join(dir, "spend.json"), "utf8").catch(() => "{}")).usd);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const dollars = (n: number) => `$${n.toFixed(2)}`;
  /** After the base pictures of a paid backend: what the rest will cost, from what those cost. */
  const paidProjection = (usd: number, calls: number): string => {
    const more = knownFrameNames().size;
    const each = calls > 0 ? usd / calls : 0;
    return (
      `The ${calls} pictures cost ${dollars(usd)}. Picking one draws about ${more} more (about ${dollars(more * each)} if each passes at the first try, up to ${dollars(3 * more * each)} if each needs three tries). ` +
      `It stops at your limit of ${dollars(budget())} for this pack; every draw is paid.` +
      (more * each > budget() ? ` That limit is lower than the likely cost of the whole pack: raise it with /studio budget <dollars>, or the job will stop part way.` : "")
    );
  };
  /** The warning before the browser is driven: not a bill, but Claude's allowance, the site's, the user's time and their real account. */
  const browserNote = (info: BackendInfo): string =>
    `THIS DRIVES YOUR CHROME. For every picture the app starts Claude Code with the Claude in Chrome extension, which opens ${info.browser?.site} in your browser, signed in as you, uploads the picture and your words, and downloads the result. ` +
    `It is not charged per picture, but it uses your Claude allowance (every step and screenshot) and the site's own allowance on your account, and it is slow: minutes a picture, an hour or more for a whole pack. ` +
    `Stay at the computer while it runs: you can stop it at any moment, and when the site asks for a login, a captcha, a payment or anything else the job stops and says so. Your source pictures and your words go to that site. ` +
    `Automating a website may be against its terms and could put your account at risk: that, and what is drawn, is your responsibility. ` +
    `You approve once for the whole pack instead of for every click: until it is done, that Claude process may use your Chrome through the extension (and has no other tool).`;
  /** What the by-hand maker asks of the user: nothing is sent by the app, but each picture waits for them. */
  const assistedNote = (pictures: number | null): string =>
    `BY HAND. For every picture the app shows you the picture and the words; you draw it with any website or tool you like (Grok, Gemini, ChatGPT, a program of your own) and give the result back by dropping or pasting it into the panel. ` +
    `This app sends nothing anywhere and uses no allowance; what you give a site, and its terms, are between you and that site. ` +
    (pictures === null ? `` : `A whole pack is about ${knownFrameNames().size + pictures} pictures one after the other, each at your pace, and a picture that fails a check is not drawn again by itself: it is flagged in the review for you to redo. For a few pictures, or one to try a look, it is the cheapest way; for a whole pack, a model on this computer or an API is easier. `) +
    `Stop the job at any moment: it waits for you, with no time limit.`;
  /** The warning before anything is paid for. */
  const paidNote = (info: BackendInfo, pictures: number): string =>
    `THIS IS PAID. It sends your source pictures and your words to ${info.paid?.host} (${info.model}), which charges for every picture, retries and "Draw again" included, to the account of the API key in this app's environment (${info.paid?.keyName}). ` +
    `Making ${pictures} pictures is the first step; the rest of the pack (about ${knownFrameNames().size} more, up to three tries each) comes after you pick one, and you are shown what the first step cost before that. ` +
    `The app stops at ${dollars(budget())} for this pack (/studio budget changes it). Keeping the key safe, and what it costs you, is your responsibility: the app never saves it, shows it or sends it anywhere but that host.`
  /** `dir` is where a browser maker keeps the picture it uploads (a job's folder); the others have no use for it. */
  const backendFor = (url: string, dir?: string, assistId?: string): ImageBackend =>
    url === ASSISTED
      ? makeBackend(url, { limitUsd: 0, spentUsd: 0, dir, onAssist: (request) => void offerAssist(assistId ?? "assist", dir ?? ".", request) })
      : deps.makeBackend ? deps.makeBackend(url) : makeBackend(url, { limitUsd: budget(), spentUsd: 0, dir });

  /**
   * The by-hand maker is waiting for the user to give picture `n` back. What the page needs to show it again after a reload is kept here; the answer goes
   * into the picture's `assist/` folder (`assistResult`), which is what the maker polls. One at a time: the job draws one picture at a time.
   */
  let assist: { id: string; dir: string; n: number; prompt: string; input: string | null; error: string | null } | null = null;
  const assistMessage = () =>
    assist
      ? { type: "studio-assist", id: assist.id, n: assist.n, prompt: assist.prompt, input: assist.input, error: assist.error, folder: assistFolder(assist.dir), text: lastText }
      : { type: "studio-assist-done" };
  async function offerAssist(id: string, dir: string, request: AssistRequest): Promise<void> {
    const png = await readFile(join(assistFolder(dir), `${request.n}-in.png`)).catch(() => null);
    assist = { id, dir, n: request.n, prompt: request.prompt, input: png ? `data:image/png;base64,${png.toString("base64")}` : null, error: request.error ?? null };
    deps.broadcast(assistMessage());
  }
  function clearAssist(): void {
    if (!assist) return;
    assist = null;
    deps.broadcast({ type: "studio-assist-done" });
  }
  /** The picture the user gives back: checked to be a picture, written as the answer the maker is polling for. A bad one is said at once and asked for again. */
  async function assistResult(msg: Record<string, unknown>): Promise<void> {
    const open = assist;
    if (!open || msg.id !== open.id || msg.n !== open.n) return void deps.broadcast({ type: "studio-assist-done" });
    const again = (error: string) => {
      open.error = error;
      deps.broadcast(assistMessage());
    };
    const raw = typeof msg.image === "string" ? msg.image.replace(/^data:[^,]*,/, "") : "";
    const bytes = Buffer.from(raw, "base64");
    if (bytes.length === 0) return again("That was empty. Drop or paste the picture.");
    if (bytes.length > MAX_IMAGE_BYTES) return again(`That picture is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB. Save it smaller (PNG, JPEG or WebP) and give it again.`);
    if (!sniffImageType(bytes)) return again("That is not a PNG, JPEG, WebP or GIF picture.");
    try {
      await writeFile(join(assistFolder(open.dir), `${open.n}-out.png`), await encodePng(await decode(bytes)));
    } catch {
      return again("The app could not read that picture. Save it as PNG, JPEG or WebP and give it again.");
    }
    clearAssist();
  }

  /** A local model's answer to its /health, kept for a few seconds so the page can ask often without a request each time. */
  const localHealth = new Map<string, { at: number; ok: boolean }>();
  /**
   * Whether a maker can be used on this computer right now, and why not if it cannot. Checked when the page asks, never drawn with:
   * a local model is asked for its /health (a short wait on loopback), a paid service needs its key in the environment (the value is never read out),
   * a browser maker needs Claude as the brain and Claude in Chrome on. Handover needs nothing: it is always there.
   */
  /** The address of the user's own model server: the chosen one when it is local, else the last one used, else the default. */
  const localAddress = (): string => (isLocal(deps.settings.studioBackend) ? deps.settings.studioBackend : null) ?? deps.settings.studioLocalBackend ?? DEFAULT_LOCAL_BACKEND;
  /** Why a model on this computer does not answer: and, when its weights are on this computer, which ones, so the user knows what to start. */
  async function notAnswering(): Promise<string> {
    const found = await detectLocalImageModels(deps.hubDir ?? hubCacheDir(deps.env ?? process.env));
    // With the user's own Python and server script set (/studio python, /studio server), say the exact command to start it (nothing is run from here).
    const { studioPython: python, studioServer: server } = deps.settings;
    const start = python && server ? `; start it with: ${startCommand(python, server, localAddress())}` : "";
    if (found.length === 0) return `no model answers at that address${start}`;
    return `no model answers at that address; on this computer: ${found.map((m) => m.label).join(", ")} (start its backend, see the guide)${start}`;
  }

  async function makerAvailability(choice: { value: string; kind: "local" | "paid" | "browser" | "assisted" }): Promise<{ available: boolean; reason: string | null }> {
    if (choice.kind === "assisted") return { available: true, reason: null };
    if (choice.kind === "paid") {
      return hasKey(choice.value, deps.env ?? process.env) ? { available: true, reason: null } : { available: false, reason: `set ${keyName(choice.value)} in this app's environment` };
    }
    if (choice.kind === "browser") {
      if ((deps.brain?.() ?? "claude") !== "claude") return { available: false, reason: "needs Claude as the brain" };
      if (!deps.chromeOn?.()) return { available: false, reason: "turn on /chrome (Claude in Chrome)" };
      return { available: true, reason: null };
    }
    // The model is busy with this app's own picture: a server that draws one at a time may be slow to answer, which is not "not answering".
    if (running || frameBusy) return { available: true, reason: null };
    const at = localHealth.get(choice.value);
    if (at && Date.now() - at.at < 5000) return at.ok ? { available: true, reason: null } : { available: false, reason: await notAnswering() };
    const ok = await Promise.resolve()
      .then(() => fetch(new URL("/health", choice.value), { signal: AbortSignal.timeout(800) }))
      .then((r) => r.ok)
      .catch(() => false); // a saved address that is not a URL at all is simply not answering
    localHealth.set(choice.value, { at: Date.now(), ok });
    return ok ? { available: true, reason: null } : { available: false, reason: await notAnswering() };
  }

  async function stateMessage() {
    const job = running?.job ?? waiting?.job ?? null;
    const backends = await Promise.all(
      backendChoices().map(async (choice) => ({ ...choice, ...(await makerAvailability(choice)) })),
    );
    return {
      type: "studio-state",
      on,
      backend: deps.settings.studioBackend,
      /** What the page may offer in its "Image maker" list: the local server (its saved address, if any) and each web service, with what it costs the user, and whether it can be used now (`available`, and why not in `reason`). */
      backends,
      /** Handover needs nothing from this computer: a prompt to copy into any AI agent. */
      handover: true,
      /** How many pictures a full pack has, the neutral one (the base, not in knownFrameNames) included (the form says what they are). */
      packSize: knownFrameNames().size + 1,
      sources: on ? (knownSources = await deps.sources()) : [],
      /** Which character each pack is an outfit of, for the picker's character, then outfit, steps. */
      characters: on && deps.characters ? await deps.characters(knownSources) : {},
      /** The pack the form starts from. */
      active: deps.activeSource() ?? deps.drawnSource?.() ?? null,
      running: running ? { id: running.job.id, name: running.job.name, phase: running.phase } : null,
      /** A job the page should be showing: drawing, waiting for the pick, or waiting for the review. */
      job: job ? { id: job.id, picking: waiting?.kind === "pick", reviewing: waiting?.kind === "review", text: lastText } : null,
      /** What a paid backend has cost this job, and the limit. */
      spend: job && (running?.info ?? waiting?.info)?.paid ? { usd: spent, limit: budget() } : null,
      candidates: job && (running?.phase === "base" || waiting?.kind === "pick") ? [...shown].map(([seed, thumb]) => ({ seed, thumb })) : [],
      /** Whether the chat is in chat mode (polishing switches it first, and the page says so). */
      chatMode: deps.mode() === "chat",
      /** Whether the brain that is selected can see pictures (the polish button asks before it sends the reference). */
      brainSeesPictures: on && (deps.canSeePictures?.() ?? false),
      /** The edit chain on the base, while the base waits for the user: the current picture, the steps, her suggestions, and whether the brain can be asked. */
      chain: chain && job && job.id === chain.jobId && (waiting?.kind === "pick" || running?.phase === "step") ? { current: chain.currentThumb, steps: chain.steps.map((step) => ({ n: step.n, change: step.change, kept: step.kept, candidates: step.candidates.map((c) => ({ seed: c.seed, thumb: c.thumb })) })), suggestions: chain.suggestions, canAsk: on && (deps.canSeePictures?.() ?? false) } : null,
      review: waiting?.kind === "review" ? waiting.review : null,
      previews: running && running.phase !== "base" ? [...previews].map(([name, v]) => ({ name, ...v })) : [],
      resumable: on && !job && !pending ? await findJobs() : [],
      /** The pictures of each pack, for "Draw one picture again" (only while the studio is on). */
      frames: on ? Object.fromEntries(await Promise.all(knownSources.map(async (s) => [s, await framesOf(s)]))) : {},
      /** Which pictures of each pack on this computer were drawn again in the pack itself (the page marks them, and offers the original back). */
      edited: on ? Object.fromEntries((await Promise.all(knownSources.map(async (s) => [s, Object.entries(await readEdits((await deps.packFolder(s)) ?? "")).filter(([, edit]) => !edit.added).map(([name]) => name)] as const))).filter(([, names]) => names.length)) : {},
      frameBusy,
      /** Activities begun and not yet saved into their pack (src/studio/activity.ts): the panel offers to carry them on. */
      activities: on ? (await listDrafts(join(deps.dataDir, "studio"))).map((d) => ({ id: d.id, source: d.source, name: d.name, frames: d.frames.length, talk: d.talk.length, updated: d.updated })) : [],
      /** The by-hand maker waits for a picture from the user (null otherwise). */
      assist: assist ? { ...assistMessage(), type: undefined } : null,
      frameReview: reviewMessage(),
      frameAsk: frameAskMessage(),
      proposal,
      /** The user's own local image server: the paths they gave, what it prints, and the card that asks before it starts. */
      local: { ...local.state, python: deps.settings.studioPython ?? null, server: deps.settings.studioServer ?? null, address: localAddress(), ask: localAsk },
    };
  }
  const announce = async () => deps.broadcast(await stateMessage());
  /** The user's own server, started from the panel after a card. Memory only: the app never starts it by itself. */
  let localStatus = "stopped" as LocalStatus;
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  // A line it prints must not make the app ask its /health again (that prints a line, and so on): the health answer is forgotten only when its status
  // changes, and the page hears about new lines at most four times a second.
  const local = new LocalServer(() => {
    if (local.state.status !== localStatus) {
      localStatus = local.state.status;
      localHealth.clear();
    }
    localTimer ??= setTimeout(() => {
      localTimer = null;
      void announce();
    }, 250);
  }, () => deps.env ?? process.env);
  let localAsk: { id: string; python: string; server: string; command: string; port: number; device: Device; hub: string } | null = null;

  /** The loopback port of the user's server address, or null when it is not one the app may start a server for. */
  function localPort(): number | null {
    try {
      const url = new URL(localAddress());
      return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ? Number(url.port || 80) : null;
    } catch {
      return null;
    }
  }

  /** The two paths from the page's boxes: the same checks as /studio python and /studio server. An empty box clears it. */
  async function localConfig(msg: Record<string, unknown>, send: Send): Promise<boolean> {
    for (const [field, key, what] of [["python", "studioPython", "Python"], ["server", "studioServer", "The server script"]] as const) {
      const text = typeof msg[field] === "string" ? (msg[field] as string).trim() : "";
      if (!text) deps.settings[key] = null;
      else {
        const path = checkPath(text);
        const refuse = (message: string) => {
          send({ type: "studio-error", message });
          return false;
        };
        if (!path) return refuse(`${what}: give the whole path, on one line, without quotes.`);
        if (!(await stat(path).then((s) => s.isFile(), () => false))) return refuse(`${what}: ${path} is not a file on this computer.`);
        deps.settings[key] = path;
      }
    }
    await deps.saveSettings();
    void announce();
    return true;
  }

  async function localStart(msg: Record<string, unknown>, send: Send): Promise<void> {
    const err = (message: string) => send({ type: "studio-error", message });
    // The page's paths come with the start (two messages sent together would be handled at the same time): they are saved first, with the same checks.
    if (typeof msg.python === "string" || typeof msg.server === "string") {
      if (!(await localConfig(msg, send))) return;
    }
    const { studioPython: python, studioServer: server } = deps.settings;
    if (!python || !server) return err("Give the Python and the server script first (the two boxes, or /studio python and /studio server).");
    for (const [what, path] of [["Python", python], ["The server script", server]] as const) if (!(await stat(path).then((s) => s.isFile(), () => false))) return err(`${what} is not a file any more: ${path}`);
    const port = localPort();
    if (!port) return err("The local image address has to be on this computer (127.0.0.1 or localhost) for the app to start a server for it.");
    const device = msg.device === undefined ? "mps" : msg.device;
    if (!isDevice(device)) return err("The device is mps, cuda or cpu.");
    if (local.state.status === "starting" || local.state.status === "running") return err("The local image server is already running. Stop it first.");
    if (await fetch(new URL("/health", localAddress()), { signal: AbortSignal.timeout(800) }).then((r) => r.ok, () => false)) return err(`Something already answers at ${localAddress()}: nothing was started.`);
    localAsk = { id: randomBytes(8).toString("hex"), python, server, command: commandText(python, server, port, device), port, device, hub: deps.hubDir ?? hubCacheDir(deps.env ?? process.env) };
    void announce();
  }

  async function localConfirm(id: string, send: Send): Promise<void> {
    const ask = localAsk;
    if (!ask || ask.id !== id) return;
    localAsk = null;
    try {
      await local.start(ask.python, ask.server, ask.port, ask.device, (signal) => fetch(new URL("/health", `http://127.0.0.1:${ask.port}`), { signal }).then((r) => r.ok, () => false));
    } catch (error) {
      send({ type: "studio-error", message: error instanceof Error ? error.message : String(error) });
    }
    void announce();
  }

  /** What a job found, in words for her: the checks that still failed after the retries. */
  function reportNote(job: Job, review: Review | null): string {
    const failed = review?.flagged ?? [];
    const found = failed.length ? `Checks that still failed after the retries: ${failed.map((f) => `${f.name}: ${f.flags.join("; ")}`).join(" | ")}.` : "Every picture passed every check.";
    return (
      `The pack studio finished drawing "${job.name}" (${job.outfit}) from the ${job.source} pack. ${found} The user is looking at the pack now. ` +
      `If they ask what you think, you may suggest pictures to draw again with [studio redraw="…"]; they press the button.`
    ).slice(0, 1800);
  }

  /**
   * A proposal from her reply, checked against this computer: what is not valid is left out, and nothing is started. With the studio off it
   * waits (and the user is told): `/studio on` then opens the form with her words in it.
   */
  async function propose(p: StudioProposal): Promise<void> {
    if (deps.mode() !== "chat" || disabled) return;
    const sources = await deps.sources();
    const valid: StudioProposal = {};
    const active = deps.activeSource() ?? deps.drawnSource?.() ?? null;
    // The pack to draw from: the one she named if it exists, else the one she is wearing.
    if (p.source && sources.includes(p.source)) valid.source = p.source;
    else if (active && sources.includes(active)) valid.source = active;
    if (p.outfit && p.outfit.length >= 3) valid.outfit = p.outfit;
    if (p.look) valid.look = p.look;
    if (usableName(p.name) && !(await stat(join(deps.framesDir, p.name)).then(() => true, () => false))) valid.name = p.name;
    if (on && p.redraw && waiting?.kind === "review") {
      const names = frameNames(p.redraw);
      if (names.length) valid.redraw = names;
    }
    if (p.step && on && waiting?.kind === "pick" && chain?.jobId === waiting.job.id) {
      chain.suggestions = [...chain.suggestions, p.step].slice(-6);
      deps.broadcast({ type: "studio-step-suggestions", id: waiting.job.id, suggestions: chain.suggestions });
    }
    if (running || !(valid.outfit || valid.name || valid.look || valid.redraw)) return;
    proposal = { id: randomBytes(4).toString("hex"), ...valid };
    if (!on) {
      // Off: ask. The yes (from this computer) is what turns it on, and her words are in the form when it opens.
      deps.broadcast({ type: "studio-ask", id: proposal.id, outfit: valid.outfit ?? null, name: valid.name ?? null, backend: deps.settings.studioBackend });
      return;
    }
    deps.broadcast({ type: "studio-proposal", ...proposal, job: waiting?.kind === "review" ? waiting.job.id : null });
  }

  /** Jobs of an earlier session that can be carried on: waiting for the pick, half built, or ready to review. Newest first. */
  async function findJobs(): Promise<{ id: string; name: string; outfit: string; stage: "pick" | "build" | "review" }[]> {
    const root = join(deps.dataDir, "studio");
    const found: { id: string; name: string; outfit: string; stage: "pick" | "build" | "review"; created: string }[] = [];
    const has = (path: string) => stat(path).then(() => true, () => false);
    for (const id of await readdir(root).catch(() => [] as string[])) {
      const parsed = parseJob(await readFile(join(root, id, "job.json"), "utf8").then((t) => JSON.parse(t), () => null));
      if (!parsed.ok || parsed.job.id !== id || (await has(join(deps.framesDir, parsed.job.name)))) continue;
      const dir = join(root, id);
      const stage = (await has(join(dir, "out/neutral.webp"))) ? "review" : (await has(join(dir, "base/chosen.png"))) ? "build" : (await has(join(dir, `base/seed-${parsed.job.seeds[0]}.thumb.webp`))) ? "pick" : null;
      if (stage) found.push({ id, name: parsed.job.name, outfit: parsed.job.outfit, stage, created: parsed.job.created });
    }
    return found.sort((a, b) => b.created.localeCompare(a.created)).slice(0, 5).map(({ created: _created, ...rest }) => rest);
  }

  /** What to do when a model on this computer is not there: said instead of an error, with the guide to follow. */
  const localHelp = (url: string, problem: string): string =>
    `${problem}\n\nTo draw on this computer you need an image model running, which the app does not bundle. ` +
    `1. Download a model once (the reference one, FLUX.2 klein 4B, is about 8 GB and needs about 22 GB of memory to run). ` +
    `2. Start its server (python/pack_studio/server.py in this app's folder; it listens on 127.0.0.1 only${deps.settings.studioPython && deps.settings.studioServer ? `; with your Python: ${startCommand(deps.settings.studioPython, deps.settings.studioServer, url)}` : "; /studio python and /studio server tell the app which Python and script are yours, and it then shows the command"}). ` +
    `3. Press the button again${url === DEFAULT_LOCAL_BACKEND ? "" : `, or give its address with /studio backend <address> (now ${url})`}. ` +
    `The step-by-step guide: ${LOCAL_MODEL_GUIDE} . Or use another image maker instead: /studio backend xai (or gemini, openai, grok-web, gemini-web, chatgpt-web). With none of these, /studio handover gives you a prompt to copy into any AI agent that makes pictures.`;

  async function check(): Promise<{ ok: true; info: BackendInfo } | { ok: false; reason: string }> {
    const url = checkBackendUrl(deps.settings.studioBackend);
    if (!url) return { ok: false, reason: localHelp(DEFAULT_LOCAL_BACKEND, "No image maker is chosen yet.") };
    try {
      const info = await backendFor(url).info();
      if (isLocal(url) && info.weights === false) return { ok: false, reason: localHelp(url, `The image server at ${url} is running, but it has no model downloaded yet.`) };
      if (!info.edit) return { ok: false, reason: "That backend cannot change a picture (it has no /edit), which a redraw needs." };
      return { ok: true, info };
    } catch (error) {
      const reason = error instanceof BackendError || error instanceof Error ? error.message : String(error);
      return { ok: false, reason: isLocal(url) ? localHelp(url, reason) : reason };
    }
  }

  const describe = (info: BackendInfo) => `${info.name}${info.model ? `, model ${info.model}` : ""}${info.licence ? ` (${info.licence})` : ""}`;

  function forget(): void {
    clearAssist();
    pending = null;
    waiting = null;
    shown.clear();
    previews.clear();
    lastText = "";
  }

  function stopRunning(): void {
    forget();
    if (!running) return;
    void running.worker.terminate();
    running = null;
  }

  function startWorker(job: Job, dir: string, phase: "base" | "build" | "assemble" | "step", info: BackendInfo, data: Record<string, unknown>): void {
    const worker = new Worker(deps.workerUrl ?? new URL("./studio/studio-worker.ts", import.meta.url), {
      workerData: { phase, dir, job, limitUsd: budget(), spentUsd: spent, ...data },
      stderr: true,
    });
    worker.unref();
    const run: Running = { job, dir, worker, phase, info };
    const back = waiting; // a step that fails or ends goes back to the base it was asked on
    const review0 = waiting?.kind === "review" && data.only ? waiting : null; // a redraw that fails leaves the review as it was
    running = run;
    waiting = null;
    void announce();
    // A base drawn again starts from the pictures the user already has (`before`), so they are still listed after the new ones.
    const candidates: number[] = Array.isArray(data.before) ? [...(data.before as number[])] : [];
    let review: Review | null = null;
    const fail = (message: string) => {
      if (running !== run) return;
      running = null;
      if (review0) waiting = review0;
      else if (run.phase === "step") {
        waiting = back;
        if (chain) chain.steps = chain.steps.filter((step) => step.candidates.length > 0);
      }
      deps.pushNote(`the pack studio stopped while drawing "${job.name}": ${message.slice(0, 300)}`);
      // The job's files are on disk: the page may offer to carry on (a redraw that failed keeps its review open instead, which has its own buttons).
      deps.broadcast({ type: "studio-error", id: job.id, message, retry: review0 ? null : "resume" });
      void announce();
    };
    // One message at a time and in order: reading a thumbnail takes a moment, and "finished" must not be handled before the review it follows.
    let inOrder: Promise<void> = Promise.resolve();
    worker.on("message", (event: StudioEvent | { type: "finished" }) => {
      inOrder = inOrder.then(() => handle(event)).catch((error) => fail(error instanceof Error ? error.message : String(error)));
    });
    const handle = async (event: StudioEvent | { type: "finished" }): Promise<void> => {
      if (running !== run) return;
      if (event.type === "status") {
        lastText = event.text;
        deps.broadcast({ type: "studio-progress", id: job.id, text: event.text });
      } else if (event.type === "candidate") {
        candidates.push(event.seed);
        const file = await readFile(join(dir, event.thumb)).catch(() => null);
        const thumb = file ? `data:image/webp;base64,${file.toString("base64")}` : null;
        if (thumb) shown.set(event.seed, thumb);
        deps.broadcast({ type: "studio-candidate", id: job.id, seed: event.seed, done: event.done, total: event.total, thumb });
      } else if (event.type === "preview") {
        const file = await readFile(join(dir, event.thumb)).catch(() => null);
        const thumb = file ? `data:image/webp;base64,${file.toString("base64")}` : null;
        previews.set(event.name, { thumb, flagged: event.flagged, flags: event.flags });
        deps.broadcast({ type: "studio-preview", id: job.id, name: event.name, thumb, flagged: event.flagged, flags: event.flags });
      } else if (event.type === "assist") {
        await offerAssist(job.id, dir, event);
      } else if (event.type === "spend") {
        spent = event.usd;
        await writeFile(join(dir, "spend.json"), JSON.stringify({ usd: spent })).catch(() => {});
        deps.broadcast({ type: "studio-spend", id: job.id, usd: spent, limit: budget() });
      } else if (event.type === "base-done") {
        lastText = "Pick the one you like. Nothing is saved until you do." + (info.paid ? ` ${paidProjection(spent, job.seeds.length)}` : "");
        deps.broadcast({ type: "studio-candidates-done", id: job.id, text: lastText });
      } else if (event.type === "step-candidate") {
        const file = await readFile(join(dir, event.thumb)).catch(() => null);
        const thumb = file ? `data:image/webp;base64,${file.toString("base64")}` : null;
        chain?.steps.find((step) => step.n === event.n)?.candidates.push({ seed: event.seed, file: event.file, thumb });
        deps.broadcast({ type: "studio-step-candidate", id: job.id, n: event.n, seed: event.seed, done: event.done, total: event.total, thumb });
      } else if (event.type === "step-done") {
        lastText = "Keep one of the pictures for the next step, or approve this base.";
        deps.broadcast({ type: "studio-steps-done", id: job.id, text: lastText });
      } else if (event.type === "review") {
        const tiles = await Promise.all(
          event.tiles.map(async (t) => {
            const file = await readFile(join(dir, t.thumb)).catch(() => null);
            // A face edit's other version (pasted or whole), assembled the same way: the review compares the two.
            const alt = t.alt ? await readFile(join(dir, t.alt)).catch(() => null) : null;
            return { name: t.name, thumb: file ? `data:image/webp;base64,${file.toString("base64")}` : null, flagged: t.flagged, flags: t.flags, variant: t.variant, alt: alt ? `data:image/webp;base64,${alt.toString("base64")}` : null, altVariant: t.altVariant, altFlags: t.altFlags ?? [] };
          }),
        );
        review = { tiles, flagged: event.flagged, pasteAvailable: event.pasteAvailable !== false };
      } else if (event.type === "error") {
        fail(event.message);
      } else if (event.type === "finished") {
        void run.worker.terminate();
        running = null;
        if (run.phase === "base") {
          waiting = { kind: "pick", job, dir, info, candidates, review: null };
        } else if (run.phase === "step") {
          waiting = back;
        } else {
          lastText = review && review.flagged.length ? `Done. ${review.flagged.length} picture${review.flagged.length === 1 ? "" : "s"} did not pass every check: look at them.` : "Done. Look at the pack, then use it.";
          waiting = { kind: "review", job, dir, info, candidates: [], review };
          deps.broadcast({ type: "studio-review", id: job.id, ...review });
          deps.pushNote(reportNote(job, review));
        }
        void announce();
      }
    };
    worker.on("error", (error) => fail(`The studio stopped: ${error.message}`));
  }

  async function install(w: Waiting): Promise<void> {
    const { job, dir, info } = w;
    const out = join(dir, "out");
    try {
      const lookText = job.look || `You wear ${job.outfit}.`;
      // Where the base came from, in words (an upload has no pack).
      const from = job.sourceKind === "upload" ? "a picture the user uploaded" : `the \`${job.source}\` pack`;
      await writeFile(join(out, "look.txt"), `${job.character ? `character: ${job.character}\n` : ""}${lookText}\n`);
      await writeFile(join(out, "credit.txt"), `${job.name}: made on this computer with AI (${info.model ?? info.name}), from ${job.sourceKind === "upload" ? "a picture the user uploaded" : `the ${job.source} pack`}.\nMade with AI. See packs/${job.name}/NOTICE.md for the terms.\n`);
      await writeFile(
        join(out, "NOTICE.md"),
        `# ${job.name}\n\nA picture pack made on this computer with the app's pack studio, from ${from}, in a new outfit: ${job.outfit}.\n\n` +
          `**These pictures were made with AI**: ${describe(info)}${info.revision ? `, revision ${info.revision}` : ""}. The terms of that model apply to them, and ${RESPONSIBILITY[0].toLowerCase()}${RESPONSIBILITY.slice(1)}\n\n` +
          `A pack made like this is a draft and belongs to whoever made it. It is not part of the shared packs and is not published by the app.\n`,
      );
      await writeFile(join(out, "PROCESS.md"), processText(job, info.model ?? info.name, await readRecords(dir)));
      const target = join(deps.framesDir, job.name);
      if (await stat(target).then(() => true, () => false)) throw new Error(`There is already a pack called ${job.name}. Nothing was replaced; start again with another name.`);
      // A new character's file is the user's own and is written with the pack, only after the yes; it is refused if it exists.
      const characterFile = job.newCharacter ? join(deps.framesDir, "characters", `${job.newCharacter.id}.txt`) : null;
      if (characterFile && (await stat(characterFile).then(() => true, () => false))) throw new Error(`There is already a character called ${job.newCharacter?.id}. Nothing was written; start again with another name.`);
      await mkdir(deps.framesDir, { recursive: true });
      // The job's own folder keeps its pictures (a later redraw can use them); the pack is a copy, renamed into place whole.
      await copyDir(out, join(deps.dataDir, "studio", `${job.id}-install`), target);
      if (characterFile && job.newCharacter) {
        await mkdir(join(deps.framesDir, "characters"), { recursive: true });
        await writeFile(characterFile, `${job.newCharacter.name}\n${job.newCharacter.description || lookText}\ndefault: ${job.name}\n`, { flag: "wx" });
      }
      forget();
      await deps.refreshPacks();
      deps.pushNote(`the user made a new picture pack on their computer, ${job.name} (${job.outfit}); it is a draft.`);
      deps.broadcast({ type: "studio-installed", id: job.id, name: job.name });
      void announce();
    } catch (error) {
      deps.broadcast({ type: "studio-error", id: job.id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function start(msg: Record<string, unknown>, send: Send): Promise<void> {
    if (running) return send({ type: "studio-error", message: "A job is running. Stop it first." });
    const source = typeof msg.source === "string" ? msg.source : "";
    const name = typeof msg.name === "string" ? msg.name.trim() : "";
    const outfit = cleanText(msg.outfit, MAX_OUTFIT);
    const look = cleanText(msg.look, MAX_LOOK);
    const seed = validSeed(msg.seed);
    proposal = null;
    const err = (message: string) => send({ type: "studio-error", message });
    // A new character (`mode: "character"`): her id is made from the name; the base is an existing character's neutral picture, or an upload.
    const newChar = msg.mode === "character" ? characterFrom(msg.characterName) : null;
    if (msg.mode === "character" && !newChar) return err("The new character needs a name with letters or digits.");
    if (newChar && (await deps.characterExists?.(newChar.id))) return err(`A character called ${newChar.id} already exists. Pick another name.`);
    const isUpload = Boolean(newChar) && msg.route === "upload";
    const referenceKind = !isUpload && (msg.referenceKind === "outfit" || msg.referenceKind === "character") ? msg.referenceKind : null;
    const reference = referenceKind ? await pictureFrom(msg.reference) : null;
    if (referenceKind && !reference) return err("The reference picture could not be read. Give a PNG, JPEG or WebP, or choose no reference.");
    if (!isUpload && !(await deps.sources()).includes(source)) return err("Pick one of your packs to draw from.");
    if (!isPackName(name) || name.startsWith(".")) return err("The new pack's name can have letters, digits, spaces and . _ - only.");
    if (await stat(join(deps.framesDir, name)).then(() => true, () => false)) return err(`There is already a pack called ${name}. Pick another name.`);
    if (!isUpload && outfit.length < 3) return err("Describe the outfit in a few words.");
    const checked = await check();
    if (!checked.ok) return err(checked.reason);
    let found: SourceFrames;
    let picture: Raster;
    let key: KeyName;
    let uploadRedraw = false;
    if (isUpload && newChar) {
      const raw = await uploadFrom(msg.upload);
      if (!raw) return err("The picture could not be read. Give a PNG, JPEG or WebP of up to 5 MB.");
      const prepared = prepareUpload(raw);
      uploadRedraw = prepared.route === "redraw";
      picture = prepared.picture;
      key = prepared.key;
      found = { neutral: await encodePng(picture), talk: [], character: newChar.id };
    } else {
      const fromPack = await deps.readSource(source);
      if (!fromPack) return err(`The ${source} pack has no neutral picture to draw from.`);
      found = fromPack;
      picture = await decode(found.neutral);
      key = pickKey(picture).key;
    }
    const height = 1024;
    const width = Math.min(1536, Math.max(256, Math.round(((picture.w / picture.h) * height) / 16) * 16));
    const parsed = parseJob({
      id: `job-${randomBytes(4).toString("hex")}`,
      kind: "redraw",
      name,
      source: isUpload ? "upload" : source,
      character: newChar ? newChar.id : found.character,
      outfit,
      look: look || `You wear ${outfit}.`,
      key,
      width,
      height,
      backend: { url: deps.settings.studioBackend, name: checked.info.name, model: checked.info.model, revision: checked.info.revision, licence: checked.info.licence },
      // A seed given in the form draws exactly that picture first; the rest of the candidates come from "add more". A cut-out upload is one picture.
      seeds: isUpload && !uploadRedraw ? [1] : seed !== null ? [seed] : [1, 2, 3, 4].slice(0, Number.isInteger(msg.pictures) && (msg.pictures as number) >= 1 && (msg.pictures as number) <= 4 ? (msg.pictures as number) : 4),
      reference: referenceKind,
      sourceKind: isUpload ? "upload" : "pack",
      newCharacter: newChar ? { ...newChar, description: cleanText(msg.characterDescription, 300) } : null,
      uploadRedraw,
    });
    if (!parsed.ok) return err(parsed.reason);
    forget(); // only now: a form that fails above must not drop the review the user is looking at
    pending = { job: parsed.job, source: found, info: checked.info };
    pendingReference = reference;
    send({
      type: "studio-confirm",
      id: parsed.job.id,
      name,
      source: isUpload ? "your uploaded picture" : source,
      outfit: parsed.job.outfit,
      character: newChar ? { id: newChar.id, name: newChar.name, file: join(deps.framesDir, "characters", `${newChar.id}.txt`) } : null,
      backend: describe(checked.info),
      folder: join(deps.framesDir, name),
      pictures: parsed.job.seeds.length,
      paid: checked.info.paid ? { host: checked.info.paid.host, limit: budget() } : null,
      browser: checked.info.browser ?? null,
      assisted: checked.info.assisted ?? null,
      note:
        (newChar ? `This makes a new character, ${newChar.name} (${newChar.id}): her file characters/${newChar.id}.txt is written when you accept the pack. ` : "") +
        (isUpload ? (uploadRedraw ? "Your picture has a busy background, so the model draws the background over first (a model call, paid on a paid maker). " : "Your picture is cut out in code: no model call is made for it. ") : "") +
        (checked.info.paid ? `${paidNote(checked.info, parsed.job.seeds.length)} ` : "") +
        (checked.info.browser ? `${browserNote(checked.info)} ` : "") +
        (checked.info.assisted ? `${assistedNote(parsed.job.seeds.length)} ` : "") +
        (() => {
          const n = parsed.job.seeds.length;
          const what = `${n} ${n === 1 ? "picture" : "pictures"} of ${isUpload ? "your uploaded picture" : source} in that outfit with ${describe(checked.info)}`;
          const rest = `You pick one (if you drew several); then about forty more pictures are made from it (faces, blinks, mouths and poses), and you look at the pack before it is written to data/frames/${name}. `;
          return checked.info.paid || checked.info.browser || checked.info.assisted
            ? `This draws ${what}. ${rest}`
            : `This draws ${what} on this computer. Each takes seconds to a few minutes, and the first may load the model (the reference FLUX.2 klein 4B server needs about 22 GB of memory; another model needs what it needs). ${rest}`;
        })() +
        `${RESPONSIBILITY}`,
    });
  }

  async function confirm(id: string, send: Send): Promise<void> {
    if (!pending || pending.job.id !== id || running) return send({ type: "studio-error", message: "That question is no longer open." });
    const { job, source, info } = pending;
    pending = null;
    const dir = join(deps.dataDir, "studio", job.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "job.json"), JSON.stringify(job, null, 2));
    if (pendingReference) await writeFile(join(dir, "reference.png"), pendingReference);
    pendingReference = null;
    spent = 0;
    startWorker(job, dir, "base", info, { source: source.neutral, sourceFrames: { blink: source.blink, talk: source.talk } });
    send({ type: "studio-progress", id: job.id, text: "Starting…" });
  }

  /** A picture the page sent (base64, with or without its data: prefix), as a PNG on white. Null when the app cannot read it. */
  /** An uploaded picture as decoded (its transparency kept), or null when it cannot be read or is too big. */
  async function uploadFrom(value: unknown): Promise<Raster | null> {
    if (typeof value !== "string") return null;
    const bytes = Buffer.from(value.replace(/^data:[^,]*,/, ""), "base64");
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    try {
      return await decode(bytes);
    } catch {
      return null;
    }
  }

  async function pictureFrom(value: unknown): Promise<Buffer | null> {
    if (typeof value !== "string") return null;
    const bytes = Buffer.from(value.replace(/^data:[^,]*,/, ""), "base64");
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    try {
      return await encodePng(flatten(await decode(bytes), [255, 255, 255]));
    } catch {
      return null;
    }
  }

  /** Adds base pictures to the ones waiting for a pick: on a seed the user gives, or on fresh random ones. A seed that is already here is refused. */
  async function moreBase(msg: Record<string, unknown>, send: Send): Promise<void> {
    const err = (message: string) => send({ type: "studio-error", message });
    if (!on) return err("Turn the pack studio on first.");
    if (!waiting || waiting.kind !== "pick" || waiting.job.id !== msg.id || running) return err("There are no base pictures to add to right now.");
    const given = validSeed(msg.seed);
    if (msg.seed !== undefined && msg.seed !== null && msg.seed !== "" && given === null) return err("The seed has to be a whole number from 0 to 2147483646.");
    const used = new Set(waiting.candidates);
    let seeds: number[];
    if (given !== null) {
      if (used.has(given)) return err(`Seed ${given} already has a picture here. Pick it, or give another seed.`);
      seeds = [given];
    } else {
      seeds = [];
      while (seeds.length < 2) {
        const seed = (randomBytes(4).readUInt32BE(0) % 2147483646) + 1;
        if (!used.has(seed) && !seeds.includes(seed)) seeds.push(seed);
      }
    }
    const found = await deps.readSource(waiting.job.source);
    if (!found) return err(`The ${waiting.job.source} pack has no neutral picture to draw from.`);
    const { job, dir, info, candidates } = waiting;
    startWorker(job, dir, "base", info, { seeds, before: candidates, source: found.neutral, sourceFrames: { blink: found.blink, talk: found.talk } });
    send({ type: "studio-progress", id: job.id, text: `Drawing ${seeds.length === 1 ? `seed ${seeds[0]}` : `${seeds.length} new pictures`}…` });
  }

  /** The base picture the steps change: one of the candidates. Resets the chain (its steps were for the other base). */
  async function baseUse(id: string, seed: number, send: Send): Promise<void> {
    if (!waiting || waiting.kind !== "pick" || waiting.job.id !== id || running || !waiting.candidates.includes(seed)) return send({ type: "studio-error", message: "That picture is not available." });
    chain = { jobId: id, current: `base/seed-${seed}.png`, currentThumb: shown.get(seed) ?? null, history: [], steps: [], suggestions: [] };
    void announce();
  }

  /** One step: one change in words to the current base, optionally with a picture it takes from (image 2). Drawn in the background; nothing is kept until the user says so. */
  async function step(msg: Record<string, unknown>, send: Send): Promise<void> {
    const err = (message: string) => send({ type: "studio-error", message });
    if (!on) return err("Turn the pack studio on first.");
    if (!waiting || waiting.kind !== "pick" || waiting.job.id !== msg.id || running) return err("There is no base to change right now.");
    if (!chain || chain.jobId !== waiting.job.id) return err("Pick the base picture to change first.");
    const change = cleanText(msg.change, 200);
    if (change.length < 3) return err("Say what to change in a few words.");
    const reference = msg.reference === undefined || msg.reference === null ? null : await pictureFrom(msg.reference);
    if (msg.reference !== undefined && msg.reference !== null && !reference) return err("The picture for the change could not be read. Give a PNG, JPEG or WebP.");
    const { job, dir, info } = waiting;
    const n = chain.steps.length + 1;
    await mkdir(join(dir, "steps", String(n)), { recursive: true });
    if (reference) await writeFile(join(dir, "steps", String(n), "reference.png"), reference);
    chain.steps.push({ n, change, kept: null, candidates: [] });
    chain.suggestions = chain.suggestions.filter((s) => s !== change);
    startWorker(job, dir, "step", info, { step: { n, change, input: chain.current, reference: reference ? `steps/${n}/reference.png` : undefined, seeds: job.seeds.slice(0, 2) } });
  }

  /** The user keeps one picture of a step: it becomes the base for the next step (and the one that is approved, if nothing else follows). */
  async function stepKeep(id: string, n: number, seed: number, send: Send): Promise<void> {
    const record = chain?.jobId === id ? chain.steps.find((step) => step.n === n) : undefined;
    const candidate = record?.candidates.find((c) => c.seed === seed);
    if (!chain || !record || !candidate || !waiting || waiting.job.id !== id || running) return send({ type: "studio-error", message: "That picture is not available." });
    chain.history.push({ file: chain.current, thumb: chain.currentThumb, n, kept: record.kept });
    record.kept = seed;
    chain.current = candidate.file;
    chain.currentThumb = candidate.thumb;
    void announce();
  }

  /** Puts back the picture before the last kept one. */
  async function stepUndo(id: string, send: Send): Promise<void> {
    if (!chain || chain.jobId !== id || !waiting || waiting.job.id !== id || running || chain.history.length === 0) return send({ type: "studio-error", message: "Nothing to undo." });
    const back = chain.history.pop()!;
    const record = chain.steps.find((step) => step.n === back.n);
    if (record) record.kept = back.kept;
    chain.current = back.file;
    chain.currentThumb = back.thumb;
    void announce();
  }

  /**
   * Asks the selected brain to rewrite the outfit words for the image maker, with the reference picture attached when the brain can see
   * pictures. Her answer is one `[studio outfit="…"]` tag, which the form takes like any other proposal (propose). One model call, on the user's yes.
   */
  async function polish(msg: Record<string, unknown>, send: Send): Promise<void> {
    const err = (message: string) => send({ type: "studio-error", message });
    if (!on) return err("Turn the pack studio on first.");
    if (deps.mode() !== "chat") {
      // The answer comes back as a tag, and only chat mode turns tags into the form (propose). So the polish switches to chat first.
      if (!(await deps.switchToChat?.())) return err("Could not switch to chat mode, which polishing needs. Switch to chat in the menu, then try again.");
    }
    if (!deps.askBrain) return err("The chat brain is not available to polish the words.");
    const outfit = cleanText(msg.outfit, MAX_OUTFIT);
    const kind = msg.referenceKind === "character" ? "character" : msg.referenceKind === "outfit" ? "outfit" : null;
    const reference = kind && msg.reference ? await pictureFrom(msg.reference) : null;
    const withPicture = Boolean(reference && deps.canSeePictures?.());
    // Blank words are fine when a picture the brain can see gives the outfit: then it describes that picture.
    if (outfit.length < 3 && !withPicture) return err(kind && reference ? "The brain you have selected cannot see pictures, so it cannot describe the reference. Describe the outfit in a few words, or pick a vision capable model." : "Describe the outfit in a few words first.");
    const about = kind === "character" ? "take her face and hair from it, and nothing else" : "take only the clothes from it";
    const start =
      outfit.length >= 3
        ? `Polish these outfit words for an image model that redraws an anime character wearing it: "${outfit}". `
        : "Her outfit words are blank. Write the outfit from the attached picture as words for an image model that redraws an anime character wearing it. ";
    const text =
      start +
      (withPicture
        ? `A reference picture is attached: ${about}. `
        : "No picture is attached, so work from the words alone. If her words point at a picture (\"the outfit from the reference\"), do not copy them: write the clothes as a plain description of an outfit, and say nothing about a picture. ") +
      `Keep it to one or two sentences, and name the clothes, colours and materials. ` +
      `Reply with only one tag, in the form [studio outfit="…"].`;
    deps.askBrain(text, withPicture && reference ? { mediaType: "image/png", data: reference.toString("base64") } : undefined);
  }

  /** Asks the brain, with the current base attached, for the next steps. Her reply comes back as `[studio step="…"]` tags (propose). Refused when the brain cannot see pictures. */
  async function stepSuggest(id: string, send: Send): Promise<void> {
    const err = (message: string) => send({ type: "studio-error", message });
    if (!on || !waiting || waiting.kind !== "pick" || waiting.job.id !== id || running) return err("There is no base to suggest steps for right now.");
    if (!chain || chain.jobId !== id) return err("Pick the base picture first.");
    if (!deps.askBrain || !deps.canSeePictures?.()) return err("The brain you have selected cannot see pictures. Write the change yourself.");
    const { job, dir } = waiting;
    const picture = await readFile(join(dir, chain.current)).catch(() => null);
    if (!picture) return err("The base picture is not there any more.");
    const text =
      `The pack studio is making a new outfit picture of her from the picture attached (her base, outfit: ${job.outfit}). ` +
      `Suggest the next steps, one change at a time, as separate tags, each naming one thing only (for example a hair colour, a haircut, the head, or one piece of clothing). ` +
      `Write only the tags, one per line, in the form [studio step="her hair to a short red bob"]. Nothing is drawn until the user chooses a step.`;
    deps.askBrain(text, { mediaType: "image/png", data: picture.toString("base64") });
  }

  /** Approves the current base: it is what the rest of the pack is made from. */
  async function approve(id: string, send: Send, pasteBack: boolean): Promise<void> {
    if (!chain || chain.jobId !== id || !waiting || waiting.kind !== "pick" || waiting.job.id !== id || running) return send({ type: "studio-error", message: "Pick the base picture first." });
    const { job, dir, info } = waiting;
    await copyFile(join(dir, chain.current), join(dir, "base/chosen.png"));
    chain = null;
    shown.clear();
    // The paste-back choice of the first build (off unless the user turned it on on the base's panel).
    startWorker(job, dir, "build", info, { options: { pasteBack } });
  }

  async function pick(id: string, seed: number, send: Send, pasteBack: boolean): Promise<void> {
    if (!waiting || waiting.kind !== "pick" || waiting.job.id !== id || running || !waiting.candidates.includes(seed)) return send({ type: "studio-error", message: "That picture is not available." });
    const { job, dir, info } = waiting;
    await copyFile(join(dir, `base/seed-${seed}.png`), join(dir, "base/chosen.png"));
    shown.clear();
    startWorker(job, dir, "build", info, { options: { pasteBack } });
  }

  /** The picture names a list means: exact names, and a pose's own name (`cheer`, `wave`) for all its pictures. Anything else is dropped. */
  function frameNames(list: string[]): string[] {
    const known = knownFrameNames();
    return [...new Set(list.flatMap((n) => (known.has(n) ? [n] : [...known].filter((k) => k.startsWith(`${n}-`) && /^\d+$/.test(k.slice(n.length + 1))))))];
  }

  /** Makes some pictures again (and what was drawn from them), with new seeds. */
  /** A pack out to a folder of the user's, or a folder of theirs in as a pack. Never over anything that exists. */
  async function transfer(msg: Record<string, unknown>, send: Send): Promise<void> {
    const folder = typeof msg.folder === "string" ? msg.folder.trim() : "";
    if (msg.type === "studio-export") {
      const source = typeof msg.source === "string" ? msg.source : "";
      const from = (await deps.sources()).includes(source) ? await deps.packFolder(source) : null;
      if (!from) return send({ type: "studio-error", message: "Pick one of the packs on this computer to export." });
      const to = await exportPack(from, folder, source);
      return send({ type: "studio-transferred", message: `${source} was copied to ${to}.` });
    }
    const name = typeof msg.name === "string" ? msg.name.trim() : "";
    if (!usableName(name)) return send({ type: "studio-error", message: "The pack's name can have letters, digits, spaces and . _ - only." });
    const count = await importPack(folder, deps.framesDir, name);
    await deps.refreshPacks();
    void announce(); // the lists in the panel know the new pack
    send({ type: "studio-transferred", message: `${name} was imported (${count} pictures). Use it from Looks → Packs.` });
  }

  async function regenerate(id: string, names: unknown, send: Send, sameSeed = false, seedValue: unknown = null, pasteBack = false): Promise<void> {
    if (!waiting || waiting.kind !== "review" || waiting.job.id !== id || running) return send({ type: "studio-error", message: "There is nothing to redraw." });
    const only = Array.isArray(names) ? frameNames(names.filter((n): n is string => typeof n === "string")).slice(0, 30) : [];
    if (only.length === 0) return send({ type: "studio-error", message: "Say which picture to draw again." });
    // A seed typed in the review is for every picture drawn again; empty means the usual seeds.
    const seed = seedValue === null || seedValue === undefined || seedValue === "" ? null : validSeed(seedValue);
    if (seed === null && seedValue !== null && seedValue !== undefined && seedValue !== "") return send({ type: "studio-error", message: "The seed is a whole number from 0 up, or empty for a random one." });
    const { job, dir, info } = waiting;
    startWorker(job, dir, "build", info, { only, sameSeed: sameSeed ? only : [], options: { seed: seed ?? undefined, pasteBack } });
  }

  /** The review's other version of a face picture goes into the pack (no drawing): the pack is assembled again. */
  async function switchVersion(id: string, name: unknown, variant: unknown, send: Send): Promise<void> {
    if (!waiting || waiting.kind !== "review" || waiting.job.id !== id || running) return send({ type: "studio-error", message: "The pack is not waiting for a look." });
    if (typeof name !== "string" || (variant !== "pasted" && variant !== "whole")) return send({ type: "studio-error", message: "Say which picture and which version." });
    const { job, dir, info } = waiting;
    startWorker(job, dir, "assemble", info, { switchTo: { name, variant } });
  }

  // --- one picture of an installed pack, drawn again from words (src/studio/frame-edit.ts) ---
  /** A picture is being drawn: no other job starts until it is done. */
  let frameBusy = false;
  /** Ends the one picture being drawn (the by-hand maker waits for a person, so it must be stoppable). */
  let frameAbort: AbortController | null = null;
  /** The picture drawn, waiting for the user's yes or no. Nothing is written until the yes. */
  let frameReview: { id: string; activity?: { id: string; from: string }; source: string; frame: string; name: string; shipped: boolean; change: string; picture: Raster; flags: Flags; model: string; old: string; new: string } | null = null;
  const reviewMessage = () => (frameReview ? { id: frameReview.id, activity: frameReview.activity?.id ?? null, from: frameReview.activity?.from ?? null, source: frameReview.source, frame: frameReview.frame, name: frameReview.name, shipped: frameReview.shipped, change: frameReview.change, model: frameReview.model, flags: frameReview.flags, old: frameReview.old, new: frameReview.new } : null);

  /** The pictures a pack has, by name without `.webp`, sorted: only the names a picture can have. */
  async function framesOf(source: string): Promise<string[]> {
    const folder = await deps.packFolder(source);
    if (!folder) return [];
    const names = await readdir(folder).catch(() => [] as string[]);
    return names.filter((n) => n.endsWith(".webp")).map((n) => n.slice(0, -5)).filter((n) => FRAME_NAME.test(n)).sort();
  }

  /** Draws one picture of a pack again. Needs a model on this computer that can change a picture (a paid or browser maker is not wired for one picture yet). */
  async function frameStart(msg: Record<string, unknown>, send: Send): Promise<void> {
    const err = (message: string) => send({ type: "studio-error", message });
    if (running || waiting || pending || frameBusy || frameAsk) return err("Finish or stop the job that is open first.");
    if (frameReview) return err("Keep or drop the picture that is drawn first.");
    const source = typeof msg.source === "string" ? msg.source : "";
    const frame = typeof msg.frame === "string" ? msg.frame : "";
    const change = cleanText(msg.prompt, 400);
    // No name: the picture is changed in the pack itself (the original is kept in it). A name: the pack is copied to a new one with that picture changed.
    const name = typeof msg.name === "string" ? msg.name.trim() : "";
    if (!(await deps.sources()).includes(source)) return err("Pick one of your packs.");
    if (!FRAME_NAME.test(frame)) return err("Pick a picture of that pack.");
    if (change.length < 3) return err("Say what to change in that picture, in a few words.");
    if (name && (!isPackName(name) || name.startsWith("."))) return err("The new pack's name can have letters, digits, spaces and . _ - only.");
    if (name && (await stat(join(deps.framesDir, name)).then(() => true, () => false))) return err(`There is already a pack called ${name}. Pick another name.`);
    const url = checkBackendUrl(deps.settings.studioBackend);
    if (!url) return err("Choose an image maker first (the Image maker list).");
    const folder = await deps.packFolder(source);
    const bytes = folder ? await readFile(join(folder, `${frame}.webp`)).catch(() => null) : null;
    if (!bytes) return err(`The ${source} pack has no picture called ${frame}.`);
    const checked = await check();
    if (!checked.ok) return err(checked.reason);
    const request = { id: `frame-${randomBytes(4).toString("hex")}`, source, frame, name, shipped: !isOwnFolder(folder!), change, bytes, info: checked.info, url };
    // A model on this computer costs nothing: it is drawn at once. A paid service or a browser maker is asked about first, with the same warning a pack gets.
    if (isLocal(url) || url === ASSISTED) return void (await frameDraw(request, send));
    frameAsk = request;
    deps.broadcast(frameAskMessage());
  }

  /** Whether a pack's folder is the user's own (data/frames), not a pack that comes with the app (packs/, part of the program). */
  const isOwnFolder = (folder: string) => resolve(folder).startsWith(resolve(deps.framesDir) + sep);

  type FrameRequest = { id: string; activity?: { id: string; from: string }; source: string; frame: string; name: string; shipped: boolean; change: string; bytes: Buffer; info: BackendInfo; url: string };
  let frameAsk: FrameRequest | null = null;
  const frameAskMessage = () =>
    frameAsk
      ? {
          type: "studio-frame-ask",
          id: frameAsk.id,
          source: frameAsk.source,
          frame: frameAsk.frame,
          name: frameAsk.name,
          backend: describe(frameAsk.info),
          paid: frameAsk.info.paid ? { host: frameAsk.info.paid.host, limit: budget() } : null,
          browser: frameAsk.info.browser ?? null,
          note:
            `This draws ONE picture (${frameAsk.frame} of ${frameAsk.source}) with ${describe(frameAsk.info)}. ` +
            (frameAsk.info.paid ? `${paidNote(frameAsk.info, 1).replace(/Making 1 pictures is the first step; the rest of the pack[^.]*\. /, "")} ` : "") +
            (frameAsk.info.browser ? `${browserNote(frameAsk.info).replace("for the whole pack instead of for every click", "for this one picture instead of for every click")} ` : "") +
            RESPONSIBILITY,
        }
      : null;

  async function frameGo(id: string, send: Send): Promise<void> {
    const request = frameAsk;
    if (!request || request.id !== id) return send({ type: "studio-error", message: "That question is no longer open." });
    frameAsk = null;
    await frameDraw(request, send);
  }

  async function frameDraw(request: FrameRequest, send: Send): Promise<void> {
    const { source, frame, name, shipped, change, bytes, info, url, activity } = request;
    const err = (message: string) => send({ type: "studio-error", message });
    frameBusy = true;
    const abort = (frameAbort = new AbortController());
    deps.broadcast({ type: "studio-frame-progress", text: activity ? (url === ASSISTED ? `Waiting for you to draw ${frame}…` : `Drawing ${frame}…`) : url === ASSISTED ? `Waiting for you to draw ${frame} of ${source}…` : `Drawing ${frame} from ${source} again…` });
    const work = join(deps.dataDir, "studio", `${request.id}-draw`);
    try {
      await mkdir(work, { recursive: true });
      const seed = (randomBytes(4).readUInt32LE() % 2147483646) + 1;
      const drawn = await drawFrame(bytes, change, seed, backendFor(url, work, request.id), abort.signal, { pose: Boolean(activity) });
      frameReview = {
        id: request.id,
        activity,
        source,
        frame,
        name,
        shipped,
        change,
        picture: drawn.picture,
        flags: drawn.flags,
        model: info.model ?? info.name,
        old: await thumbnail(await decode(bytes)),
        new: await thumbnail(drawn.picture),
      };
      deps.broadcast({ type: "studio-frame-review", ...reviewMessage() });
    } catch (error) {
      if (abort.signal.aborted) deps.broadcast({ type: "studio-frame-cancelled" });
      else err(error instanceof Error ? error.message : String(error));
    } finally {
      frameBusy = false;
      if (frameAbort === abort) frameAbort = null;
      clearAssist();
      await rm(work, { recursive: true, force: true });
    }
  }

  async function frameAccept(id: string, send: Send): Promise<void> {
    const review = frameReview;
    if (!review || review.id !== id) return send({ type: "studio-error", message: "There is no picture to keep." });
    if (review.activity) return void (await activityAccept(review, send));
    const folder = await deps.packFolder(review.source);
    if (!folder) return send({ type: "studio-error", message: `The ${review.source} pack is not there any more.` });
    if (!review.name) return void (await frameAcceptHere(review, folder, send));
    const target = join(deps.framesDir, review.name);
    if (await stat(target).then(() => true, () => false)) return send({ type: "studio-error", message: `There is already a pack called ${review.name}. Name the new one differently and draw it again.` });
    const work = join(deps.dataDir, "studio", `${id}-frame`);
    const out = join(work, "pack");
    try {
      await rm(work, { recursive: true, force: true });
      await mkdir(out, { recursive: true });
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        // Hidden files stay behind, and so does .pack-install.json: the new pack is not an install of the source.
        if (entry.isFile() && !entry.name.startsWith(".")) await copyFile(join(folder, entry.name), join(out, entry.name));
      }
      await writeFile(join(out, `${review.frame}.webp`), await encodeWebp(review.picture, { lossless: true }));
      await writeFile(join(out, "EDIT.md"), editText({ pack: review.source, frame: review.frame, change: review.change, model: review.model, flags: review.flags }));
      await mkdir(deps.framesDir, { recursive: true });
      await copyDir(out, join(work, "install"), target);
      frameReview = null;
      await deps.refreshPacks();
      deps.pushNote(`the user drew one picture of a pack again on their computer: ${review.name} (${review.frame}); it is a draft.`);
      deps.broadcast({ type: "studio-frame-installed", id, name: review.name });
      void announce();
    } catch (error) {
      send({ type: "studio-error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * The yes with no new name: the picture takes the place of the old one in the pack itself, in the user's own folder (a pack that comes with the app is copied
   * there first, and the copy is used instead of it). The picture it had is kept in the pack (`.original`), with a note of the edit (`.local-edits.json`),
   * so it can be put back, and so a newer version of the pack from the list can ask the user before it replaces the change.
   */
  async function frameAcceptHere(review: NonNullable<typeof frameReview>, folder: string, send: Send): Promise<void> {
    try {
      const own = await ownCopy(folder, review.source, review.id);
      await applyEdit(own, review.frame, await encodeWebp(review.picture, { lossless: true }), { at: new Date().toISOString(), change: review.change, model: review.model });
      frameReview = null;
      await deps.refreshPacks();
      await deps.reloadPack?.(review.source);
      deps.pushNote(`the user drew one picture of their ${review.source} pack again on their computer (${review.frame}): it is changed in the pack; the original is kept.`);
      deps.broadcast({ type: "studio-frame-installed", id: review.id, name: review.source, here: true, frame: review.frame, shipped: review.shipped });
      void announce();
    } catch (error) {
      send({ type: "studio-error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  /** The user's own folder of a pack: the pack's folder if it is theirs already, else a copy of the pack that comes with the app (which then wins over it). */
  async function ownCopy(folder: string, source: string, workId: string): Promise<string> {
    if (isOwnFolder(folder)) return folder;
    const own = join(deps.framesDir, source);
    if (await stat(own).then(() => true, () => false)) throw new Error(`There is already a folder called ${source} in your pictures. Name the new pack differently and draw it again.`);
    await mkdir(deps.framesDir, { recursive: true });
    await copyDir(folder, join(deps.dataDir, "studio", `${workId}-copy`), own);
    return own;
  }

  /** The original picture of one that was drawn again in its pack, put back. */
  async function frameRestore(msg: Record<string, unknown>, send: Send): Promise<void> {
    const source = typeof msg.source === "string" ? msg.source : "";
    const frame = typeof msg.frame === "string" ? msg.frame : "";
    const folder = (await deps.sources()).includes(source) && FRAME_NAME.test(frame) ? await deps.packFolder(source) : null;
    if (!folder || !isOwnFolder(folder) || !(await restoreOriginal(folder, frame))) return send({ type: "studio-error", message: `There is no original of ${frame || "that picture"} to put back.` });
    await deps.refreshPacks();
    await deps.reloadPack?.(source);
    deps.broadcast({ type: "studio-frame-restored", source, frame });
    void announce();
  }

  /** The no: the picture is dropped, and nothing was written. */
  function frameReject(id: string): void {
    if (!frameReview || frameReview.id !== id) return;
    frameReview = null;
    deps.broadcast({ type: "studio-frame-cancelled", id });
    void announce();
  }

  // --- an activity, made one picture at a time (src/studio/activity.ts; docs/pack-studio.md, "Making an activity") ---
  const studioDir = () => join(deps.dataDir, "studio");
  const activityThumbs = new Map<string, string>();
  const fail = (send: Send, error: unknown) => send({ type: "studio-error", message: error instanceof Error ? error.message : String(error) });

  /** What the page shows of a draft: its pictures in order with a small preview each (the full size comes on request, `studio-activity-full`). */
  async function activityShow(draft: ActivityDraft): Promise<void> {
    const preview = async (file: string, talk: boolean) => {
      const key = `${draft.id}/${talk ? "t" : "f"}${file}`;
      let thumb = activityThumbs.get(key);
      if (!thumb) {
        const bytes = await readFile(framePath(studioDir(), draft, file, talk)).catch(() => null);
        thumb = bytes ? await thumbnail(await decode(bytes)) : "";
        if (thumb) activityThumbs.set(key, thumb);
      }
      return thumb;
    };
    const frames = [];
    for (const [i, f] of draft.frames.entries()) frames.push({ n: i + 1, file: f.file, change: f.change, from: f.from, thumb: await preview(f.file, false), talk: draft.talk.includes(f.file) ? await preview(f.file, true) : null });
    deps.broadcast({ type: "studio-activity", id: draft.id, source: draft.source, name: draft.name, frames, taken: await activityTaken(draft.source, draft.name) });
  }

  /** Whether the pack already has an activity of that name (a new one never goes over it). */
  async function activityTaken(source: string, name: string): Promise<boolean> {
    const own = new RegExp(`^activity-${name}(-talk)?-\\d{1,2}$`);
    return (await framesOf(source)).some((n) => own.test(n));
  }

  const activityName = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "");
  const NAME_HELP = "An activity's name is one word of lower-case letters, digits and _ (cooking, tea_time).";

  async function activityNew(msg: Record<string, unknown>, send: Send): Promise<void> {
    const source = typeof msg.source === "string" ? msg.source : "";
    const name = activityName(msg.name);
    if (!(await deps.sources()).includes(source)) return fail(send, "Pick one of your packs.");
    if (!ACTIVITY_NAME.test(name)) return fail(send, NAME_HELP);
    if (await activityTaken(source, name)) return fail(send, `The ${source} pack has an activity called ${name} already. Pick another name.`);
    const draft = await createDraft(studioDir(), source, name);
    await activityShow(draft);
    void announce();
  }

  async function activityOpen(id: unknown, send: Send): Promise<void> {
    const draft = isDraftId(id) ? await readDraft(studioDir(), id) : null;
    if (!draft) return fail(send, "That activity is not there any more.");
    await activityShow(draft);
  }

  async function activityRename(msg: Record<string, unknown>, send: Send): Promise<void> {
    const draft = isDraftId(msg.id) ? await readDraft(studioDir(), msg.id) : null;
    if (!draft) return fail(send, "That activity is not there any more.");
    const name = activityName(msg.name);
    if (!ACTIVITY_NAME.test(name)) return fail(send, NAME_HELP);
    if (name !== draft.name && (await activityTaken(draft.source, name))) return fail(send, `The ${draft.source} pack has an activity called ${name} already. Pick another name.`);
    if (frameReview?.activity?.id === draft.id) return fail(send, "Keep or drop the picture that is drawn first.");
    draft.name = name;
    await writeDraft(studioDir(), draft);
    await activityShow(draft);
    void announce();
  }

  async function activityDelete(id: unknown, send: Send): Promise<void> {
    if (!isDraftId(id)) return;
    if (frameBusy || frameReview?.activity?.id === id) return fail(send, "Stop or finish the picture that is being drawn first.");
    await deleteDraft(studioDir(), id);
    for (const key of [...activityThumbs.keys()]) if (key.startsWith(`${id}/`)) activityThumbs.delete(key);
    deps.broadcast({ type: "studio-activity-gone", id });
    void announce();
  }

  async function activityRemove(msg: Record<string, unknown>, send: Send): Promise<void> {
    const draft = isDraftId(msg.id) ? await readDraft(studioDir(), msg.id) : null;
    if (!draft || !isFileId(msg.file)) return fail(send, "That picture is not there any more.");
    if (frameBusy || frameReview?.activity?.id === draft.id) return fail(send, "Stop or finish the picture that is being drawn first.");
    await removeFrame(studioDir(), draft, msg.file);
    await activityShow(draft);
    void announce();
  }

  /** The next picture of an activity: from the neutral (or any) picture of the pack, or from one already in the loop, and a few words on what changes. */
  async function activityDraw(msg: Record<string, unknown>, send: Send): Promise<void> {
    if (running || waiting || pending || frameBusy || frameAsk) return fail(send, "Finish or stop the job that is open first.");
    if (frameReview) return fail(send, "Keep or drop the picture that is drawn first.");
    const draft = isDraftId(msg.id) ? await readDraft(studioDir(), msg.id) : null;
    if (!draft) return fail(send, "That activity is not there any more.");
    const change = cleanText(msg.prompt, 400);
    if (change.length < 3) return fail(send, "Say what should change from that picture, in a few words.");
    if (draft.frames.length >= 99) return fail(send, "An activity can have 99 pictures at most.");
    const from = typeof msg.from === "string" ? msg.from : "";
    let bytes: Buffer | null = null;
    let label = "";
    if (from.startsWith("pack:") && FRAME_NAME.test(from.slice(5))) {
      const folder = await deps.packFolder(draft.source);
      label = from.slice(5);
      bytes = folder ? await readFile(join(folder, `${label}.webp`)).catch(() => null) : null;
    } else if (from.startsWith("draft:") && isFileId(from.slice(6))) {
      const index = draft.frames.findIndex((f) => f.file === from.slice(6));
      label = `#${index + 1}`;
      bytes = index >= 0 ? await readFile(framePath(studioDir(), draft, from.slice(6))).catch(() => null) : null;
    }
    if (!bytes) return fail(send, "Pick the picture to draw from.");
    const url = checkBackendUrl(deps.settings.studioBackend);
    if (!url) return fail(send, "Choose an image maker first (the Image maker list).");
    const checked = await check();
    if (!checked.ok) return fail(send, checked.reason);
    const request: FrameRequest = { id: `frame-${randomBytes(4).toString("hex")}`, activity: { id: draft.id, from: label }, source: draft.source, frame: frameName(draft.name, draft.frames.length + 1), name: "", shipped: false, change, bytes, info: checked.info, url };
    if (isLocal(url) || url === ASSISTED) return void (await frameDraw(request, send));
    frameAsk = request;
    deps.broadcast(frameAskMessage());
  }

  /** The yes on a picture of an activity: it joins the end of the loop, in the working folder. Nothing of the pack is touched. */
  async function activityAccept(review: NonNullable<typeof frameReview>, send: Send): Promise<void> {
    try {
      const draft = review.activity ? await readDraft(studioDir(), review.activity.id) : null;
      if (!draft) return fail(send, "That activity is not there any more.");
      await addFrame(studioDir(), draft, await encodeWebp(review.picture, { lossless: true }), { change: review.change, from: review.activity?.from ?? "", model: review.model });
      frameReview = null;
      deps.broadcast({ type: "studio-activity-added", id: draft.id });
      await activityShow(draft);
      void announce();
    } catch (error) {
      fail(send, error);
    }
  }

  /** The loop picture at its full size for the pointer to enlarge. */
  async function activityFull(msg: Record<string, unknown>, send: Send): Promise<void> {
    const draft = isDraftId(msg.id) ? await readDraft(studioDir(), msg.id) : null;
    if (!draft || !isFileId(msg.file)) return;
    const talk = msg.talk === true;
    const bytes = await readFile(framePath(studioDir(), draft, msg.file, talk)).catch(() => null);
    if (bytes) send({ type: "studio-activity-full", id: draft.id, file: msg.file, talk, image: `data:image/webp;base64,${bytes.toString("base64")}` });
  }

  /** Talking versions of the loop's pictures (her mouth open), by the pack's own mouth (`script`) or by the model (`how: "model"`, an image model on this computer only). */
  async function activityTalk(msg: Record<string, unknown>, send: Send): Promise<void> {
    if (running || waiting || pending || frameBusy || frameAsk) return fail(send, "Finish or stop the job that is open first.");
    if (frameReview) return fail(send, "Keep or drop the picture that is drawn first.");
    const draft = isDraftId(msg.id) ? await readDraft(studioDir(), msg.id) : null;
    if (!draft || draft.frames.length === 0) return fail(send, "Draw the loop's pictures first.");
    const how = msg.how === "model" ? "model" : "script";
    // Paste-back for the model's talking versions: off unless the user turned it on (the whole picture is kept then).
    const pasteBack = msg.pasteBack === true;
    const url = checkBackendUrl(deps.settings.studioBackend);
    if (how === "model" && !(url && isLocal(url))) return fail(send, "Talking pictures by a model need an image model on this computer (the Image maker list). The script way works with any maker.");
    if (how === "model" && !(await check()).ok) return fail(send, "The image model on this computer is not answering. Start it, or use the script way.");
    const mouth = await deps.readSource(draft.source);
    if (!mouth) return fail(send, `The ${draft.source} pack is not there any more.`);
    if (msg.redo === true) await clearTalk(studioDir(), draft);
    const todo = draft.frames.filter((f) => !draft.talk.includes(f.file));
    if (todo.length === 0) return fail(send, "Every picture has a talking version already.");
    frameBusy = true;
    const abort = (frameAbort = new AbortController());
    try {
      for (const [i, f] of todo.entries()) {
        if (abort.signal.aborted) break;
        deps.broadcast({ type: "studio-activity-progress", id: draft.id, text: `Talking version ${i + 1} of ${todo.length}…` });
        const bytes = await readFile(framePath(studioDir(), draft, f.file));
        const seed = (randomBytes(4).readUInt32LE() % 2147483646) + 1;
        const done = how === "script" ? await talkByScript(bytes, mouth) : await talkByModel(bytes, mouth, seed, backendFor(url as string), abort.signal, pasteBack);
        if (!done) return fail(send, `The ${draft.source} pack has no mouth pictures to learn her mouth from. Draw the talking pictures one by one instead.`);
        await setTalk(studioDir(), draft, f.file, done);
        await activityShow(draft);
      }
    } catch (error) {
      if (!abort.signal.aborted) fail(send, error);
    } finally {
      frameBusy = false;
      if (frameAbort === abort) frameAbort = null;
      deps.broadcast({ type: "studio-activity-progress", id: draft.id, text: "" });
      await activityShow((await readDraft(studioDir(), draft.id)) ?? draft);
      void announce();
    }
  }

  /** The yes on the whole activity: its pictures go into the pack as `activity-<name>-N` (and `-talk-N`), never over a picture the pack has. */
  async function activitySave(id: unknown, send: Send): Promise<void> {
    const draft = isDraftId(id) ? await readDraft(studioDir(), id) : null;
    if (!draft) return fail(send, "That activity is not there any more.");
    if (frameBusy || frameReview?.activity?.id === draft.id) return fail(send, "Stop or finish the picture that is being drawn first.");
    if (draft.frames.length < 2) return fail(send, "A loop needs at least two pictures.");
    if (draft.talk.length && draft.talk.length !== draft.frames.length) return fail(send, "Some pictures have a talking version and some do not. Make them for all, or start the talking pictures over.");
    const folder = await deps.packFolder(draft.source);
    if (!folder) return fail(send, `The ${draft.source} pack is not there any more.`);
    if (await activityTaken(draft.source, draft.name)) return fail(send, `The ${draft.source} pack has an activity called ${draft.name} already. Rename this one.`);
    const written: string[] = [];
    let own = folder;
    try {
      own = await ownCopy(folder, draft.source, draft.id);
      const at = new Date().toISOString();
      for (const [i, f] of draft.frames.entries()) {
        for (const talk of draft.talk.length ? [false, true] : [false]) {
          const name = frameName(draft.name, i + 1, talk);
          await addPicture(own, name, await readFile(framePath(studioDir(), draft, f.file, talk)), { at, change: f.change, model: f.model });
          written.push(name);
        }
      }
    } catch (error) {
      for (const name of written) await restoreOriginal(own, name).catch(() => false);
      return fail(send, error);
    }
    await deleteDraft(studioDir(), draft.id);
    await deps.refreshPacks();
    await deps.reloadPack?.(draft.source);
    deps.pushNote(`the user made an activity "${draft.name}" (${draft.frames.length} pictures${draft.talk.length ? ", with talking versions" : ""}) for their ${draft.source} pack on their computer.`);
    deps.broadcast({ type: "studio-activity-saved", id: draft.id, source: draft.source, name: draft.name, count: draft.frames.length, talk: draft.talk.length > 0, shipped: !isOwnFolder(folder) });
    void announce();
  }

  async function accept(id: string, send: Send): Promise<void> {
    if (!waiting || waiting.kind !== "review" || waiting.job.id !== id || running) return send({ type: "studio-error", message: "There is no finished pack to use." });
    await install(waiting);
  }

  /** Drops the job that waits for the user (base pictures to pick from, or a finished pack to accept), with its working files. Nothing was written to data/frames yet, so a new pack can be started at once. */
  async function discardReview(id: string, send: Send): Promise<void> {
    if (!waiting || waiting.job.id !== id || running) return send({ type: "studio-error", message: "There is no pack to discard." });
    const dir = waiting.dir;
    forget();
    await rm(dir, { recursive: true, force: true });
    await announce();
  }

  /** A picture at its full size for the pointer to enlarge: only of the job that is open, only a name this job can have, only from its folder. */
  async function full(id: string, name: unknown, send: Send): Promise<void> {
    const job = running?.job ?? waiting?.job;
    const dir = running?.dir ?? waiting?.dir;
    if (!job || !dir || job.id !== id || typeof name !== "string") return;
    const seed = /^seed-(\d{1,10})$/.exec(name);
    const file = seed ? join(dir, `base/seed-${seed[1]}.full.webp`) : name === "neutral" || knownFrameNames().has(name) ? join(dir, `review/${name}.full.webp`) : null;
    if (!file) return;
    const bytes = await readFile(file).catch(() => null);
    if (bytes) send({ type: "studio-full", id, name, image: `data:image/webp;base64,${bytes.toString("base64")}` });
  }

  /** Turns the studio on (after checking the backend) and opens the panel. From `/studio on`, or from the yes to the question her proposal raises. */
  async function turnOn(say: Say, reply: (msg: unknown) => void): Promise<void> {
    if (disabled) return say("The pack studio is turned off (COMPANION_NO_STUDIO).");
    const checked = await check();
    if (!checked.ok) {
      // Not usable yet (no image maker chosen, a model that is not running, a key that is missing): the studio still opens, because its
      // "Image maker" list is the way to choose another one. Nothing is drawn before the next question checks again (`start`, `resume`).
      on = true;
      await announce();
      reply({ type: "studio-open" });
      return say(`${checked.reason}\n\nThe pack studio is open anyway: choose another image maker in its list, and the next question checks it. It is off again after a restart.`);
    }
    on = true;
    await announce();
    reply({ type: "studio-open" });
    say(
      checked.info.browser
        ? `The pack studio is on, drawing with ${describe(checked.info)}. ${browserNote(checked.info)} ${RESPONSIBILITY} It is off again after a restart.`
        : checked.info.paid
        ? `The pack studio is on, drawing with ${describe(checked.info)}. THIS IS PAID: every picture is charged by ${checked.info.paid.host} to the account of your ${checked.info.paid.keyName}, and your source pictures are sent there. The limit is ${dollars(budget())} per pack (/studio budget changes it). Keeping the key safe is your responsibility. ${RESPONSIBILITY} It is off again after a restart.`
        : `The pack studio is on, drawing with ${describe(checked.info)}. It makes draft packs on this computer. ${RESPONSIBILITY} It is off again after a restart.`,
    );
  }

  /** The page's "Image maker" list: switches the backend for the next question (nothing is checked or started here: the approval card names what it will use). */
  async function chooseBackend(value: unknown, send: Send): Promise<void> {
    if (running) return send({ type: "studio-error", message: "A job is running. Stop it first." });
    const url = typeof value === "string" && backendChoices().some((c) => c.value === value) ? checkBackendUrl(value) : null;
    if (!url) return send({ type: "studio-error", message: "That is not one of the image makers." });
    setBackend(url);
    await deps.saveSettings();
    pending = null;
    await announce();
  }

  /** Removes a job of an earlier session from the disk (only one that is listed as carry-on-able, never the open one). Packs already installed are not touched. */
  async function discard(id: string, send: Send): Promise<void> {
    if (running || waiting || pending) return send({ type: "studio-error", message: "Finish or stop the job that is open first." });
    if (!(await findJobs()).some((j) => j.id === id)) return send({ type: "studio-error", message: "That job is not there any more." });
    await rm(join(deps.dataDir, "studio", id), { recursive: true, force: true });
    await announce();
  }

  /** Carries on a job from an earlier session, from whatever is on disk. */
  async function resume(id: string, send: Send): Promise<void> {
    if (running || waiting || pending) return send({ type: "studio-error", message: "Finish or stop the job that is open first." });
    const wanted = (await findJobs()).find((j) => j.id === id);
    if (!wanted) return send({ type: "studio-error", message: "That job cannot be carried on." });
    const checked = await check();
    if (!checked.ok) return send({ type: "studio-error", message: checked.reason });
    const dir = join(deps.dataDir, "studio", id);
    const parsed = parseJob(JSON.parse(await readFile(join(dir, "job.json"), "utf8")));
    if (!parsed.ok) return send({ type: "studio-error", message: parsed.reason });
    const job: Job = { ...parsed.job, backend: { ...parsed.job.backend, url: deps.settings.studioBackend ?? parsed.job.backend.url } };
    forget();
    spent = await readSpend(dir);
    if (wanted.stage === "pick") {
      const candidates: number[] = [];
      for (const seed of job.seeds) {
        const file = await readFile(join(dir, `base/seed-${seed}.thumb.webp`)).catch(() => null);
        if (file) (candidates.push(seed), shown.set(seed, `data:image/webp;base64,${file.toString("base64")}`));
      }
      lastText = "Pick the one you like. Nothing is saved until you do." + (checked.info.paid ? ` ${paidProjection(spent, job.seeds.length)}` : "");
      waiting = { kind: "pick", job, dir, info: checked.info, candidates, review: null };
      return void (await announce());
    }
    startWorker(job, dir, wanted.stage === "review" ? "assemble" : "build", checked.info, {});
  }

  function cancel(): void {
    frameAbort?.abort();
    stopRunning();
    deps.broadcast({ type: "studio-cancelled" });
    void announce();
  }

  return {
    enabled: () => on,
    stateMessage,

    /** A note for her next message: what the studio is and how to propose to it (once per conversation and state, chat mode). */
    note(): string | null {
      const state = on ? "on" : "off";
      if (disabled || deps.mode() !== "chat" || told === state) return null;
      told = state;
      const text = SKILL.trim().replace(/\s*\n\s*/g, " ");
      // Off, she still knows it exists: a proposal then makes the page ask whether to turn it on (`studio-ask`).
      const intro = on ? text : text.replace("The pack studio is on:", "The pack studio exists but is turned off right now:");
      const off = on ? "" : " Because it is off, your tag makes the page ask the user whether to turn it on; say so, and do not claim it has started.";
      return `${intro}${off} Packs you can draw from: ${knownSources.join(", ") || "(none yet)"}.`;
    },

    /** A new conversation is told again, and a proposal that was waiting is dropped. */
    forgetTold(): void {
      told = null;
      proposal = null;
    },

    /** Handles each new complete [studio …] tag of a reply (a proposal; nothing is started). */
    makeApplier(): (reply: string) => void {
      let seen = 0;
      return (reply) => {
        const tags = findStudioTags(reply);
        for (; seen < tags.length; seen++) void propose(tags[seen]).catch(() => {});
      };
    },
    close: () => {
      stopRunning();
      void local.stop();
    },

    /** `/studio`: on, off, backend, or open the panel. */
    async command(args: string, say: Say, remote: boolean, reply: (msg: unknown) => void): Promise<void> {
      if (remote) return say(deps.remoteRefusal());
      if (disabled) return say("The pack studio is turned off (COMPANION_NO_STUDIO).");
      const [word, ...rest] = args.trim().split(/\s+/);
      if (word === "backend") {
        if (rest.length === 0) return say(`Image backend: ${deps.settings.studioBackend ?? "(none)"}`);
        const url = checkBackendUrl(rest[0]);
        if (!url) return say("The image backend has to be plain http on this computer, like http://127.0.0.1:7861, or the name of a paid service: xai, gemini or openai (each needs its API key, XAI_API_KEY, GEMINI_API_KEY or OPENAI_API_KEY, in this app's environment), grok-web / gemini-web / chatgpt-web (a website through Claude in Chrome: needs Claude Code and its Chrome extension), or assisted (you draw each picture by hand with any website or tool).");
        setBackend(url);
        await deps.saveSettings();
        void announce(); // an open panel shows the new choice
        if (url === ASSISTED) return say("Image maker set to by hand: for each picture the panel shows the picture and the words, you draw it with any website or tool you like and give the result back. /studio on checks it.");
        if (BROWSER_BACKENDS.includes(url)) return say(`Image backend set to the ${url === GEMINI_WEB ? "Google Gemini" : url === CHATGPT_WEB ? "ChatGPT" : "Grok Imagine"} website, driven through Claude in Chrome (it uses Claude Code and your Chrome). /studio on checks it and says what it costs you.`);
        return say(PAID_SERVICES.includes(url) ? `Image backend set to ${url} (a paid web service). /studio on checks the key and says what it costs.` : `Image backend set to ${url}. /studio on checks it.`);
      }
      if (word === "python" || word === "server") {
        const key = word === "python" ? "studioPython" : "studioServer";
        if (rest.length === 0) return say(`${word === "python" ? "Python for the local image model" : "Server script"}: ${deps.settings[key] ?? "(not set)"}. /studio ${word} <whole path> sets it, /studio ${word} none clears it. Nothing is started from it: the app only shows the command (docs: A model on your computer).`);
        const text = rest.join(" ");
        if (text === "none") deps.settings[key] = null;
        else {
          const path = checkPath(text);
          if (!path) return say("Give the whole path, on one line, without quotes.");
          if (!(await stat(path).then((s) => s.isFile(), () => false))) return say(`${path} is not a file on this computer.`);
          deps.settings[key] = path;
        }
        await deps.saveSettings();
        const { studioPython: python, studioServer: server } = deps.settings;
        return say(python && server ? `The command to start it: ${startCommand(python, server, localAddress())}` : `${word === "python" ? "Python" : "Server script"} ${deps.settings[key] ? "saved" : "cleared"}.`);
      }
      if (word === "handover") {
        const active = deps.activeSource() ?? deps.drawnSource?.() ?? null;
        const prompt = handoverPrompt({ source: active, outfit: rest.join(" ") });
        // While she is the drawn avatar there is no picture of her to attach: say which pictures there are.
        const packs = active ? [] : (await deps.sources()).slice(0, 8);
        const which = active
          ? ` (${active}: its folder is data/frames/${active}/ or packs/${active}/ in the app's folder)`
          : `. She is the drawn avatar now, so there is no picture of her to attach: take the neutral picture of a pack (${packs.length ? `${packs.join(", ")}: the file neutral.webp in data/frames/<pack>/ or packs/<pack>/ in the app's folder` : "none is on this computer yet: /frames lists the ones you can download"}), or a picture of the character you want`;
        // The prompt itself goes to the page as its own message, which shows it with a Copy button; the notice says what to do with it.
        reply({ type: "studio-handover", prompt, guide: HANDOVER_GUIDE, inChat: true });
        return say(
          `A handover prompt for an AI agent that can make pictures (a chat website, an agent, whatever you use): copy it below and attach the neutral picture of the pack you want to start from${which}. It links to the guide the agent follows (${HANDOVER_GUIDE}).${rest.length === 0 ? " Add your outfit in /studio handover <outfit words> to have it filled in." : ""} Nothing is sent from here: you copy it, and what the agent makes is yours to check and yours to answer for.`,
        );
      }
      if (word === "budget") {
        if (rest.length === 0) return say(`A pack made with a paid image service may cost up to ${dollars(budget())}. /studio budget <dollars> changes it (0.5 to 200).`);
        const n = Number(rest[0].replace(/^\$/, ""));
        if (!Number.isFinite(n) || n < 0.5 || n > 200) return say("The limit has to be between 0.5 and 200 dollars.");
        deps.settings.studioBudgetUsd = n;
        await deps.saveSettings();
        return say(`A pack made with a paid image service may now cost up to ${dollars(n)}.`);
      }
      if (word === "off") {
        frameAsk = null;
        stopRunning();
        await local.stop();
        proposal = null;
        on = false;
        await announce();
        return say("The pack studio is off.");
      }
      if (word === "on") return turnOn(say, reply);
      if (!on) return say(`The pack studio is off. /studio backend <address> sets the image backend, /studio on turns it on, /studio handover gives a prompt for any AI agent. It makes picture packs of your own on this computer (docs/pack-studio.md).`);
      reply({ type: "studio-open" });
    },

    /** A message from the page. */
    async message(msg: Record<string, unknown>, send: Send, remote: boolean): Promise<void> {
      if (remote) return send({ type: "notice", text: deps.remoteRefusal() });
      if (msg.type === "studio-on") return turnOn((text) => send({ type: "notice", text }), send);
      if (!on) return send({ type: "studio-error", message: "The pack studio is off. Type /studio on." });
      try {
        if (msg.type === "studio-start") await start(msg, send);
        else if (msg.type === "studio-confirm" && typeof msg.id === "string") await confirm(msg.id, send);
        else if (msg.type === "studio-pick" && typeof msg.id === "string" && Number.isInteger(msg.seed)) await pick(msg.id, msg.seed as number, send, msg.pasteBack === true);
        else if (msg.type === "studio-base-use" && typeof msg.id === "string" && Number.isInteger(msg.seed)) await baseUse(msg.id, msg.seed as number, send);
        else if (msg.type === "studio-polish") await polish(msg, send);
        else if (msg.type === "studio-base-more" && typeof msg.id === "string") await moreBase(msg, send);
        else if (msg.type === "studio-step") await step(msg, send);
        else if (msg.type === "studio-step-keep" && typeof msg.id === "string" && Number.isInteger(msg.n) && Number.isInteger(msg.seed)) await stepKeep(msg.id, msg.n as number, msg.seed as number, send);
        else if (msg.type === "studio-step-undo" && typeof msg.id === "string") await stepUndo(msg.id, send);
        else if (msg.type === "studio-step-suggest" && typeof msg.id === "string") await stepSuggest(msg.id, send);
        else if (msg.type === "studio-base-approve" && typeof msg.id === "string") await approve(msg.id, send, msg.pasteBack === true);
        else if (msg.type === "studio-regen" && typeof msg.id === "string") await regenerate(msg.id, msg.names, send, msg.sameSeed === true, msg.seed, msg.pasteBack === true);
        else if (msg.type === "studio-variant" && typeof msg.id === "string") await switchVersion(msg.id, msg.name, msg.variant, send);
        else if (msg.type === "studio-resume" && typeof msg.id === "string") await resume(msg.id, send);
        else if (msg.type === "studio-backend") await chooseBackend(msg.value, send);
        else if (msg.type === "studio-handover") send({ type: "studio-handover", prompt: handoverPrompt({ source: typeof msg.source === "string" ? msg.source : null, name: typeof msg.name === "string" ? msg.name : undefined, outfit: typeof msg.outfit === "string" ? msg.outfit : undefined }), guide: HANDOVER_GUIDE });
        else if (msg.type === "studio-discard" && typeof msg.id === "string") await discard(msg.id, send);
        else if (msg.type === "studio-full" && typeof msg.id === "string") await full(msg.id, msg.name, send);
        else if (msg.type === "studio-accept" && typeof msg.id === "string") await accept(msg.id, send);
        else if (msg.type === "studio-review-discard" && typeof msg.id === "string") await discardReview(msg.id, send);
        else if (msg.type === "studio-frame-edit") await frameStart(msg, send);
        else if (msg.type === "studio-frame-go" && typeof msg.id === "string") await frameGo(msg.id, send);
        else if (msg.type === "studio-frame-ask-cancel") {
          frameAsk = null;
          send({ type: "studio-frame-cancelled" });
        } else if (msg.type === "studio-frame-accept" && typeof msg.id === "string") await frameAccept(msg.id, send);
        else if (msg.type === "studio-frame-reject" && typeof msg.id === "string") frameReject(msg.id);
        else if (msg.type === "studio-frame-restore") await frameRestore(msg, send);
        else if (msg.type === "studio-activity-new") await activityNew(msg, send);
        else if (msg.type === "studio-activity-open") await activityOpen(msg.id, send);
        else if (msg.type === "studio-activity-rename") await activityRename(msg, send);
        else if (msg.type === "studio-activity-delete") await activityDelete(msg.id, send);
        else if (msg.type === "studio-activity-remove") await activityRemove(msg, send);
        else if (msg.type === "studio-activity-draw") await activityDraw(msg, send);
        else if (msg.type === "studio-activity-full") await activityFull(msg, send);
        else if (msg.type === "studio-activity-talk") await activityTalk(msg, send);
        else if (msg.type === "studio-activity-save") await activitySave(msg.id, send);
        else if (msg.type === "studio-assist-result") await assistResult(msg);
        else if (msg.type === "studio-export" || msg.type === "studio-import") await transfer(msg, send);
        else if (msg.type === "studio-local-config") await localConfig(msg, send);
        else if (msg.type === "studio-local-start") await localStart(msg, send);
        else if (msg.type === "studio-local-confirm" && typeof msg.id === "string") await localConfirm(msg.id, send);
        else if (msg.type === "studio-local-cancel") {
          localAsk = null;
          void announce();
        } else if (msg.type === "studio-local-stop") {
          localAsk = null;
          await local.stop();
        } else if (msg.type === "studio-cancel") cancel();
        else if (msg.type === "studio-state") send(await stateMessage());
      } catch (error) {
        send({ type: "studio-error", message: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

/** A folder copied whole into a staging folder beside the job's, then renamed into place, so a half-written pack never shows up in data/frames. */
/** The command that starts the user's own backend, as text to copy (the port is the address's). Whole paths have no quotes (`checkPath`), so only spaces need care. */
export function startCommand(python: string, server: string, address: string): string {
  const port = /:(\d+)/.exec(address)?.[1] ?? "7861";
  const part = (path: string) => (/\s/.test(path) ? `"${path}"` : path);
  return `${part(python)} ${part(server)} --port ${port}`;
}

async function copyDir(from: string, staging: string, to: string): Promise<void> {
  await rm(staging, { recursive: true, force: true });
  await cp(from, staging, { recursive: true });
  await rename(staging, to);
}
