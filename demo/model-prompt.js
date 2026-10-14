// What the small in-browser model is told, and how its answers are tidied. Pure functions with no browser in them, so they are tested in Node.
// The model itself is demo/model.js; the dialog that offers it is demo/model-dialog.js.

/** The model on offer. Two builds of the same weights (the download is the same size): the f16 one needs the WebGPU feature `shader-f16`. */
export const MODEL = {
  title: "SmolLM2 360M",
  idF16: "SmolLM2-360M-Instruct-q4f16_1-MLC",
  idF32: "SmolLM2-360M-Instruct-q4f32_1-MLC",
  downloadMB: 207,
  licence: "Apache-2.0",
  /** Pinned: the library that runs it, from the CDN, and the version whose prebuilt model list has the ids above. */
  library: "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm",
};

/** The build that can run on this GPU. */
export const modelId = (hasF16) => (hasF16 ? MODEL.idF16 : MODEL.idF32);

const GESTURES = ["wave", "cheer"];

/**
 * @param {string[]} emotions the emotion names of emotions.json
 * @param {string} name her name
 */
export function systemPrompt(emotions, name = "Risa") {
  return [
    `You are ${name}, a cheerful, warm and slightly playful anime companion in a small demo that runs in a web browser.`,
    "Reply in at most two short sentences, under 40 words in all. Never repeat yourself, and do not use lists, headings, quotes, stories or emoji.",
    `Start every reply with one emotion tag in square brackets, chosen from: ${emotions.map((e) => `[emotion:${e}]`).join(" ")}.`,
    `You may add a gesture tag, [gesture:${GESTURES.join("] or [gesture:")}], when it fits. Use no other square brackets.`,
    "You cannot change your own looks (the visitor does that by typing things like \"make my hair mint green\"), and you have no tools and no files.",
    "You are a very small model running inside the visitor's browser: if you do not know something, say so briefly instead of guessing.",
  ].join(" ");
}

const stripTags = (text) => String(text).replace(/\[[^\]\n]{0,120}\]/g, "").replace(/\s+/g, " ").trim();

/**
 * The conversation for the model: the system prompt, then the last few turns of the log. Her own earlier replies keep their emotion tag
 * (the model copies what it sees), without any other tag; very long lines are cut.
 * @param {{ type: string, text: string }[]} history  the log, newest last, ending with the visitor's message
 * @param {string[]} emotions
 */
export function buildMessages(history, emotions, name = "Risa", turns = 8) {
  const messages = [{ role: "system", content: systemPrompt(emotions, name) }];
  for (const item of history.filter((h) => (h.type === "user" || h.type === "bot") && h.text).slice(-turns)) {
    if (item.type === "user") messages.push({ role: "user", content: stripTags(item.text).slice(0, 600) });
    else {
      const emotion = /\[emotion:(\w+)\]/.exec(item.text)?.[1];
      const body = stripTags(item.text).slice(0, 600);
      messages.push({ role: "assistant", content: emotion && emotions.includes(emotion) ? `[emotion:${emotion}] ${body}` : body });
    }
  }
  return messages;
}

/** A guess at a face for an answer that came without one. */
export function guessEmotion(text, emotions) {
  const pick = (name) => (emotions.includes(name) ? name : "neutral");
  if (/\b(sorry|sad|unfortunately|can't|cannot|don't know|do not know|no idea)\b/i.test(text)) return pick(/\b(sorry|sad|unfortunately)\b/i.test(text) ? "sad" : "thinking");
  if (/\?\s*$/.test(text)) return pick("thinking");
  if (/!|\b(glad|happy|love|great|fun|hello|hi)\b/i.test(text)) return pick("happy");
  return pick("neutral");
}

/**
 * What to add to the end of an answer that is already on screen so that her face is right: the answer streams in as the model writes it, so
 * a missing or invented emotion cannot be fixed at the front. Empty when the answer is fine.
 */
export function emotionFix(answer, emotions) {
  const tags = [...String(answer).matchAll(/\[emotion:(\w+)\]/g)].map((m) => m[1]);
  if (tags.length && emotions.includes(tags[tags.length - 1])) return "";
  return ` [emotion:${guessEmotion(stripTags(answer), emotions)}]`;
}
