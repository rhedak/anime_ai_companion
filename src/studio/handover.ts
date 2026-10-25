/**
 * The handover prompt: for a user with no image maker the studio can use, text to paste into any AI agent (a chat website, an
 * agent, whatever they have) that can make pictures. It says what a picture pack is and links to the agent-facing guide on the
 * documentation site. Nothing is sent anywhere by the app: the user copies it.
 */
export const HANDOVER_GUIDE = "https://rhedak.github.io/anime_ai_companion/agent-guide.html";

export interface HandoverRequest {
  /** The pack she is drawn from now (the user attaches its neutral picture), if any. */
  source?: string | null;
  /** The new pack's folder name. */
  name?: string;
  /** The outfit in the user's words. */
  outfit?: string;
}

/** A folder name from the first words of the outfit: lower case letters, digits and dashes, without a leading article. */
export function packNameFrom(words: string | undefined): string {
  const list = (words ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  while (list.length > 1 && ["a", "an", "the"].includes(list[0])) list.shift();
  return list.slice(0, 3).join("-").slice(0, 30).replace(/-+$/g, "") || "my-outfit";
}

export function handoverPrompt(req: HandoverRequest): string {
  const outfit = (req.outfit ?? "").trim().replace(/\s+/g, " ").slice(0, 400);
  const name = req.name && /^[A-Za-z0-9 ._-]{1,40}$/.test(req.name) ? req.name : packNameFrom(outfit);
  return [
    `I use a local anime companion app that shows its character as a "picture pack": a folder of pictures of one character, cut out on a transparent background, that the app swaps between (expressions, blinking, talking, a wave and a cheer). I want you to make a new pack of ${req.source ? `the character in the attached picture (the neutral picture of my pack "${req.source}")` : "the character in the attached picture"} in a new outfit: ${outfit || "(I will tell you the outfit)"}.`,
    "",
    `Before you start, read the guide for agents and follow it: ${HANDOVER_GUIDE}`,
    "",
    "In short:",
    "- Keep her exactly as she is in the attached picture (face, hair, body, art style, framing, canvas size). Only the outfit changes. She is an adult; keep adult proportions.",
    `- Make the picture "neutral" first and show it to me. If I like it, make the same picture again with six other expressions: happy, sad, angry, surprised, shy, thinking. Change only the face for these.`,
    "- Optional if you can: each expression with her eyes closed (name-blink) and with her mouth open three sizes (name-talk1, -talk2, -talk3), and the poses wave-1, wave-2, cheer-1, cheer-2 (arms only change).",
    "- Every picture has the same size, the character is cut out on a transparent background, and the file names are lower case: neutral.png, happy.png, neutral-blink.png, neutral-talk1.png, wave-1.png ... Only neutral.png is required.",
    `- Give me the pictures as downloadable files (a zip is fine) for a folder called "${name}", and a short look.txt saying what she wears, in the second person ("You wear ...").`,
    "- Tell me honestly what you could not do, and which pictures are weak. Do not pretend a picture exists that you did not make.",
    "",
    `When I have the files I put the folder in the app's data/frames/ and type /frames ${name}.`,
  ].join("\n");
}
