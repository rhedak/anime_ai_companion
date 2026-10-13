// What she says in the demo, with no model. A small rule-based reader turns a message into a reply that has the same tags a model would
// write ([emotion:…], [gesture:…], [avatar key=value …]), so the stand-in server treats it exactly as it would a model's answer. It
// understands several requests in one message ("blue eyes and glasses and a witch hat"); anything else gets an honest answer about what
// the demo can do.

/** Colour words and what they mean as a hex colour. */
const COLOURS = {
  red: "#d02a2a",
  crimson: "#a8123c",
  pink: "#ff88cc",
  rose: "#e35d8a",
  magenta: "#d03aa8",
  orange: "#ff9a3c",
  peach: "#ffb899",
  yellow: "#ffd84a",
  gold: "#e0b030",
  blonde: "#e8cf7a",
  green: "#3fae5a",
  mint: "#8fe3b4",
  lime: "#a6e03a",
  teal: "#2aa6a0",
  turquoise: "#3ccfcf",
  cyan: "#3ccfe0",
  blue: "#3a6fe0",
  navy: "#1f2f6b",
  sky: "#7ab8ff",
  purple: "#8a4fd0",
  violet: "#8a4fd0",
  lilac: "#c9a8f0",
  lavender: "#b8a8e8",
  white: "#f4f4f4",
  silver: "#c9ccd4",
  grey: "#808690",
  gray: "#808690",
  black: "#1d1a22",
  brown: "#6b4430",
};

const mix = (hex, other, amount) => {
  const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [parse(hex), parse(other)];
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
};

/** The first colour a clause names, with "dark", "light" and "pastel" taken into account, or null. */
function colourIn(clause) {
  const raw = clause.match(/#[0-9a-f]{6}\b/i);
  if (raw) return { name: raw[0].toLowerCase(), hex: raw[0].toLowerCase() };
  const found = Object.keys(COLOURS)
    .map((name) => ({ name, at: clause.search(new RegExp(`\\b${name}\\b`)) }))
    .filter((c) => c.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  if (!found) return null;
  let hex = COLOURS[found.name];
  let name = found.name;
  if (/\b(dark|deep)\b/.test(clause)) [hex, name] = [mix(hex, "#000000", 0.4), `dark ${name}`];
  else if (/\b(light|pale|pastel)\b/.test(clause)) [hex, name] = [mix(hex, "#ffffff", 0.45), `light ${name}`];
  return { name, hex };
}

/**
 * Clothes she can be asked to wear (a garment is worn once its colour is set), and the words for them.
 * @type {[RegExp, string, string][]}
 */
const GARMENTS = [
  [/\b(coat|jacket|blazer)\b/, "coat_color", "coat"],
  [/\b(skirt)\b/, "skirt_color", "skirt"],
  [/\b(shirt|tunic|top|dress)\b/, "tunic_color", "top"],
  [/\b(ribbon|bow)\b/, "ribbon_color", "ribbon"],
  [/\b(scarf|headscarf)\b/, "headscarf_color", "scarf"],
  [/\b(mask)\b/, "mask_color", "mask"],
  [/\b(boots?|shoes)\b/, "boot_color", "boots"],
  [/\b(belt)\b/, "belt_color", "belt"],
];

/**
 * Hairstyles of the creator (see its schema), by what someone might call them.
 * @type {[RegExp, string, string][]}
 */
const STYLES = [
  [/\b(bob|crop|cropped|pixie)\b/, "short_crop", "a cropped cut"],
  [/\b(messy|tousled|spiky|wild)\b/, "short_tousled", "a messy cut"],
  [/\b(bangs|fringe)\b/, "long_fringed", "a fringe"],
  [/\b(centre|center) part/, "long_center_part", "a centre parting"],
  [/\b(side part|parted)\b/, "long_parted", "a side parting"],
  [/\bshort\b/, "short_layered", "short layered hair"],
  [/\b(long|straight)\b/, "long_blunt", "long straight hair"],
];

/** @type {[RegExp, string, string][]} */
const MOODS = [
  [/\b(sad|cry|crying|unhappy|gloomy)\b/, "sad", "Oh... okay. *sniff*"],
  [/\b(angry|mad|furious|annoyed)\b/, "angry", "Hmph! Like this?"],
  [/\b(surprised|shocked|wow|gasp)\b/, "surprised", "Whoa!"],
  [/\b(shy|blush|embarrassed|bashful)\b/, "shy", "Um... like this?"],
  [/\b(think|thinking|ponder|hmm)\b/, "thinking", "Hmm, let me think..."],
  [/\b(happy|smile|smiling|glad|cheerful)\b/, "happy", "Hehe, like this?"],
  [/\b(neutral|calm|serious)\b/, "neutral", "Okay."],
];

const WORK_WORDS = /\b(work mode|work-mode|coding|code|approve|approval|permission|command|edit a file|project|developer|terminal)\b/;
const HELP_WORDS = /\b(what can you do|what can i|help|options|tricks|how does this work|what do you do)\b/;

const nice = (phrases) => (phrases.length <= 1 ? phrases.join("") : `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`);

export const GREETING =
  "[emotion:happy] [gesture:wave] Hi, I'm Risa! This is a small demo that runs entirely in your browser: nothing you type leaves it. " +
  "Try the buttons below, or just tell me what to change: my hair, my eyes, glasses, a hat, a coat, or a whole new character. " +
  "I can also show you what work mode looks like.";

const HELP =
  "[emotion:happy] Here is what I can do in this demo: change my hair (colour, ombre tips, style), my eyes, glasses, a hat, a coat or a skirt; " +
  'turn into one of the 20 characters ("become Linnea"); show a mood ("be shy"); or wave. You can ask for several things at once. ' +
  'Say "show me work mode" for a pretend coding session. The Undo button above my picture takes back the last change.';

/**
 * Her answer to a message: `{ text, scene }`. `text` has the tags; `scene` names a longer scripted scene the stand-in plays ("work").
 * @param {string} input
 * @param {{ presets?: string[] }} [context]
 * @returns {{ text: string, scene?: string }}
 */
export function reply(input, context = {}) {
  const t = ` ${String(input).toLowerCase().replace(/\s+/g, " ")} `;
  const presets = context.presets ?? [];

  if (WORK_WORDS.test(t)) return { scene: "work", text: "" };
  if (HELP_WORDS.test(t)) return { text: HELP };
  if (/\bundo\b/.test(t)) return { text: "[emotion:thinking] Use the Undo button above my picture: it takes back my last change, one at a time." };

  /** What she will change, by key (a later request for the same thing wins), the words for it, and what she could not do. */
  const set = new Map();
  const phrases = [];
  const missing = [];
  let mood = null;
  let gesture = null;
  /** The last clause took something off, so a short one after it ('and hat') does too. */
  let removing = false;
  const ask = (key, value, phrase) => {
    set.set(key, value);
    phrases.push(phrase);
  };
  const capital = (word) => `${word[0].toUpperCase()}${word.slice(1)}`;

  const clauses = t.split(/\b(?:and|then|also|plus|but)\b|[,;.!?]+/).map((c) => ` ${c.trim()} `);
  for (const c of clauses) {
    if (!c.trim()) continue;
    const colour = colourIn(c);
    const takesOff = /\b(no|without|remove|take off|lose)\b/.test(c) || (removing && !/\b(put|wear|give|make|add|want|have|get)\b/.test(c) && c.trim().split(' ').length <= 3);
    removing = /\b(no|without|remove|take off|lose)\b/.test(c);

    const preset = presets.find((name) => new RegExp(`\\b${name}\\b`).test(c));
    if (preset) {
      ask("base", preset, `${capital(preset)}'s look`);
      continue;
    }
    if (/\b(reset|original|normal|default)\b/.test(c)) {
      ask("base", presets.includes("risa") ? "risa" : (presets[0] ?? "risa"), "my original look");
      continue;
    }
    if (/\b(surprise me|random|someone else|someone new)\b/.test(c) && presets.length) {
      const pick = presets[Math.floor(Math.random() * presets.length)];
      ask("base", pick, `${capital(pick)}'s look`);
      continue;
    }

    if (/\b(glasses|specs)\b/.test(c)) {
      ask("glasses", takesOff ? "false" : "true", takesOff ? "no glasses" : "glasses");
      continue;
    }
    if (/\b(hat|cap|witch)\b/.test(c)) {
      if (takesOff) ask("hat_color", "none", "no hat");
      else {
        const witch = /\bwitch\b/.test(c);
        ask("hat_color", colour?.hex ?? (witch ? "#2a1a4a" : "#3a2f55"), witch ? "a witch hat" : `a ${colour ? `${colour.name} ` : ""}hat`);
      }
      continue;
    }
    const garment = GARMENTS.find(([rx]) => rx.test(c));
    if (garment && !/\bhair\b/.test(c)) {
      if (colour) ask(garment[1], colour.hex, `a ${colour.name} ${garment[2]}`);
      else missing.push(`I need a colour for the ${garment[2]}.`);
      continue;
    }
    if (/\beyes?\b/.test(c) && colour) {
      ask("eye_color", colour.hex, `${colour.name} eyes`);
      continue;
    }
    if (/\b(tips|ombre|ends)\b/.test(c) && colour) {
      ask("hair_tip_color", colour.hex, `${colour.name} tips`);
      continue;
    }
    const style = STYLES.find(([rx]) => rx.test(c));
    if (/\bhair\b/.test(c) || (colour && /\b(dye|colou?r)\b/.test(c)) || (style && /\b(style|cut|haircut|bob|bangs|fringe)\b/.test(c))) {
      if (colour) ask("hair_color", colour.hex, `${colour.name} hair`);
      if (style) ask("hairstyle", style[1], style[2]);
      if (colour || style) continue;
    }

    const feeling = MOODS.find(([rx]) => rx.test(c));
    if (feeling) mood = feeling;
    if (/\b(wave|hello|hi|hey|goodbye|bye)\b/.test(c)) gesture = "wave";
    else if (/\b(cheer|celebrate|hooray|yay|party)\b/.test(c)) gesture = "cheer";
  }

  if (!set.size && !mood && !gesture && !missing.length) {
    return {
      text:
        '[emotion:thinking] This demo only knows a few things. Try "make my hair mint green", "put on glasses and a witch hat", "become Linnea", ' +
        '"be shy", "wave", or "show me work mode". Or ask "what can you do?"',
    };
  }

  const words = [];
  if (mood) words.push(mood[2]);
  else if (gesture) words.push(gesture === "wave" ? "Hi hi!" : "Yay!");
  if (phrases.length) {
    const sentence = nice(phrases);
    words.push(`Okay! ${capital(sentence)}.`);
  }
  words.push(...missing);
  return {
    text: [
      `[emotion:${mood?.[1] ?? (set.size || gesture ? "happy" : "thinking")}]`,
      gesture ? `[gesture:${gesture}]` : "",
      ...words,
      set.size ? `[avatar ${[...set].map(([k, v]) => `${k}=${v}`).join(" ")}]` : "",
      set.size ? "How does that look?" : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
