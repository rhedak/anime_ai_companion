import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { GESTURES, framesRequest, gestureRequest } from "../public/frames.js";

type Character = Record<string, any>;

export interface PatchResult {
  applied: string[];
  rejected: { key: string; reason: string }[];
}

export interface AvatarOptions {
  /** The anime-character-creator `src` directory (it is imported, never modified). */
  creatorSrc: string;
  python: string;
  workerPath: string;
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

/** Owns the Python renderer, the current character and its rendered frames. */
export class AvatarService {
  character: Character = {};
  /** Bumps whenever the character changes, so clients know cached frames are stale. */
  version = 0;
  schema!: Schema;

  private readonly opts: AvatarOptions;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private frameCache = new Map<string, string[]>();
  /** Earlier looks, newest last, so a redesign can be undone. */
  private history: Character[] = [];
  lookNames: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: AvatarOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.schema = await this.call("schema", {});
    try {
      this.character = JSON.parse(await readFile(this.opts.statePath, "utf8")).character;
    } catch {
      this.character = (await this.call("base", { name: this.opts.defaultPreset })).character;
    }
    await this.listLooks();
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** Replace the current look, remembering the old one for undo. */
  private async adopt(character: Character): Promise<void> {
    this.history.push(this.character);
    if (this.history.length > 20) this.history.shift();
    this.character = character;
    this.version++;
    this.frameCache.clear();
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.opts.statePath), { recursive: true });
    await writeFile(this.opts.statePath, JSON.stringify({ character: this.character }, null, 2));
  }

  /** Go back to the look before the last change. */
  undo(): Promise<boolean> {
    const run = this.queue.then(async () => {
      const previous = this.history.pop();
      if (!previous) return false;
      this.character = previous;
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
      await this.adopt((await this.call("base", { name })).character);
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
      await this.adopt(look);
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
      if (applied.length > 0) await this.adopt(res.character);
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
    await this.adopt((await this.call("base", { name: this.opts.defaultPreset })).character);
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
    const { character, face, mouth } = framesRequest(this.opts.emotions, this.character, name);
    const { svgs } = await this.call("frames", { character, face, mouth });
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
    const { character, face, mouth, poses } = request;
    const { svgs } = await this.call("frames", { character, face, mouth, poses });
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
You are drawn from code, and you can redesign yourself in the middle of a conversation. Put an avatar tag anywhere in a reply: [avatar key=value key=value]. It is invisible to the user and applies instantly; then react to the change in character (e.g. "ooh, how do I look with blue hair?"). Do this when the user asks you to change something, or occasionally on your own when it suits the moment, but never spam it. Do not claim a change unless you sent the tag.
- Values have no spaces. Colours are hex like #ff88cc. Numbers and true/false work as you would expect. "none" removes an optional item (e.g. [avatar hat_color=none]). Unknown or invalid keys are rejected and you will be told.
- [avatar base=<preset>] first replaces your whole look with a preset: ${s.presets.join(", ")}. Further keys in the same tag then modify it.
- Look: skin_tone, hair_color, hair_tip_color (second tone toward the tips, ombre), hair_length (0 to 1), hairstyle (${s.hairstyles.join(", ")}), eye_color, height (1.0 to 1.3), hair_tail, hair_knot.
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
    this.proc?.kill();
    this.proc = null;
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;
    const proc = spawn(this.opts.python, ["-I", this.opts.workerPath], {
      env: { ...process.env, CREATOR_SRC: this.opts.creatorSrc },
    });
    this.proc = proc;
    createInterface({ input: proc.stdout }).on("line", (line) => {
      const msg = JSON.parse(line);
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      msg.ok ? waiter.resolve(msg) : waiter.reject(new Error(msg.error));
    });
    proc.stderr.on("data", (chunk) => process.stderr.write(`[avatar] ${chunk}`));
    proc.on("exit", () => {
      if (this.proc === proc) this.proc = null;
      for (const w of this.pending.values()) w.reject(new Error("avatar renderer exited"));
      this.pending.clear();
    });
    return proc;
  }

  private call(op: string, payload: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`avatar renderer timed out on '${op}'`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.ensureProcess().stdin.write(JSON.stringify({ id, op, ...payload }) + "\n");
    });
  }
}
