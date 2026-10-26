// Which bodies draw a second tone toward the tips of the hair (`hair_tip_color`). Every body does since the creator's 0.7.2 (the adult woman did not before: the setting was accepted and nothing showed). The list stays for a body that cannot.
// Shared by the reader (public/script.js) so she says so, and by src/render-ops.ts (a copy of the list: it compiles for the demo and imports nothing), so a patch is refused.
// When the creator draws tips on the adult body, empty this list; test/hair-tips.test.ts fails then, because it checks against the creator.
export const BODIES_WITHOUT_HAIR_TIPS = [];

/** True when a character with this body shows hair tips (an unknown body is given the benefit of the doubt). */
export const drawsHairTips = (/** @type {string | null | undefined} */ body) => !BODIES_WITHOUT_HAIR_TIPS.includes(String(body ?? ""));
