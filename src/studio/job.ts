import { isPackName } from "../frame-pack.ts";
import type { KeyName } from "./cutout.ts";

/** A pack job: what the user confirmed, written to `data/studio/<id>/job.json` by the service and read by the runner. Nothing else steers it. */
export interface Job {
  id: string;
  kind: "redraw";
  /** The folder in data/frames to write, once the user accepts the result. */
  name: string;
  /** The pack whose pictures are the reference. */
  source: string;
  /** The `character:` id of the new pack's look.txt, or null. */
  character: string | null;
  /** The user's own words for the outfit (untrusted text, length-capped). */
  outfit: string;
  /** The text of look.txt after the character line. */
  look: string;
  key: KeyName;
  /** Working size of the pictures (what the model sees). */
  width: number;
  height: number;
  backend: { url: string; name: string; model: string | null; revision: string | null; licence: string | null };
  /** Seeds of the base candidates. */
  seeds: number[];
  created: string;
}

export const MAX_OUTFIT = 400;
export const MAX_LOOK = 600;

/** Text that goes into a prompt and into look.txt: no markup, none of our own tags, one line, capped. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[<>`{}\\]/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const KEY_NAMES = ["magenta", "green", "cyan"];

export function parseJob(raw: unknown): { ok: true; job: Job } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (!raw || typeof raw !== "object") return fail("The job is not an object.");
  const j = raw as Record<string, unknown>;
  const id = typeof j.id === "string" && /^[a-z0-9-]{6,40}$/.test(j.id) ? j.id : null;
  if (!id) return fail("The job has no valid id.");
  if (j.kind !== "redraw") return fail("Only redraw jobs exist so far.");
  if (typeof j.name !== "string" || !isPackName(j.name)) return fail("The new pack's name is not usable.");
  if (typeof j.source !== "string" || !isPackName(j.source)) return fail("The source pack's name is not usable.");
  const outfit = cleanText(j.outfit, MAX_OUTFIT);
  if (outfit.length < 3) return fail("Describe the outfit in a few words.");
  const character = typeof j.character === "string" && /^[a-z0-9_-]{1,24}$/.test(j.character) ? j.character : null;
  if (typeof j.key !== "string" || !KEY_NAMES.includes(j.key)) return fail("The key colour is not one of ours.");
  const width = Number(j.width), height = Number(j.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256 || width > 1536 || height > 1536 || width % 16 || height % 16)
    return fail("The working size has to be a multiple of 16 between 256 and 1536.");
  const b = j.backend as Record<string, unknown> | undefined;
  if (!b || typeof b.url !== "string") return fail("The job names no image backend.");
  const seeds = Array.isArray(j.seeds) ? j.seeds.filter((s): s is number => Number.isInteger(s) && s >= 0 && s < 2 ** 31).slice(0, 8) : [];
  if (seeds.length === 0) return fail("The job has no seeds.");
  return {
    ok: true,
    job: {
      id,
      kind: "redraw",
      name: j.name,
      source: j.source,
      character,
      outfit,
      look: cleanText(j.look, MAX_LOOK),
      key: j.key as KeyName,
      width,
      height,
      backend: {
        url: b.url,
        name: cleanText(b.name, 80) || "image backend",
        model: typeof b.model === "string" ? cleanText(b.model, 120) || null : null,
        revision: typeof b.revision === "string" ? cleanText(b.revision, 80) || null : null,
        licence: typeof b.licence === "string" ? cleanText(b.licence, 80) || null : null,
      },
      seeds,
      created: typeof j.created === "string" ? j.created.slice(0, 40) : new Date().toISOString(),
    },
  };
}
