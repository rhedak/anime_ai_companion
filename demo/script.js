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

const SHOW_WORDS = /\b(show off|show me everything|show (me )?all|all (of )?(your|her|the) (emotions|expressions|animations|moods|faces)|every (emotion|expression)|run through)\b/;
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
  'Type /show and I run through every emotion and gesture. Say "show me work mode" for a pretend coding session. ' +
  "The Undo button above my picture takes back the last change. I can't chat freely here: that needs a real language model, and the real app has one.";

/** What she says when the picture pack is chosen (the same for a first choice and a later one). */
export const PACK_INTRO =
  "[emotion:happy] [gesture:wave] This is an image pack: right now I'm a set of pictures, not a character drawn by code. " +
  "I can still change my face, blink, talk, wave and cheer, but I can't redraw myself: no new hair, eyes, glasses, clothes or other characters while the pictures are on. " +
  "To get that back, choose Looks… → Packs… → Drawn avatar (or type /frames off). Type /show to see everything the pictures can do.";

const DOCS = "https://rhedak.github.io/anime_ai_companion/";

/**
 * Where she points when something needs a real model. Links come in the middle, so the bubble over her picture (which shows only the tail of a
 * reply, as plain text) ends on words.
 */
const NEEDS_MODEL =
  "To really talk I need a proper language model behind me. The real app connects me to Claude Code, Cursor or opencode, or to a free model " +
  `that runs on your own computer through [Ollama](https://ollama.com) ([how to set that up](${DOCS}brains.html#ollama)). Then you can ask me anything.`;

/** She is asked to chat (or something only a model could answer). */
const CHAT_WORDS =
  /\b(chat|talk|converse|conversation|speak)\b.*\b(you|with|me)\b|\bcan (we|you|i) (chat|talk)\b|\b(let'?s|lets|i want to|i wanna) (chat|talk)\b|\bhow are you\b|\bwho are you\b|\byour name\b|\btell me (a|an|about|something)\b|\bjoke\b|\bwrite (me|a)\b|\bexplain\b|\bwhat do you (think|like)\b/;

/** What she says when the drawn avatar comes back. */
export const DRAWN_AGAIN =
  "[emotion:happy] [gesture:cheer] I'm drawn by code again, so I can change my hair, eyes, glasses and clothes, or become one of the 20 characters. Just ask.";

const HELP_PACK =
  "[emotion:happy] Here is what I can do as a picture pack: show a mood (\"be shy\", \"be sad\"), wave or cheer, and talk. " +
  "I can't change my looks while I'm pictures: for that, go back to the drawn avatar (Looks… → Packs… → Drawn avatar, or /frames off). " +
  'Type /show and I run through every emotion and gesture. Say "show me work mode" for a pretend coding session. I can\'t chat freely here: that needs a real language model.';

/**
 * Her answer to a message: `{ text, scene }`. `text` has the tags; `scene` names a longer scripted scene the stand-in plays ("work").
 * @param {string} input
 * @param {{ presets?: string[], pack?: boolean }} [context]  `pack`: she is a picture pack just now, so she cannot redraw herself
 * @returns {{ text: string, scene?: string }}
 */
export function reply(input, context = {}) {
  const t = ` ${String(input).toLowerCase().replace(/\s+/g, " ")} `;
  const presets = context.presets ?? [];

  if (SHOW_WORDS.test(t)) return { text: "[emotion:happy] Sure, watch this! [demo]" };
  if (WORK_WORDS.test(t)) return { scene: "work", text: "" };
  if (CHAT_WORDS.test(t) && !/\b(wave|cheer|show|become|hair|eyes|glasses|hat|coat|skirt)\b/.test(t)) {
    return { text: `[emotion:happy] I'd love to chat, but this demo has no language model: I only follow a small script. ${NEEDS_MODEL}` };
  }
  if (HELP_WORDS.test(t)) return { text: context.pack ? HELP_PACK : HELP };
  if (/\bundo\b/.test(t) && context.pack) return { text: "[emotion:thinking] There is nothing to undo: as a picture pack I can't change my looks, so nothing has changed." };
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

  if (context.pack && (set.size || missing.length)) {
    return {
      text:
        `[emotion:shy] I can't do that as a picture pack: I'm only pictures, so I can't change ${set.size ? nice(phrases.map((p) => p.replace(/^(an?|the) /, ""))) : "my looks"}. ` +
        "Switch back to the drawn avatar (Looks… → Packs… → Drawn avatar, or /frames off) and ask me again. For now I can show a mood, wave or cheer.",
    };
  }
  if (!set.size && !mood && !gesture && !missing.length) {
    return {
      text:
        context.pack
          ? `[emotion:thinking] That is beyond my script: this demo has no language model, so as a picture pack I only know a few things. Try "be shy", "wave", "cheer", "/show" or "show me work mode". ${NEEDS_MODEL}`
          : '[emotion:thinking] That is beyond my script: this demo has no language model, so I only know a few things. Try "make my hair mint green", ' +
            `"put on glasses and a witch hat", "become Linnea", "be shy", "wave", "/show" or "show me work mode". ${NEEDS_MODEL}`,
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
