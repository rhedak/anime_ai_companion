import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { GESTURES, framesRequest, gestureRequest } from "../public/frames.js";

type Character = Record<string, any>;

export interface PatchResult {
  applied: string[];
  rejected: { key: string; reason: string }[];
}

export interface AvatarOptions {
  /** The anime-character-creator's TypeScript, its `ts/src` directory (it is imported by path, never modified). */
  creatorSrc: string;
  /** The module the renderer thread runs. Tests give a stand-in; the default is src/render-worker.ts. */
  workerPath?: string | URL;
  /** How long a request may take before the renderer thread is cut off, in milliseconds. 15 seconds unless a test says less. */
  timeoutMs?: number;
  statePath: string;
  /** Folder for the user's saved looks, one JSON file each. */
  looksDir: string;
  emotions: Record<string, Record<string, number>>;
  defaultPreset: string;
}

export const GESTURE_NAMES = Object.keys(GESTURES);

interface Schema {
  presets: string[];
  hairstyles: string[];
  top: Record<string, { type: string }>;
  face: Record<string, { type: string }>;
  outfit: Record<string, { type: string }>;
}

const hashOf = (character: Character): string => createHash("sha256").update(JSON.stringify(character)).digest("hex");

/** Owns the renderer thread (the creator's TypeScript, run by src/render-worker.ts), the current character and its rendered frames. */
export class AvatarService {
  character: Character = {};
  /** Bumps whenever the character changes, so clients know cached frames are stale. */
  version = 0;
  schema!: Schema;

  private readonly opts: AvatarOptions;
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { worker: Worker; resolve: (v: any) => void; reject: (e: Error) => void }>();
  private frameCache = new Map<string, string[]>();
  /** Earlier looks, newest last, so a redesign can be undone. */
  private history: { character: Character; base: string | null; baseHash: string | null; pristine: boolean }[] = [];
  /**
   * Hash of what the creator's preset `basePreset` was when this look came from it, and whether the look is still exactly that preset (no change since). A creator update
   * that redraws the preset is then noticed: an untouched look is refreshed, any other is left as the user made it. Null for a look saved before this was kept.
   */
  private baseHash: string | null = null;
  private pristine = false;
  /** Set at start when the saved look came before presets were tracked and the creator's preset is not that look: the page asks once whether to reload it. */
  refreshOffer: { preset: string; hash: string } | null = null;
  /** Set at start when an untouched preset look was redrawn because the creator's preset changed (the preset's name); the server tells her and the user once. */
  refreshed: string | null = null;
  /** The built-in character the look started from (a tweak keeps it), or null: a saved look, or one from before this was kept. */
  basePreset: string | null = null;
  lookNames: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: AvatarOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.schema = await this.call("schema", {});
    try {
      const state = JSON.parse(await readFile(this.opts.statePath, "utf8"));
      this.character = state.character;
      this.basePreset = typeof state.base === "string" ? state.base : null;
      this.baseHash = typeof state.baseHash === "string" ? state.baseHash : null;
      this.pristine = state.pristine === true;
      await this.checkPreset(Boolean(state.baseHash)).catch(() => {}); // a failed comparison must not cost the saved look
    } catch {
      this.character = (await this.call("base", { name: this.opts.defaultPreset })).character;
      this.basePreset = this.opts.defaultPreset;
      this.baseHash = hashOf(this.character);
      this.pristine = true;
      await this.persist(); // so the preset it came from is known when the creator changes
    }
    await this.listLooks();
  }

  /**
   * The saved look is a whole character, so a creator update that redraws the preset it came from changed nothing on screen. Compare it with the preset as the creator draws it now:
   * the same look is only marked; an untouched one is redrawn; one the user changed is kept; one saved before this was tracked cannot be told apart, so the page is to ask.
   */
  private async checkPreset(tracked: boolean): Promise<void> {
    const preset = this.basePreset;
    if (!preset || !this.presetNames.includes(preset)) return;
    const fresh = (await this.call("base", { name: preset })).character as Character;
    const hash = hashOf(fresh);
    if (hashOf(this.character) === hash) {
      this.baseHash = hash;
      this.pristine = true;
      return this.persist();
    }
    if (this.baseHash === hash) return; // the preset is unchanged: the look is the user's own
    if (!tracked) {
      this.refreshOffer = { preset, hash };
      return;
    }
    if (this.pristine) {
      this.character = fresh;
      this.baseHash = hash;
      this.refreshed = preset;
      this.version++;
      return this.persist();
    }
  }

  /** The answer to the card: reload the preset (the look before can be undone), or keep the look as it is (and do not ask again). */
  async answerRefresh(yes: boolean): Promise<boolean> {
    await this.settled();
    const offer = this.refreshOffer;
    if (!offer) return false;
    this.refreshOffer = null;
    if (yes) {
      await this.adopt((await this.call("base", { name: offer.preset })).character, offer.preset);
      return true;
    }
    this.baseHash = offer.hash;
    this.pristine = false;
    await this.persist();
    return false;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** Replace the current look, remembering the old one for undo. */
  private async adopt(character: Character, base: string | null | undefined = undefined, kind: "preset" | "changed" = base === undefined || base === null ? "changed" : "preset"): Promise<void> {
    this.history.push({ character: this.character, base: this.basePreset, baseHash: this.baseHash, pristine: this.pristine });
    if (this.history.length > 20) this.history.shift();
    this.character = character;
    if (base !== undefined) this.basePreset = base; // undefined: a tweak, the base stays
    if (kind === "preset") {
      this.baseHash = hashOf(character);
      this.pristine = true;
    } else {
      this.pristine = false;
      if (base === null) this.baseHash = null; // a saved look
      else if (typeof base === "string") this.baseHash = await this.presetHash(base); // a preset with changes made in the same tag
    }
    this.version++;
    this.frameCache.clear();
    await this.persist();
  }

  private async presetHash(name: string): Promise<string | null> {
    try {
      return hashOf((await this.call("base", { name })).character);
    } catch {
      return null;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.opts.statePath), { recursive: true });
    await writeFile(this.opts.statePath, JSON.stringify({ character: this.character, base: this.basePreset, baseHash: this.baseHash, pristine: this.pristine }, null, 2));
  }

  /** Go back to the look before the last change. */
  undo(): Promise<boolean> {
    const run = this.queue.then(async () => {
      const previous = this.history.pop();
      if (!previous) return false;
      this.character = previous.character;
      this.basePreset = previous.base;
      this.baseHash = previous.baseHash;
      this.pristine = previous.pristine;
      this.version++;
      this.frameCache.clear();
      await this.persist();
      return true;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private static slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  }

  async listLooks(): Promise<string[]> {
    try {
      this.lookNames = (await readdir(this.opts.looksDir)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
    } catch {
      this.lookNames = [];
    }
    return this.lookNames;
  }

  /** Save the current look under a name. Returns the stored name, or null if the name is unusable. */
  async saveLook(name: string): Promise<string | null> {
    const slug = AvatarService.slug(name);
    if (!slug) return null;
    await mkdir(this.opts.looksDir, { recursive: true });
    await writeFile(join(this.opts.looksDir, `${slug}.json`), JSON.stringify({ character: this.character }, null, 2));
    await this.listLooks();
    return slug;
  }

  async deleteLook(name: string): Promise<void> {
    const slug = AvatarService.slug(name);
    if (slug) await rm(join(this.opts.looksDir, `${slug}.json`), { force: true });
    await this.listLooks();
  }

  private async readLook(name: string): Promise<Character | null> {
    const slug = AvatarService.slug(name);
    if (!slug) return null;
    try {
      return JSON.parse(await readFile(join(this.opts.looksDir, `${slug}.json`), "utf8")).character;
    } catch {
      return null;
    }
  }

  /** The creator's presets, with the starting character (Risa, unless `COMPANION_PRESET` says otherwise) first. */
  get presetNames(): string[] {
    const all = this.schema?.presets ?? [];
    const first = this.opts.defaultPreset;
    return all.includes(first) ? [first, ...all.filter((name) => name !== first)] : all;
  }

  private thumbnails: Promise<Record<string, string>> | null = null;

  /** Each preset drawn once with a neutral face, for the gallery. The presets never change, so this is kept. */
  presetThumbnails(): Promise<Record<string, string>> {
    this.thumbnails ??= (async () => {
      const out: Record<string, string> = {};
      for (const name of this.presetNames) {
        const { character } = await this.call("base", { name });
        const { svgs } = await this.call("frames", { character, face: {}, mouth: [0] });
        out[name] = svgs[0];
      }
      return out;
    })().catch((err) => {
      this.thumbnails = null; // try again next time
      throw err;
    });
    return this.thumbnails;
  }

  /** Switch to one of the built-in characters (a whole new look). */
  loadPreset(name: string): Promise<boolean> {
    const run = this.queue.then(async () => {
      if (!this.presetNames.includes(name)) return false;
      await this.adopt((await this.call("base", { name })).character, name);
      return true;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Switch to a saved look. */
  loadLook(name: string): Promise<boolean> {
    const run = this.queue.then(async () => {
      const look = await this.readLook(name);
      if (!look) return false;
      await this.adopt(look, null);
      return true;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Apply `[avatar ...]` changes one after another, in the order the model wrote them. */
  applyPatch(set: Record<string, string>): Promise<PatchResult> {
    const run = this.queue.then(async () => {
      const { load, ...others } = set;
      let rest = others;
      let base = this.character;
      let loadedName: string | null = null;
      const rejected: PatchResult["rejected"] = [];
      if (load !== undefined) {
        const look = await this.readLook(load);
        if (look) {
          base = look;
          loadedName = AvatarService.slug(load);
        } else if (this.presetNames.includes(load.toLowerCase())) {
          rest = { base: load.toLowerCase(), ...others }; // a preset named where a saved look was expected: it is what she meant
        } else {
          const saved = this.lookNames.length ? this.lookNames.join(", ") : "none yet";
          rejected.push({ key: "load", reason: `no saved look named '${load}' (saved looks: ${saved})` });
        }
      }
      const res = await this.call("patch", { character: base, set: rest });
      const applied: string[] = [...(loadedName ? [`load=${loadedName}`] : []), ...res.applied];
      if (applied.length > 0) {
        const based = applied.find((a) => a.startsWith("base="));
        const loaded = loadedName ? null : undefined; // a saved look is not a preset
        const others = applied.filter((a) => !a.startsWith("base=")).length > 0 || Boolean(loadedName);
        await this.adopt(res.character, based ? based.slice("base=".length) : loaded, based && !others ? "preset" : "changed");
      }
      return { applied, rejected: [...rejected, ...res.rejected] } as PatchResult;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Wait until every queued patch has been applied. */
  settled(): Promise<unknown> {
    return this.queue;
  }

  async resetLook(): Promise<void> {
    await this.settled();
    await this.adopt((await this.call("base", { name: this.opts.defaultPreset })).character, this.opts.defaultPreset);
  }

  /**
   * SVGs for one emotion: four mouth openings (for talking) and a blink, in that order.
   * An emotion's own `mouth_open` is its resting mouth, so talking never closes it.
   */
  async frames(emotion: string): Promise<string[]> {
    const name = emotion in this.opts.emotions ? emotion : "neutral";
    const key = `${this.version}:${name}`;
    const hit = this.frameCache.get(key);
    if (hit) return hit;
    const { character, face, mouth, eyes_shut } = framesRequest(this.opts.emotions, this.character, name);
    const { svgs } = await this.call("frames", { character, face, mouth, eyes_shut });
    this.frameCache.set(key, svgs);
    return svgs;
  }

  /**
   * Two pose frames to alternate between for a gesture, in the given emotion's face.
   * Returns null for an unknown gesture.
   */
  async gestureFrames(emotion: string, gesture: string): Promise<string[] | null> {
    const request = gestureRequest(this.opts.emotions, this.character, emotion, gesture);
    if (!request) return null;
    const name = emotion in this.opts.emotions ? emotion : "neutral";
    const key = `${this.version}:${name}:gesture:${gesture}`;
    const hit = this.frameCache.get(key);
    if (hit) return hit;
    const { character, face, mouth, poses, eyes_shut } = request;
    const { svgs } = await this.call("frames", { character, face, mouth, poses, eyes_shut });
    this.frameCache.set(key, svgs);
    return svgs;
  }

  /** The part of the persona that teaches the model to redraw herself. */
  promptSection(): string {
    const s = this.schema;
    const names = (fields: Record<string, unknown>) => Object.keys(fields).join(", ");
    const current = this.describeCurrent();
    return `
Your appearance (you can change it!):
You are drawn from code, and you can redesign yourself in the middle of a conversation. Put an avatar tag anywhere in a reply: [avatar key=value key=value]. It is invisible to the user and applies instantly; then react to the change in character. Do this when the user asks you to change something, or occasionally on your own when it suits the moment, but never spam it. Do not claim a change unless you sent the tag.
- Values have no spaces. Colours are hex like #ff88cc. Numbers and true/false work as you would expect. "none" removes an optional item (e.g. [avatar hat_color=none]). Unknown or invalid keys are rejected and you will be told.
- [avatar base=<preset>] first replaces your whole look with a preset: ${s.presets.join(", ")}. Further keys in the same tag then modify it.
- Look: skin_tone, hair_color, hair_tip_color (second tone toward the tips, ombre; the adult body does not draw it yet, so it is refused there), hair_length (0 to 1), hairstyle (${s.hairstyles.join(", ")}), eye_color, height (1.0 to 1.3), hair_tail, hair_knot.
- Face (your resting face): eye_size, eye_width, eye_tilt, iris_size, lash, brow_tilt, mouth_width, eye_corner, blush, glasses (true/false), scar_side (-1, 0, 1). Your expressions come from the [emotion:...] tags, so do not set mood fields like mouth_curve or mouth_open.
- Clothes: a garment is worn when its colour is set. Main ones: tunic_color, coat_color, robe_color, skirt_color, trouser_color, belt_color, boot_color, collar_color, apron_color, undersleeve_color, hat_color, hat_band_color, hair_clip_color (hair_clip style), headscarf_color, goggle_color, mask_color, wristband_color, staff_color, staff_crystal_color.
- Most other fields are also accepted by name, but your age is fixed and you always keep at least one covering garment on. Look: ${names(s.top)}. Outfit: ${names(s.outfit)}.
- The user sees you close-up by default (head and torso) and can switch to full body, so boots and trousers are mostly out of sight unless they do.

- [avatar load=<name>] switches to one of the user's saved looks (${this.lookNames.length ? this.lookNames.join(", ") : "none yet"}); further keys in the same tag then modify it.

Your current look: ${current}`;
  }

  private describeCurrent(): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(this.character)) {
      if (k === "face" || k === "outfit") {
        for (const [fk, fv] of Object.entries(v as Character)) {
          if (k === "outfit" && fv !== null && fv !== false) parts.push(`${fk}=${fv}`);
        }
      } else if (v !== null && v !== false) {
        parts.push(`${k}=${v}`);
      }
    }
    return parts.join(" ");
  }

  close(): void {
    this.dropWorker(this.worker);
  }

  /** Ends a renderer thread (a stuck or finished one). The next call starts a fresh one. */
  private dropWorker(worker: Worker | null): void {
    if (!worker) return;
    if (this.worker === worker) this.worker = null;
    void worker.terminate();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.opts.workerPath ?? new URL("./render-worker.ts", import.meta.url), {
      workerData: { creatorSrc: this.opts.creatorSrc },
      stderr: true,
    });
    worker.unref(); // a forgotten close() must not keep the process alive
    this.worker = worker;
    const failAll = (error: Error) => {
      for (const [id, waiter] of this.pending) {
        if (waiter.worker !== worker) continue;
        this.pending.delete(id);
        waiter.reject(error);
      }
    };
    worker.on("message", (line: string) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const waiter = this.pending.get(msg.id);
      if (!waiter || waiter.worker !== worker) return;
      this.pending.delete(msg.id);
      msg.ok ? waiter.resolve(msg) : waiter.reject(new Error(msg.error));
    });
    worker.stderr.on("data", (chunk) => process.stderr.write(`[avatar] ${chunk}`));
    worker.on("error", (err) => {
      if (this.worker === worker) this.worker = null;
      failAll(new Error(`avatar renderer failed: ${err.message}`));
    });
    worker.on("exit", () => {
      if (this.worker === worker) this.worker = null;
      failAll(new Error("avatar renderer exited"));
    });
    return worker;
  }

  private call(op: string, payload: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const worker = this.ensureWorker();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.dropWorker(worker); // a render that never ends is cut off, not waited for: the next call starts a fresh one
        reject(new Error(`avatar renderer timed out on '${op}'`));
      }, this.opts.timeoutMs ?? 15_000);
      this.pending.set(id, {
        worker,
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      worker.postMessage(JSON.stringify({ id, op, ...payload }));
    });
  }
}
