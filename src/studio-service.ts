import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { isPackName } from "./frame-pack.ts";
import type { Broadcast, Say } from "./server-types.ts";
import { BackendError, checkBackendUrl, httpBackend, type BackendInfo, type ImageBackend } from "./studio/backend.ts";
import { pickKey } from "./studio/cutout.ts";
import { cleanText, MAX_OUTFIT, parseJob, type Job } from "./studio/job.ts";
import { decode } from "./studio/raster.ts";
import type { StudioEvent } from "./studio/runner.ts";

/** What the pack studio needs from the server around it. */
export interface StudioDeps {
  /** data/ */
  dataDir: string;
  /** data/frames: where a finished pack is installed. */
  framesDir: string;
  settings: { studioBackend: string | null };
  saveSettings(): Promise<void>;
  broadcast: Broadcast;
  remoteRefusal(): string;
  /** The packs a new one can be drawn from (all of them, shipped and installed). */
  sources(): Promise<string[]>;
  /** The neutral picture of a pack as bytes, and the character its look.txt names. Null when there is none. */
  readSource(name: string): Promise<{ neutral: Buffer; character: string | null } | null>;
  /** Tell the page about the packs again (a new one is there). */
  refreshPacks(): Promise<void>;
  /** Something to tell her with her next message. */
  pushNote(text: string): void;
  /** Tests give a stand-in; the app builds the HTTP client. */
  makeBackend?: (url: string) => ImageBackend;
  workerUrl?: URL;
}

type Send = (msg: unknown) => void;

interface Pending {
  job: Job;
  source: Buffer;
  info: BackendInfo;
}

interface Running {
  job: Job;
  dir: string;
  worker: Worker;
  phase: "base" | "neutral";
  candidates: number[];
  info: BackendInfo;
}

/** What the user is told before anything is drawn, and again with the result. */
export const RESPONSIBILITY =
  "You are responsible for what is drawn and for which image model you use. The app adds no filter of its own, and the model's own terms apply to every picture.";

/**
 * The pack studio: pictures of a character in a new outfit, made on this computer by an image model the user runs (docs/pack-studio.md).
 *
 * It is a draft maker with an off switch. Off at every start, refused from a phone, one job at a time, and nothing is drawn before the user has
 * read a card that names the backend, the model and the folder. The brain has no part in it yet; the page's form is the only way in.
 */
export function createStudioService(deps: StudioDeps) {
  let on = false;
  let pending: Pending | null = null;
  let running: Running | null = null;
  /** After the base pictures are made and before one is picked. */
  let pendingPick: { job: Job; dir: string; info: BackendInfo; candidates: number[] } | null = null;
  const disabled = process.env.COMPANION_NO_STUDIO === "1";
  const backendFor = (url: string): ImageBackend => (deps.makeBackend ? deps.makeBackend(url) : httpBackend(url));

  async function stateMessage() {
    return {
      type: "studio-state",
      on,
      backend: deps.settings.studioBackend,
      sources: on ? await deps.sources() : [],
      running: running ? { id: running.job.id, name: running.job.name, phase: running.phase } : null,
    };
  }
  const announce = async () => deps.broadcast(await stateMessage());

  async function check(): Promise<{ ok: true; info: BackendInfo } | { ok: false; reason: string }> {
    const url = checkBackendUrl(deps.settings.studioBackend);
    if (!url) return { ok: false, reason: "No image backend is set. Start one on this computer and give its address: /studio backend http://127.0.0.1:7861" };
    try {
      const info = await backendFor(url).info();
      if (!info.edit) return { ok: false, reason: "That backend cannot change a picture (it has no /edit), which a redraw needs." };
      return { ok: true, info };
    } catch (error) {
      return { ok: false, reason: error instanceof BackendError || error instanceof Error ? error.message : String(error) };
    }
  }

  const describe = (info: BackendInfo) => `${info.name}${info.model ? `, model ${info.model}` : ""}${info.licence ? ` (${info.licence})` : ""}`;

  function stopRunning(): void {
    pending = null;
    pendingPick = null;
    if (!running) return;
    void running.worker.terminate();
    running = null;
  }

  function startWorker(job: Job, dir: string, phase: "base" | "neutral", info: BackendInfo, data: Record<string, unknown>): void {
    const worker = new Worker(deps.workerUrl ?? new URL("./studio/studio-worker.ts", import.meta.url), {
      workerData: { phase, dir, job, ...data },
      stderr: true,
    });
    worker.unref();
    const run: Running = { job, dir, worker, phase, candidates: [], info };
    running = run;
    void announce();
    worker.on("message", async (event: StudioEvent | { type: "finished" }) => {
      if (running !== run) return;
      if (event.type === "status") deps.broadcast({ type: "studio-progress", id: job.id, text: event.text });
      else if (event.type === "candidate") {
        run.candidates.push(event.seed);
        const thumb = await readFile(join(dir, event.thumb)).catch(() => null);
        deps.broadcast({ type: "studio-candidate", id: job.id, seed: event.seed, done: event.done, total: event.total, thumb: thumb ? `data:image/webp;base64,${thumb.toString("base64")}` : null });
      } else if (event.type === "base-done") deps.broadcast({ type: "studio-candidates-done", id: job.id });
      else if (event.type === "neutral-done") await install(run);
      else if (event.type === "error") {
        running = null;
        deps.broadcast({ type: "studio-error", id: job.id, message: event.message });
        void announce();
      } else if (event.type === "finished" && run.phase === "base") {
        // The pictures are made; which one is used comes next from the page.
        void run.worker.terminate();
        running = null;
        pendingPick = { job, dir, info, candidates: run.candidates };
        void announce();
      }
    });
    worker.on("error", (error) => {
      if (running !== run) return;
      running = null;
      deps.broadcast({ type: "studio-error", id: job.id, message: `The studio stopped: ${error.message}` });
      void announce();
    });
  }

  async function install(run: Running): Promise<void> {
    const { job, dir, info } = run;
    running = null;
    void run.worker.terminate();
    const out = join(dir, "out");
    try {
      const lookText = job.look || `You wear ${job.outfit}.`;
      await writeFile(join(out, "look.txt"), `${job.character ? `character: ${job.character}\n` : ""}${lookText}\n`);
      await writeFile(join(out, "credit.txt"), `${job.name}: made on this computer with AI (${info.model ?? info.name}), from the ${job.source} pack.\nMade with AI. See packs/${job.name}/NOTICE.md for the terms.\n`);
      await writeFile(
        join(out, "NOTICE.md"),
        `# ${job.name}\n\nA picture pack made on this computer with the app's pack studio, from the \`${job.source}\` pack, in a new outfit: ${job.outfit}.\n\n` +
          `**These pictures were made with AI**: ${describe(info)}${info.revision ? `, revision ${info.revision}` : ""}. The terms of that model apply to them, and ${RESPONSIBILITY[0].toLowerCase()}${RESPONSIBILITY.slice(1)}\n\n` +
          `A pack made like this is a draft and belongs to whoever made it. It is not part of the shared packs and is not published by the app.\n`,
      );
      const target = join(deps.framesDir, job.name);
      if (await stat(target).then(() => true, () => false)) throw new Error(`There is already a pack called ${job.name}. Nothing was replaced; start again with another name.`);
      await mkdir(deps.framesDir, { recursive: true });
      await rename(out, target);
      await deps.refreshPacks();
      deps.pushNote(`the user made a new picture pack on their computer, ${job.name} (${job.outfit}); it is a draft with only a neutral picture so far.`);
      deps.broadcast({ type: "studio-installed", id: job.id, name: job.name });
      void announce();
    } catch (error) {
      deps.broadcast({ type: "studio-error", id: job.id, message: error instanceof Error ? error.message : String(error) });
      void announce();
    }
  }

  async function start(msg: Record<string, unknown>, send: Send): Promise<void> {
    if (running) return send({ type: "studio-error", message: "A job is running. Stop it first." });
    pendingPick = null;
    const source = typeof msg.source === "string" ? msg.source : "";
    const name = typeof msg.name === "string" ? msg.name.trim() : "";
    const outfit = cleanText(msg.outfit, MAX_OUTFIT);
    const err = (message: string) => send({ type: "studio-error", message });
    if (!(await deps.sources()).includes(source)) return err("Pick one of your packs to draw from.");
    if (!isPackName(name) || name.startsWith(".")) return err("The new pack's name can have letters, digits, spaces and . _ - only.");
    if (await stat(join(deps.framesDir, name)).then(() => true, () => false)) return err(`There is already a pack called ${name}. Pick another name.`);
    if (outfit.length < 3) return err("Describe the outfit in a few words.");
    const checked = await check();
    if (!checked.ok) return err(checked.reason);
    const found = await deps.readSource(source);
    if (!found) return err(`The ${source} pack has no neutral picture to draw from.`);
    const picture = await decode(found.neutral);
    const { key } = pickKey(picture);
    const height = 1024;
    const width = Math.min(1536, Math.max(256, Math.round(((picture.w / picture.h) * height) / 16) * 16));
    const parsed = parseJob({
      id: `job-${randomBytes(4).toString("hex")}`,
      kind: "redraw",
      name,
      source,
      character: found.character,
      outfit,
      look: `You wear ${outfit}.`,
      key,
      width,
      height,
      backend: { url: deps.settings.studioBackend, name: checked.info.name, model: checked.info.model, revision: checked.info.revision, licence: checked.info.licence },
      seeds: [1, 2, 3, 4],
    });
    if (!parsed.ok) return err(parsed.reason);
    pending = { job: parsed.job, source: found.neutral, info: checked.info };
    send({
      type: "studio-confirm",
      id: parsed.job.id,
      name,
      source,
      outfit: parsed.job.outfit,
      backend: describe(checked.info),
      folder: join(deps.framesDir, name),
      pictures: parsed.job.seeds.length,
      note:
        `This draws ${parsed.job.seeds.length} pictures of ${source} in that outfit with ${describe(checked.info)} on this computer. Each takes seconds to a few minutes, and the first may load the model (the reference backend needs about 22 GB of memory). ` +
        `You pick one; only then is a pack written, to ${join(deps.framesDir, name)}. ${RESPONSIBILITY}`,
    });
  }

  async function confirm(id: string, send: Send): Promise<void> {
    if (!pending || pending.job.id !== id || running) return send({ type: "studio-error", message: "That question is no longer open." });
    const { job, source, info } = pending;
    pending = null;
    const dir = join(deps.dataDir, "studio", job.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "job.json"), JSON.stringify(job, null, 2));
    startWorker(job, dir, "base", info, { source });
    send({ type: "studio-progress", id: job.id, text: "Starting…" });
  }

  async function pick(id: string, seed: number, send: Send): Promise<void> {
    if (!pendingPick || pendingPick.job.id !== id || running || !pendingPick.candidates.includes(seed)) return send({ type: "studio-error", message: "That picture is not available." });
    const { job, dir, info } = pendingPick;
    pendingPick = null;
    startWorker(job, dir, "neutral", info, { seed });
  }

  function cancel(): void {
    stopRunning();
    deps.broadcast({ type: "studio-cancelled" });
    void announce();
  }

  return {
    enabled: () => on,
    stateMessage,
    close: () => stopRunning(),

    /** `/studio`: on, off, backend, or open the panel. */
    async command(args: string, say: Say, remote: boolean, reply: (msg: unknown) => void): Promise<void> {
      if (remote) return say(deps.remoteRefusal());
      if (disabled) return say("The pack studio is turned off (COMPANION_NO_STUDIO).");
      const [word, ...rest] = args.trim().split(/\s+/);
      if (word === "backend") {
        if (rest.length === 0) return say(`Image backend: ${deps.settings.studioBackend ?? "(none)"}`);
        const url = checkBackendUrl(rest[0]);
        if (!url) return say("The image backend has to be plain http on this computer, like http://127.0.0.1:7861.");
        deps.settings.studioBackend = url;
        await deps.saveSettings();
        return say(`Image backend set to ${url}. /studio on checks it.`);
      }
      if (word === "off") {
        stopRunning();
        on = false;
        await announce();
        return say("The pack studio is off.");
      }
      if (word === "on") {
        const checked = await check();
        if (!checked.ok) return say(checked.reason);
        on = true;
        await announce();
        reply({ type: "studio-open" });
        return say(
          `The pack studio is on, drawing with ${describe(checked.info)}. It makes draft packs on this computer. ${RESPONSIBILITY} It is off again after a restart.`,
        );
      }
      if (!on) return say(`The pack studio is off. /studio backend <address> sets the image backend, /studio on turns it on. It makes picture packs of your own on this computer (docs/pack-studio.md).`);
      reply({ type: "studio-open" });
    },

    /** A message from the page. */
    async message(msg: Record<string, unknown>, send: Send, remote: boolean): Promise<void> {
      if (remote) return send({ type: "notice", text: deps.remoteRefusal() });
      if (!on) return send({ type: "studio-error", message: "The pack studio is off. Type /studio on." });
      try {
        if (msg.type === "studio-start") await start(msg, send);
        else if (msg.type === "studio-confirm" && typeof msg.id === "string") await confirm(msg.id, send);
        else if (msg.type === "studio-pick" && typeof msg.id === "string" && Number.isInteger(msg.seed)) await pick(msg.id, msg.seed as number, send);
        else if (msg.type === "studio-cancel") cancel();
        else if (msg.type === "studio-state") send(await stateMessage());
      } catch (error) {
        send({ type: "studio-error", message: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

