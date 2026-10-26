// Chat narration: a short action written *like this*, on its own line or in the middle of one, is shown in its own italic bubble.
// [narration]...[/narration], [narration: ...] and [narration ...] are the same thing, in either mode.
// A fenced code block is left untouched. In work mode, pass { asterisks: false }: a line of asterisks there is ordinary emphasis.

const MARK = "\u0000";

/** The words inside one layer of *asterisks* or _underscores_, or the text unchanged. */
function unwrap(body) {
  const text = String(body).replaceAll(MARK, "").trim();
  const wrapped = /^(?:\*(?!\*)([\s\S]*\S)\*|_(?!_)([\s\S]*\S)_)$/.exec(text);
  return (wrapped ? (wrapped[1] ?? wrapped[2]) : text).trim();
}

/** An action line is at least two words, and not a label such as *Note:*. Shorter emphasis stays in the speech. */
function actionText(body) {
  const text = unwrap(body);
  if (text.split(/\s+/).filter(Boolean).length < 2) return "";
  if (/:\s*$/.test(text)) return "";
  return text;
}

/** *two or more words* inside a line, not touching other asterisks or letters (bold and a*b*c are left alone). */
const INLINE_ACTION = /(?<![*\w])\*(?![*\s])([^*\n]*[^*\s])\*(?![*\w])/g;

/** A whole line that is only *an action* or _an action_. Empty when it is emphasis, a bullet or bold. */
function lineAction(line) {
  return actionText(/^(?:\*(?!\*|\s)[\s\S]*\S\*|_(?!_|\s)[\s\S]*\S_)$/.test(line.trim()) ? line.trim() : "");
}

/** The last line of a reply still being written: *she moves, with the closing mark not here yet. */
function openAction(line) {
  const trimmed = line.trim();
  const open = /^(?:\*(?!\*|\s)|_(?!_|\s))([\s\S]*)$/.exec(trimmed);
  if (!open || /[*_]/.test(open[1])) return "";
  return actionText(open[1]);
}

/** Prose with narration tags swapped for marked bodies. An unclosed [narration] counts only at the end of a streaming reply. */
function markTags(prose, pending) {
  const tags = /\[narration\]([\s\S]*?)\[\/narration\]|\[narration\s*:\s*([^\]]*)\]|\[narration\s+([^\]]+)\]/gi;
  let out = prose.replace(tags, (_, block, colon, spaced) => {
    const body = unwrap(block ?? colon ?? spaced ?? "");
    return body ? `${MARK}${body}${MARK}` : "";
  });
  if (pending) {
    out = out.replace(/\[narration\]([\s\S]*)$/i, (_, body) => {
      const text = unwrap(body);
      return text ? `${MARK}${text}${MARK}` : "";
    });
  }
  return out;
}

/** Speech lines stay speech; a line that is only an action becomes narration. `pending` is the unfinished last line. */
function splitLines(text, asterisks, pending) {
  if (!asterisks) return text.trim() ? [{ kind: "speech", text }] : [];
  /** @type {{ kind: "speech" | "narration", text: string }[]} */
  const parts = [];
  /** @type {string[]} */
  let speech = [];
  const flush = () => {
    if (speech.length) parts.push({ kind: "speech", text: speech.join("\n") });
    speech = [];
  };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const action = lineAction(lines[i]) || (pending && i === lines.length - 1 ? openAction(lines[i]) : "");
    if (action) {
      flush();
      parts.push({ kind: "narration", text: action });
    } else {
      // A model often writes the action in the middle of a line ("Hi! *gives a little wave* What's up?"): the words before and after stay speech, the action is its own bubble.
      let rest = 0;
      for (const m of lines[i].matchAll(INLINE_ACTION)) {
        const text = actionText(m[1]);
        if (!text) continue;
        const before = lines[i].slice(rest, m.index).trim();
        if (before) speech.push(before);
        flush();
        parts.push({ kind: "narration", text });
        rest = m.index + m[0].length;
      }
      const tail = rest ? lines[i].slice(rest).trim() : lines[i];
      if (tail || !rest) speech.push(tail);
    }
  }
  flush();
  return parts;
}

/** Fenced code (```) is one chunk, so an action line inside it is never narration. An unclosed fence runs to the end. */
function fenceChunks(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  /** @type {{ code: boolean, text: string }[]} */
  const chunks = [];
  /** @type {string[]} */
  let buf = [];
  let inCode = false;
  const push = (code) => {
    if (!buf.length) return;
    chunks.push({ code, text: buf.join("\n") });
    buf = [];
  };
  for (const line of lines) {
    if (!inCode && /^\s*```/.test(line)) {
      push(false);
      inCode = true;
      buf.push(line);
    } else if (inCode && /^\s*```\s*$/.test(line)) {
      buf.push(line);
      push(true);
      inCode = false;
    } else buf.push(line);
  }
  push(inCode);
  return chunks;
}

/**
 * The reply in order: what she says, and the actions between. Whitespace-only speech is dropped.
 * @param {string} text tag-stripped reply text
 * @param {{ asterisks?: boolean }} [options] asterisks defaults to true. False keeps *lines* in the speech (work mode).
 * @returns {{ kind: "speech" | "narration", text: string }[]}
 */
export function splitNarration(text, options = {}) {
  const asterisks = options.asterisks !== false;
  const chunks = fenceChunks(String(text));
  /** @type {{ kind: "speech" | "narration", text: string }[]} */
  const parts = [];
  const add = (part) => {
    if (!part.text.trim()) return;
    const prev = parts[parts.length - 1];
    if (part.kind === "speech" && prev?.kind === "speech") prev.text += `\n${part.text}`;
    else parts.push(part);
  };
  chunks.forEach((chunk, index) => {
    // Tags are narration in either mode. Asterisk lines are only read at the end of a chat reply, where one may still be unfinished.
    const end = index === chunks.length - 1 && !chunk.code;
    if (chunk.code) {
      add({ kind: "speech", text: chunk.text });
      return;
    }
    const marked = markTags(chunk.text, end);
    const bits = marked.split(MARK);
    for (let i = 0; i < bits.length; i++) {
      if (i % 2 === 1) add({ kind: "narration", text: unwrap(bits[i]) });
      else for (const part of splitLines(bits[i], asterisks, end && asterisks && i === bits.length - 1)) add(part);
    }
  });
  for (const part of parts) if (part.kind === "speech") part.text = part.text.trim();
  return parts.filter((part) => part.text);
}
