import { isPackName } from "../frame-pack.ts";
import { cleanText, MAX_LOOK, MAX_OUTFIT } from "./job.ts";

/**
 * `[studio outfit="a dark green winter coat" name="risa-winter" look="You wear …"]` and `[studio redraw="happy, shy-blink"]` in a reply:
 * the brain's proposal for the pack studio's form, or for pictures to draw again. It only ever proposes. The page shows it in the form, and
 * nothing is drawn until the user presses the button on the question card (docs/pack-studio.md).
 */
export const STUDIO_TAG = /\[studio\s+([^\]]+)\]/gi;

export interface StudioProposal {
  /** Words for the form. Any of them may be missing. */
  source?: string;
  name?: string;
  outfit?: string;
  look?: string;
  /** Pictures to draw again, by name. */
  redraw?: string[];
}

const ATTRIBUTE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|“([^”]*)”)/g;

/** Every complete studio tag of a reply, read into its fields. Text is cleaned (no markup, no tags of ours) and capped here; what is valid for this computer is checked by the service. */
export function findStudioTags(text: string): StudioProposal[] {
  const found: StudioProposal[] = [];
  for (const tag of text.matchAll(STUDIO_TAG)) {
    const p: StudioProposal = {};
    for (const m of tag[1].matchAll(ATTRIBUTE)) {
      const key = m[1].toLowerCase();
      const value = m[2] ?? m[3] ?? m[4] ?? "";
      if (key === "outfit") p.outfit = cleanText(value, MAX_OUTFIT);
      else if (key === "look") p.look = cleanText(value, MAX_LOOK);
      else if (key === "name") p.name = value.trim().slice(0, 40);
      else if (key === "source") p.source = value.trim().slice(0, 40);
      else if (key === "redraw") p.redraw = value.split(/[,;\s]+/).map((n) => n.trim().toLowerCase()).filter((n) => /^[a-z0-9-]{1,30}$/.test(n)).slice(0, 12);
    }
    if (p.outfit || p.name || p.look || p.source || p.redraw?.length) found.push(p);
  }
  return found;
}

/** A pack name the form may be given: usable, and not starting with a dot. */
export const usableName = (name: string | undefined): name is string => typeof name === "string" && isPackName(name) && !name.startsWith(".");
