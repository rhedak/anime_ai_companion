// What she says in the demo, with no model. The spike knows two tricks: change the hair colour, put on glasses. Phase 1 grows this into
// the scripted conversation. A reply is plain text with the same tags a model would write, so the stand-in server treats it the same way.

const COLOURS = {
  red: "#d02a2a",
  pink: "#ff88cc",
  orange: "#ff9a3c",
  yellow: "#ffd84a",
  green: "#3fae5a",
  mint: "#8fe3b4",
  teal: "#2aa6a0",
  blue: "#3a6fe0",
  purple: "#8a4fd0",
  violet: "#8a4fd0",
  white: "#f4f4f4",
  silver: "#c9ccd4",
  black: "#1d1a22",
  brown: "#6b4430",
  blonde: "#e8cf7a",
};

export function reply(input) {
  const t = String(input).toLowerCase();
  // The colour word that comes first: "mint green" is mint, not green.
  const colour = Object.keys(COLOURS)
    .map((name) => ({ name, at: t.search(new RegExp(`\\b${name}\\b`)) }))
    .filter((c) => c.at >= 0)
    .sort((a, b) => a.at - b.at)[0]?.name;
  if (/\bhair\b/.test(t) && colour) return `[emotion:happy] Okay! ${colour[0].toUpperCase()}${colour.slice(1)} hair it is. [avatar hair_color=${COLOURS[colour]}] How does it look?`;
  if (/\bglasses\b/.test(t)) return `[emotion:shy] Glasses, sure. [avatar glasses=true] Do they suit me?`;
  return `[emotion:thinking] This demo only knows a few tricks so far. Try "make my hair mint green" or "put on glasses".`;
}
