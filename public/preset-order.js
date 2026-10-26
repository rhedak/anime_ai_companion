// The presets of the drawn character in the order the gallery shows them: the two polished ones first (the adult woman Risa and Franzi, drawn with the creator's newest
// drawing code), then the older, simpler ones in the creator's own order.
const FIRST = ["risa", "franzi"];

/** @param {string[]} names */
export function orderPresets(names) {
  const first = FIRST.filter((name) => names.includes(name));
  return [...first, ...names.filter((name) => !first.includes(name))];
}
