// Update notices, notify only: nothing is downloaded or installed. The pure parts live here so a test can read them without Electron.
const REPO = "rhedak/anime_ai_companion";
const TAGS_URL = `https://api.github.com/repos/${REPO}/tags?per_page=100`;
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const DAY = 24 * 60 * 60 * 1000;

const parse = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** True when `candidate` is a higher x.y.z than `current` (anything that is not x.y.z, like a pre-release tag, never counts). */
function isNewer(candidate, current) {
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The highest vX.Y.Z among the names in GitHub's tags answer, or null. */
function newestTag(tags) {
  let best = null;
  for (const t of Array.isArray(tags) ? tags : []) {
    if (t && typeof t.name === "string" && parse(t.name) && (!best || isNewer(t.name, best))) best = t.name;
  }
  return best;
}

/** Whether the automatic check is due: opted in, and not already done in the last day. */
function dueNow(settings, now = Date.now()) {
  return settings.auto === true && !(typeof settings.lastCheck === "number" && now - settings.lastCheck < DAY && now >= settings.lastCheck);
}

module.exports = { REPO, TAGS_URL, RELEASES_URL, isNewer, newestTag, dueNow };
