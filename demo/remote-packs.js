// The picture packs the demo can fetch from the packs repository's own GitHub Pages site (CORS-open, unlike a release asset, which a page cannot
// fetch). Besides each pack's archive (what the app downloads), the site keeps the loose lossless frames in `frames/<id>/` with a `pack.json` that
// says which picture is which (written by `node src/pack-archive-cli.ts manifest`). What comes from there is data from another server: it is
// checked here (ids, file names, sizes) and never trusted to name any address but its own folder.

export const PACKS_SITE = "https://rhedak.github.io/anime_ai_companion-packs/";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.webp$/;
const NAME = /^[a-z0-9_-]{1,40}$/i;
const MAX_PACKS = 50;
const MAX_FRAMES = 120;
const text = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f<>\[\]]+/g, " ").trim().slice(0, max) : undefined);

/**
 * The packs the index lists, as the page's gallery wants them. `site` is where the index came from; the pictures and the preview are looked
 * for beside it, never at an address the index names (only its own `thumbnail`, resolved against `site` and kept to the same host).
 * @param {any} index the parsed index.json
 * @param {string} site
 * @returns {Record<string, { id: string, name: string, description?: string, credit?: string, character?: { id: string, name: string }, sizes: { archiveBytes: number }, host: string, thumb?: string, base: string, saved: string }>}
 */
export function remotePacksFrom(index, site = PACKS_SITE) {
  /** @type {Record<string, any>} */
  const found = {};
  const list = Array.isArray(index?.packs) ? index.packs.slice(0, MAX_PACKS) : [];
  for (const entry of list) {
    const id = entry?.id;
    if (typeof id !== "string" || !ID.test(id) || id.includes("..") || Object.hasOwn(found, id)) continue;
    const frames = entry.sizes?.framesBytes;
    const base = new URL(`frames/${encodeURIComponent(id)}/`, site);
    let thumb;
    if (typeof entry.thumbnail === "string") {
      try {
        const url = new URL(entry.thumbnail, site);
        if (url.protocol === "https:" && url.host === base.host) thumb = url.href;
      } catch {}
    }
    const who = entry.character && typeof entry.character === "object" ? { id: text(entry.character.id, 40), name: text(entry.character.name, 80) } : null;
    found[id] = {
      id,
      name: text(entry.name, 80) || id,
      description: text(entry.description, 400),
      credit: text(entry.credit, 300),
      character: who?.id && NAME.test(who.id) ? { id: who.id, name: who.name || who.id } : undefined,
      sizes: { archiveBytes: typeof frames === "number" && frames > 0 ? frames : 0 },
      host: base.hostname,
      thumb,
      base: base.href,
      saved: "Your browser keeps it for next time.",
    };
  }
  return found;
}

/**
 * A pack's `pack.json` as the page's PackInfo, with each picture's address made absolute under `base`. Null when it does not look like one.
 * @param {any} json
 * @param {string} base the pack's folder on the site, with a trailing slash
 */
export function packInfoFrom(json, base) {
  if (!json || typeof json !== "object" || !json.emotions || typeof json.emotions !== "object") return null;
  const url = (file) => (typeof file === "string" && FILE.test(file) ? `${base}${encodeURIComponent(file)}` : null);
  let count = 0;
  const emotions = {};
  for (const [emotion, e] of Object.entries(json.emotions)) {
    if (!NAME.test(emotion) || !e || typeof e !== "object") return null;
    const idle = url(e.idle);
    const blink = e.blink === undefined ? undefined : url(e.blink);
    const talk = Array.isArray(e.talk) ? e.talk.map(url) : [];
    if (!idle || blink === null || talk.includes(null)) return null;
    count += 1 + (blink ? 1 : 0) + talk.length;
    emotions[emotion] = { idle, blink, talk };
  }
  if (!emotions.neutral) return null;
  const gestures = {};
  for (const [gesture, list] of Object.entries(json.gestures ?? {})) {
    const urls = Array.isArray(list) ? list.map(url) : null;
    if (!NAME.test(gesture) || !urls || urls.includes(null)) return null;
    count += urls.length;
    gestures[gesture] = urls;
  }
  if (count > MAX_FRAMES) return null;
  return { name: text(json.name, 80) || "pack", character: typeof json.character === "string" && NAME.test(json.character) ? json.character : undefined, credit: text(json.credit, 300), terms: text(json.terms, 600), emotions, gestures };
}
