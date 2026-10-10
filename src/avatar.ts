import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

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
  emotions: Record<string, Record<string, number>>;
  defaultPreset: string;
}

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
  }

  /** Apply `[avatar ...]` changes one after another, in the order the model wrote them. */
  applyPatch(set: Record<string, string>): Promise<PatchResult> {
    const run = this.queue.then(async () => {
      const res = await this.call("patch", { character: this.character, set });
      if (res.applied.length > 0) {
        this.character = res.character;
        this.version++;
        this.frameCache.clear();
        await mkdir(dirname(this.opts.statePath), { recursive: true });
        await writeFile(this.opts.statePath, JSON.stringify({ character: this.character }, null, 2));
      }
      return { applied: res.applied, rejected: res.rejected } as PatchResult;
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
    this.character = (await this.call("base", { name: this.opts.defaultPreset })).character;
    this.version++;
    this.frameCache.clear();
    await writeFile(this.opts.statePath, JSON.stringify({ character: this.character }, null, 2));
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
    const face = this.opts.emotions[name];
    const rest = face.mouth_open ?? this.character.face?.mouth_open ?? 0;
    const mouth = [rest, Math.max(rest, 0.3), Math.max(rest, 0.55), Math.max(rest, 0.85)];
    const { svgs } = await this.call("frames", { character: this.character, face, mouth });
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
- Look: skin_tone, hair_color, hair_tip_color (second tone toward the tips, ombre), hair_length (0 to 1), hairstyle (${s.hairstyles.join(", ")}), eye_color, height (0.8 to 1.3), face_age, hair_tail, hair_knot.
- Face (your resting face): eye_size, eye_width, eye_tilt, iris_size, lash, brow_tilt, mouth_width, eye_corner, blush, glasses (true/false), scar_side (-1, 0, 1). Your expressions come from the [emotion:...] tags, so do not set mood fields like mouth_curve or mouth_open.
- Clothes: a garment is worn when its colour is set. Main ones: tunic_color, coat_color, robe_color, skirt_color, trouser_color, belt_color, boot_color, collar_color, apron_color, undersleeve_color, hat_color, hat_band_color, hair_clip_color (hair_clip style), headscarf_color, goggle_color, mask_color, wristband_color, staff_color, staff_crystal_color.
- Every other field is also accepted by name. Look: ${names(s.top)}. Outfit: ${names(s.outfit)}.
- The user sees you close-up by default (head and torso) and can switch to full body, so boots and trousers are mostly out of sight unless they do.

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
