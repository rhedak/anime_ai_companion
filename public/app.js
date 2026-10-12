import { createAvatar } from "./avatar.js";
import { RATES, createVoice, sampleText, takeSentences } from "./speech.js";
import { renderMarkdown } from "./markdown.js";
import { createDemo } from "./demo.js";
import { composing } from "./ime.js";
import { createErrorReporter, installErrorReporting } from "./errors.js";

const $ = (id) => document.getElementById(id);
let ws = null;

// A problem in the page shows up in the chat (tap the line for details) and in the server's log, instead of
// only in a browser console nobody has open; see errors.js.
const errors = createErrorReporter({
  show(info, el) {
    try {
      if (!el) {
        el = addMsg("sys", "");
        el.classList.add("problem");
        el.addEventListener("click", () => el.classList.toggle("open"));
      }
      const head = document.createElement("div");
      head.textContent = `⚠ ${info.line}${info.where ? ` · ${info.where}` : ""}${info.count > 1 ? ` (×${info.count})` : ""}`;
      const details = document.createElement("pre");
      details.textContent = info.details || "(no details)";
      el.replaceChildren(head, details);
      log.scrollTop = log.scrollHeight;
    } catch {
      // the chat itself is not ready yet; the console still has it
    }
    return el;
  },
  send(report) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "client-error", ...report }));
  },
});
installErrorReporting(window, errors);

const avatar = createAvatar(
  $("avatar"),
  (emotion) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "frames", emotion }));
  },
  (emotion, gesture) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "gesture-frames", emotion, gesture }));
  },
  (err) => errors.report("avatar", err),
);
const log = $("log"), input = $("input"), send = $("send"), bubble = $("bubble");

// With voice on, her mouth follows the speech; otherwise it follows the arriving text.
const voice = createVoice(
  (speaking) => {
    if (voice.enabled) avatar.setTalking(speaking);
  },
  (message) => errors.report("voice", message),
  () => refreshVoices(),
);
let refreshVoices = () => {}; // set once the voice menus exist
let spoken = 0; // characters of the current reply already handed to the voice

let busy = false;
let botEl = null;
let raw = "";
let calmTimer = null;
let talkTimer = null;

// Strips [emotion:x] tags (including a half-streamed one at the end) and returns the last emotion.
function parseReply(text) {
  let emotion = null;
  const gestures = [];
  const clean = text
    .replace(/\[emotion:(\w+)\]/g, (_, e) => ((emotion = e.toLowerCase()), ""))
    .replace(/\[gesture:(\w+)\]/g, (_, g) => (gestures.push(g.toLowerCase()), ""))
    .replace(/\[avatar\b[^\]]*\]/g, "")
    .replace(/\[demo\]/g, "")
    .replace(/ *\[image\s[^\]]*\]/g, "")
    .replace(/\[[^\]]*$/, "")
    .replace(/^\s+/, "");
  return { clean, emotion, gestures };
}

let gesturesDone = 0; // gestures of the current reply already played
// What the chat says about how she is shown, once at the start of a chat: the drawn character's credit, or a
// picture pack's terms. Said when the page opens, when the look changes, and after "New chat" empties the log.
let announcedLook; // undefined until said once; then the pack's name, or null for the drawn character
let currentLook = null; // the pack info, or null for the drawn character
function sayLook() {
  if (currentLook?.terms) addMsg("sys", currentLook.terms);
  else if (!currentLook) {
    const el = addMsg("sys", "");
    const link = (text, href) => Object.assign(document.createElement("a"), { textContent: text, href, target: "_blank", rel: "noopener" });
    el.append(
      "Drawn by ",
      link("anime-character-creator", "https://github.com/rhedak/anime-character-creator"),
      " · ",
      link("source", "https://github.com/rhedak/anime_ai_companion"),
    );
  }
}

/** Her replies are shown as Markdown; the source stays in data-raw for /copy and /export. */
function setMsgText(el, text) {
  if (el.classList.contains("bot")) {
    el.dataset.raw = text;
    renderMarkdown(text, el);
  } else {
    el.textContent = text;
  }
}

/** The /phone card: a QR code for the first link, drawn from the server's rows of 1 and 0, and all the links. */
function addPhoneCard(links, rows) {
  const div = addMsg("sys", "Scan this with the phone's camera, or open one of these links on it. They work like a password, so keep them to yourself:");
  const ns = "http://www.w3.org/2000/svg";
  const n = rows.length;
  const quiet = 4; // the blank border a scanner needs
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${n + 2 * quiet} ${n + 2 * quiet}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code for the phone link");
  svg.style.cssText = "display:block;width:min(240px,100%);margin:8px 0;background:#fff;border-radius:6px";
  const path = document.createElementNS(ns, "path");
  path.setAttribute("fill", "#000");
  path.setAttribute(
    "d",
    rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "1" ? [`M${x + quiet} ${y + quiet}h1v1h-1z`] : []))).join(""),
  );
  svg.append(path);
  const list = document.createElement("div");
  list.style.cssText = "word-break:break-all;font-family:monospace;font-size:.85em";
  list.textContent = links.join("\n");
  list.style.whiteSpace = "pre-wrap";
  div.append(svg, list);
  log.scrollTop = log.scrollHeight;
}

function addMsg(kind, text) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  setMsgText(div, text);
  log.append(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

// --- showing off: every emotion and gesture in turn, each named (`/show`, or she asks for it with [demo]) ---
let demoEl = null;
const demo = createDemo(avatar, {
  set(text) {
    demoEl ??= addMsg("sys", "");
    demoEl.textContent = text;
    log.scrollTop = log.scrollHeight;
  },
  done(text) {
    demoEl ??= addMsg("sys", "");
    demoEl.textContent = text;
    demoEl = null;
    log.scrollTop = log.scrollHeight;
  },
});

// --- pictures in the chat: thumbnails that open in a viewer ----------------------------------

let viewer = null; // { images: [{ src, name }], index }

function closeViewer() {
  document.querySelector(".viewer")?.remove();
  viewer = null;
}

function showViewer() {
  document.querySelector(".viewer")?.remove();
  const { images, index } = viewer;
  const box = document.createElement("div");
  box.className = "viewer";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Image viewer");
  const img = document.createElement("img");
  img.src = images[index].src;
  img.alt = images[index].name;
  const caption = document.createElement("div");
  caption.className = "viewer-caption";
  caption.textContent = images.length > 1 ? `${images[index].name} (${index + 1}/${images.length})` : images[index].name;
  const button = (cls, label, text, action) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `viewer-btn ${cls}`;
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.onclick = (e) => {
      e.stopPropagation();
      action();
    };
    return b;
  };
  const step = (by) => {
    viewer.index = (viewer.index + by + images.length) % images.length;
    showViewer();
  };
  const close = button("close", "Close", "✕", closeViewer);
  box.append(img, caption, close);
  if (images.length > 1) box.append(button("prev", "Previous image", "‹", () => step(-1)), button("next", "Next image", "›", () => step(1)));
  box.addEventListener("click", (e) => {
    if (e.target === box) closeViewer();
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeViewer();
    else if (e.key === "ArrowLeft" && images.length > 1) step(-1);
    else if (e.key === "ArrowRight" && images.length > 1) step(1);
    else if (e.key === "Tab") e.preventDefault(); // keep focus inside while it is open
    else return;
    e.preventDefault();
  });
  document.body.append(box);
  close.focus();
}

/** A thumbnail that opens the viewer at its place among `images`. */
function thumbButton(images, index) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "thumb-btn";
  b.title = images[index].name;
  b.setAttribute("aria-label", `Open ${images[index].name}`);
  const img = document.createElement("img");
  img.src = images[index].src;
  img.alt = images[index].name;
  img.loading = "lazy";
  b.append(img);
  b.onclick = () => {
    viewer = { images, index };
    showViewer();
  };
  return b;
}

/** Pictures she showed, under her message. */
function addImageStrip(shown) {
  const div = document.createElement("div");
  div.className = "msg pic-strip";
  const images = shown.map((s) => ({ src: `/shown/${s.id}`, name: s.name }));
  div.append(...images.map((_, i) => thumbButton(images, i)));
  div.dataset.raw = shown.map((s) => `[image: ${s.name}]`).join(" ");
  log.append(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

// --- !commands ------------------------------------------------------------------------
const shellEls = new Map();

/** A `!command` and what it printed; `output` null while it is still running. */
function addShell(command, output, code) {
  const div = document.createElement("div");
  div.className = "msg shell";
  div.dataset.raw = `$ ${command}`;
  const head = document.createElement("div");
  head.className = "shell-cmd";
  head.textContent = `$ ${command}`;
  div.append(head);
  log.append(div);
  if (output === null) {
    div.classList.add("running");
    const wait = document.createElement("div");
    wait.className = "shell-wait";
    wait.textContent = "running…";
    div.append(wait);
  } else fillShell(div, output, code);
  log.scrollTop = log.scrollHeight;
  return div;
}

function fillShell(div, output, code) {
  div.classList.remove("running");
  div.querySelector(".shell-wait")?.remove();
  if (output.trim()) {
    const pre = document.createElement("pre");
    pre.textContent = output.replace(/\n$/, "");
    div.append(pre);
  }
  if (code !== 0 && code !== null) {
    const status = document.createElement("div");
    status.className = "shell-status";
    status.textContent = `exit ${code}`;
    div.append(status);
  }
  div.dataset.raw = `$ ${div.querySelector(".shell-cmd").textContent.slice(2)}\n${output}`;
  log.scrollTop = log.scrollHeight;
}

/** A message of the user's, with its pictures: thumbnails when we have them, a note after a reload. */
function addUserMsg(text, pics = [], count = pics.length) {
  const div = document.createElement("div");
  div.className = "msg user";
  if (pics.length) {
    const row = document.createElement("div");
    row.className = "pics";
    const images = pics.map((src, i) => ({ src, name: `picture ${i + 1}` }));
    images.forEach((_, i) => row.append(thumbButton(images, i)));
    div.append(row);
  } else if (count) {
    const note = document.createElement("div");
    note.className = "pics-note";
    note.textContent = `🖼 ${count} image${count > 1 ? "s" : ""}`;
    div.append(note);
  }
  if (text) div.append(document.createTextNode(text));
  log.append(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function setBusy(on) {
  busy = on;
  // While she works the send button becomes a stop button.
  send.disabled = !ws || ws.readyState !== WebSocket.OPEN;
  send.classList.toggle("stop", on);
  send.title = send.ariaLabel = on ? "Stop (Ctrl+C)" : "Send";
  if (busy) markActivity();
  renderWorking();
}

// --- "still working" feedback ---------------------------------------------------------
// Shown while a reply is in progress but nothing is arriving: before the first word, and
// during tool calls. Text that is streaming in is its own proof of life, so the dots hide then.

const QUIET_MS = 1200; // no text for this long: show the dots
const SLOW_MS = 8000; // no activity for this long: add the elapsed time
let lastActivity = 0;
let thinkingNudged = false;
const runningTools = new Map(); // tool id -> name
let statusText = null; // what the server says she is doing (e.g. compacting), while it lasts

function markActivity() {
  lastActivity = Date.now();
  thinkingNudged = false;
}

function renderWorking() {
  const el = $("working");
  const quiet = Date.now() - lastActivity;
  // While an approval card waits for the user, she is not working, so don't pretend.
  const show = busy && permEls.size === 0 && (quiet > QUIET_MS || runningTools.size > 0 || statusText !== null);
  el.hidden = !show;
  if (!show) return;
  const tools = [...runningTools.values()];
  let text = statusText ?? (tools.length ? `Working: ${tools[tools.length - 1]}…` : "Thinking…");
  if (quiet > SLOW_MS) text += ` ${Math.round(quiet / 1000)}s`;
  $("working-text").textContent = text;
  // Her face should say "busy" through the quiet stretches, whatever mood the last words had.
  if (quiet > QUIET_MS * 2 && !thinkingNudged) {
    thinkingNudged = true;
    avatar.setEmotion("thinking");
  }
}
setInterval(renderWorking, 500);

// The bubble is a glimpse, not the transcript: show the latest few lines only.
const BUBBLE_MAX = 220;
function showBubble(text) {
  bubble.hidden = !text;
  if (text.length > BUBBLE_MAX) {
    const tail = text.slice(-BUBBLE_MAX);
    text = "…" + tail.slice(tail.search(/\s/) + 1);
  }
  bubble.textContent = text;
}

function onDelta(text) {
  markActivity();
  clearTimeout(calmTimer);
  if (!botEl) {
    spoken = 0;
    botEl = addMsg("bot", "");
    avatar.setEmotion("thinking");
  }
  raw += text;
  const { clean, emotion, gestures } = parseReply(raw);
  if (emotion) avatar.setEmotion(emotion);
  for (; gesturesDone < gestures.length; gesturesDone++) avatar.gesture(gestures[gesturesDone]);
  if (!voice.enabled) avatar.setTalking(clean.length > 0);
  else {
    const { ready } = takeSentences(clean.slice(spoken));
    if (ready) {
      voice.speak(ready);
      spoken += ready.length;
    }
  }
  setMsgText(botEl, clean);
  showBubble(clean);
  log.scrollTop = log.scrollHeight;
}

/** Hand whatever is left of the current reply to the voice. */
function speakRest() {
  if (!voice.enabled || !raw) return;
  const rest = parseReply(raw).clean.slice(spoken);
  if (rest.trim()) voice.speak(rest);
  spoken = 0;
}

function endTurn() {
  speakRest();
  toolEls.clear();
  runningTools.clear();
  statusText = null;
  for (const id of [...permEls.keys()]) resolvePermission(id, "Cancelled");
  if (!voice.enabled) avatar.setTalking(false);
  botEl = null;
  raw = "";
  gesturesDone = 0;
  setBusy(false);
  clearTimeout(calmTimer);
  calmTimer = setTimeout(() => avatar.setEmotion("neutral"), 9000);
}

// --- work mode: folder, tool activity and approvals ---------------------------------

let state = { mode: "chat", projectDir: null, sessionId: null, model: "", allowedTools: [], permissionMode: "manual" };
let wantWork = false; // the user clicked Work but has not chosen a folder yet
const toolEls = new Map();
const permEls = new Map();

// --- popover menus that front the (hidden) <select>s -------------------------------
// The select stays the source of truth: the rest of this file reads and sets it as before,
// and the menu only mirrors it, so call refresh() after changing a select from code.

const menuDescriptions = {
  provider: {
    claude: "Claude Code: the full model, tools in work mode",
    cursor: "Cursor agent: Composer, Grok and the rest of your account",
    opencode: "opencode: the models your opencode install is signed into",
    ollama: "A model running on your own machine (chat only)",
  },
  "permission-mode": {
    manual: "She asks before each action",
    plan: "She plans, and changes nothing until you approve",
    acceptEdits: "File edits go ahead; other actions still ask",
    auto: "She runs on her own and pauses if anything looks unsafe",
    everything: "Every tool runs without a card; she keeps going until done. Resets to Ask next start",
  },
};
menuDescriptions.effort = {
  default: "Follow your own Claude Code settings",
  low: "Fastest and lightest on your limits",
  medium: "Balanced",
  high: "Thinks harder; slower",
  xhigh: "Even more thorough",
  max: "The most thinking she can do",
};
// One word on the button, so it fits a phone's row; the list it opens keeps the full names and descriptions.
const shortLabels = {
  "permission-mode": { manual: "Ask", plan: "Plan", acceptEdits: "Accept", auto: "Auto", everything: "Everything" },
};
const menuRefreshers = [];
const closeMenus = () => document.querySelectorAll(".menu-pop, .menu-backdrop").forEach((p) => p.remove());
document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) closeMenus(); });

function makeMenu(select, title) {
  const wrap = document.createElement("div");
  wrap.className = "menu";
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const text = document.createElement("span");
  button.append(text, Object.assign(document.createElementNS("http://www.w3.org/2000/svg", "svg"), {}));
  button.lastChild.setAttribute("viewBox", "0 0 24 24");
  button.lastChild.setAttribute("width", "12");
  button.lastChild.setAttribute("height", "12");
  button.lastChild.innerHTML = '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
  wrap.append(button);
  const close = (focus) => {
    wrap.querySelector(".menu-pop")?.remove();
    wrap.querySelector(".menu-backdrop")?.remove();
    button.setAttribute("aria-expanded", "false");
    if (focus) button.focus();
  };
  const open = () => {
    closeMenus();
    document.querySelectorAll(".menu > button").forEach((b) => b.setAttribute("aria-expanded", "false"));
    const pop = document.createElement("div");
    pop.className = "menu-pop";
    pop.setAttribute("role", "menu");
    pop.append(Object.assign(document.createElement("div"), { className: "menu-title", textContent: title }));
    for (const option of [...select.options].filter((option) => !option.hidden)) {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(option.value === select.value));
      const label = document.createElement("span");
      label.append(Object.assign(document.createElement("span"), { className: "item-label", textContent: option.text }));
      const desc = menuDescriptions[select.id]?.[option.value];
      if (desc) label.append(Object.assign(document.createElement("span"), { className: "item-desc", textContent: desc }));
      item.append(label);
      if (option.value === select.value) item.append(Object.assign(document.createElement("span"), { className: "check", textContent: "✓" }));
      item.onclick = () => {
        close(true);
        if (option.value !== select.value) {
          select.value = option.value;
          select.dispatchEvent(new Event("change"));
          refresh();
        }
      };
      pop.append(item);
    }
    pop.addEventListener("keydown", (e) => {
      const items = [...pop.querySelectorAll("button")];
      const i = items.indexOf(document.activeElement);
      if (e.key === "Escape") close(true);
      else if (e.key === "ArrowDown") items[(i + 1) % items.length].focus();
      else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length].focus();
      else return;
      e.preventDefault();
    });
    // On a phone the list is a sheet over the bottom of the screen (style.css); the dimmed rest of the page
    // closes it when tapped, which is what a menu hanging off a small button cannot offer.
    const backdrop = Object.assign(document.createElement("div"), { className: "menu-backdrop" });
    backdrop.addEventListener("click", () => close(false));
    wrap.append(backdrop, pop);
    button.setAttribute("aria-expanded", "true");
    (pop.querySelector('[aria-checked="true"]') ?? pop.querySelector("button")).focus();
  };
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    button.getAttribute("aria-expanded") === "true" ? close(false) : open();
  });
  const refresh = () => {
    text.textContent = shortLabels[select.id]?.[select.value] ?? select.selectedOptions[0]?.text ?? "";
    if (select.id === "effort" && select.value === "default" && state.effortNow) {
      text.textContent = `${state.effortNow[0].toUpperCase()}${state.effortNow.slice(1)} (default)`;
    }
    button.disabled = select.disabled;
    button.title = shortLabels[select.id] ? `${select.title}: ${select.selectedOptions[0]?.text ?? ""}` : select.title;
  };
  refresh();
  menuRefreshers.push(refresh);
  $("menus").append(wrap);
  return wrap;
}
const providerMenu = makeMenu($("provider"), "Brain");
const ollamaMenu = makeMenu($("ollama-model"), "Ollama model");
const cursorMenu = makeMenu($("cursor-model"), "Cursor model");
const opencodeMenu = makeMenu($("opencode-model"), "opencode model");
const effortMenu = makeMenu($("effort"), "Effort");
const permissionMenu = makeMenu($("permission-mode"), "Permission mode");

function renderBrain() {
  $("provider").value = state.provider ?? "claude";
  const picker = $("ollama-model");
  const ollama = state.provider === "ollama";
  const cursor = state.provider === "cursor";
  const opencode = state.provider === "opencode";
  ollamaMenu.hidden = !ollama;
  cursorMenu.hidden = !cursor;
  opencodeMenu.hidden = !opencode;
  effortMenu.hidden = ollama || cursor || opencode;
  $("effort").value = state.effort ?? "default";
  for (const option of $("permission-mode").options) {
    const claudeOnly = option.value === "acceptEdits" || option.value === "auto";
    option.hidden = claudeOnly ? state.provider !== "claude" : option.value === "everything" ? !(cursor || opencode) : false;
  }
  if (ollama) {
    const models = state.ollamaModels ?? [];
    picker.replaceChildren(
      ...(models.length ? models : [state.ollamaModel ?? "(no models found)"]).map((m) => new Option(m, m, false, m === state.ollamaModel)),
    );
    picker.disabled = models.length === 0;
  }
  if (cursor) {
    const models = state.cursorModels ?? [];
    const current = state.cursorModel ?? "";
    $("cursor-model").replaceChildren(
      ...(models.length ? models : [{ id: current, name: current || "(waiting for Cursor)" }]).map(
        (m) => new Option(m.name || m.id, m.id, false, m.id === current),
      ),
    );
    $("cursor-model").disabled = models.length === 0;
  }
  if (opencode) {
    const models = state.opencodeModels ?? [];
    const current = state.opencodeModel ?? "";
    $("opencode-model").replaceChildren(
      ...(models.length ? models : [{ id: current, name: current || "(opencode default)" }]).map(
        (m) => new Option(m.name || m.id, m.id, false, m.id === current),
      ),
    );
    $("opencode-model").disabled = models.length === 0;
  }
  const noTools = state.canUseTools === false;
  $("mode-work").title = noTools ? "This model cannot use tools" : "Let her work in a project folder; you approve each action";
  menuRefreshers.forEach((refresh) => refresh());
}

function renderName() {
  const name = state.name ?? "Risa";
  const heading = $("name");
  if (heading.tagName === "H1") heading.textContent = name;
  document.title = name;
}

function startRename() {
  const heading = $("name");
  if (heading.tagName !== "H1") return;
  const input = document.createElement("input");
  input.id = "name";
  input.className = "name name-edit";
  input.value = state.name ?? "Risa";
  input.maxLength = 24;
  input.setAttribute("aria-label", "Companion name");
  input.size = Math.max(4, input.value.length + 1);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    const back = document.createElement("h1");
    back.id = "name";
    back.className = "name";
    back.tabIndex = 0;
    back.setAttribute("role", "button");
    back.title = "Click to rename";
    input.replaceWith(back);
    wireName(back);
    renderName();
    if (save && value && value !== (state.name ?? "Risa")) ws?.send(JSON.stringify({ type: "rename", name: value }));
    back.focus();
  };
  input.addEventListener("input", () => (input.size = Math.max(4, input.value.length + 1)));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !composing(e)) finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  heading.replaceWith(input);
  input.focus();
  input.select();
}

function wireName(heading) {
  heading.addEventListener("click", startRename);
  heading.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      startRename();
    }
  });
}
wireName($("name"));

function renderMode() {
  renderName();
  renderBrain();
  $("mode-work").disabled = state.canUseTools === false;
  $("setuprow").hidden = state.mode !== "work" || state.provider !== "claude";
  $("use-setup").checked = Boolean(state.claudeSetup);
  const work = state.mode === "work";
  $("permission-mode").value = state.permissionMode;
  permissionMenu.hidden = !work;
  menuRefreshers.forEach((refresh) => refresh());
  $("mode-chat").classList.toggle("on", !work);
  $("mode-work").classList.toggle("on", work);
  $("workbar").hidden = !(work || wantWork);
  if (state.projectDir && document.activeElement !== $("folder")) $("folder").value = state.projectDir;
  renderFolderButton();
  renderWorkSummary();
  const info = $("workinfo");
  info.replaceChildren();
  if (!work) {
    info.textContent = "Pick the folder she may work in. She asks before changing anything.";
    return;
  }
  const cursor = state.provider === "cursor";
  const acp = cursor || state.provider === "opencode";
  const resume = acp ? state.sessionId ?? "" : `claude --resume ${state.sessionId}`;
  const copy = document.createElement("button");
  copy.textContent = "copy";
  copy.title = acp ? `${cursor ? "Cursor" : "opencode"} session id` : "Continue this conversation in a terminal (only one side should write at a time)";
  copy.onclick = () => navigator.clipboard?.writeText(resume).then(() => (copy.textContent = "copied"));
  const pre = !acp && state.allowedTools.length ? `, without asking: ${state.allowedTools.join(", ")}` : "";
  const runEverything = acp && state.permissionMode === "everything" ? (state.provider === "opencode" ? " · Run everything: tools run without asking" : " · Run everything: tools run unless a deny rule blocks them") : "";
  info.append(`${state.model}${pre}${runEverything}${acp ? " · session: " : " · terminal: "}`);
  const code = document.createElement("code");
  code.textContent = resume;
  info.append(code, copy);
}

function describeInput(tool, input) {
  if (typeof input.command === "string") return input.command;
  const lines = [];
  for (const [key, value] of Object.entries(input)) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    lines.push(`${key}: ${text.length > 1500 ? text.slice(0, 1500) + "…" : text}`);
  }
  return lines.join("\n");
}

function addPermission(req) {
  if (permEls.has(req.id)) return;
  avatar.setEmotion("thinking");
  const card = document.createElement("div");
  card.className = "msg perm";
  const title = document.createElement("div");
  title.className = "perm-title";
  title.textContent = `Can I use ${req.tool}?`;
  const pre = document.createElement("pre");
  pre.className = "perm-input";
  pre.textContent = describeInput(req.tool, req.input);
  card.append(title);
  if (req.description) {
    const desc = document.createElement("div");
    desc.className = "perm-desc";
    desc.textContent = req.description;
    card.append(desc);
  }
  const actions = document.createElement("div");
  actions.className = "perm-actions";
  const button = (label, cls, decision, mode) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = cls;
    b.onclick = () => ws.send(JSON.stringify({ type: "permission-reply", id: req.id, decision, ...(mode ? { mode } : {}) }));
    return b;
  };
  actions.append(button("Allow once", "allow", "allow"), button("Allow for this session", "session", "allow-session"), button("Deny", "deny", "deny"));
  // Like the terminal's "yes, and don't ask again": allow this and change how she asks from now on.
  if (req.tool !== "ExitPlanMode") {
    const more = document.createElement("div");
    more.className = "perm-more";
    if (state.provider === "claude" && state.permissionMode !== "acceptEdits" && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(req.tool)) {
      more.append(button("Allow, and accept all edits", "ghost", "allow", "acceptEdits"));
    }
    if (state.provider === "claude" && state.permissionMode !== "auto") more.append(button("Allow, and switch to Auto", "ghost", "allow", "auto"));
    if ((state.provider === "cursor" || state.provider === "opencode") && state.permissionMode !== "everything") {
      more.append(button("Allow, and run everything", "ghost", "allow", "everything"));
    }
    if (more.children.length) actions.append(more);
  }
  card.append(pre, actions);
  log.append(card);
  log.scrollTop = log.scrollHeight;
  permEls.set(req.id, { card, actions });
}

// A long conversation whose prompt cache has expired: the message waits until the user picks how to pay for it.
let coldEl = null; // { card, actions, text }

function addColdCache(msg) {
  coldEl?.card.remove();
  const card = document.createElement("div");
  card.className = "msg perm";
  const title = document.createElement("div");
  title.className = "perm-title";
  title.textContent = "Her memory of this chat has gone cold";
  const desc = document.createElement("div");
  desc.className = "perm-desc";
  desc.textContent =
    `This conversation is about ${msg.tokens} tokens and she has been idle for ${msg.idle}. Claude's cache has expired, so ` +
    "your message has to send all of it again at full price, which can use a large part of your usage limit. " +
    "Summarising reads it once as well, but then every later message stays cheap; the summary loses some detail.";
  const actions = document.createElement("div");
  actions.className = "perm-actions";
  const button = (label, cls, choice) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = cls;
    b.onclick = () => ws.send(JSON.stringify({ type: "cold-reply", choice }));
    return b;
  };
  actions.append(button("Summarise, then send", "allow", "summarise"), button("Send as it is", "session", "send"), button("Don't send", "deny", "cancel"));
  card.append(title, desc, actions);
  log.append(card);
  log.scrollTop = log.scrollHeight;
  coldEl = { card, actions, text: msg.text };
}

function resolveColdCache(choice) {
  if (!coldEl) return;
  const done = document.createElement("div");
  done.className = "perm-done";
  done.textContent = { summarise: "Summarising first, then sending", send: "Sent as it is", cancel: "Not sent", dropped: "Cancelled" }[choice] ?? "Done";
  coldEl.actions.replaceWith(done);
  // Not sent: give the user their words back instead of losing them.
  if ((choice === "cancel" || choice === "dropped") && !input.value) {
    input.value = coldEl.text;
    input.dispatchEvent(new Event("input"));
  }
  coldEl = null;
}

function resolvePermission(id, text) {
  const el = permEls.get(id);
  if (!el) return;
  const done = document.createElement("div");
  done.className = "perm-done";
  done.textContent = text;
  el.actions.replaceWith(done);
  permEls.delete(id);
}

function handle(msg) {
  switch (msg.type) {
    case "history": {
      // The conversation so far, replayed to a freshly opened or reloaded tab.
      log.replaceChildren();
      coldEl = null;
      toolEls.clear();
      for (const item of msg.items) {
        if (item.type === "user") addUserMsg(item.text, [], item.images ?? 0);
        else if (item.type === "bot") {
          const { clean } = parseReply(item.text);
          if (clean) addMsg("bot", clean);
        } else if (item.type === "images") addImageStrip(item.images);
        else if (item.type === "shell") addShell(item.command, item.output, item.code);
        else if (item.type === "look") addMsg("look", `✨ new look: ${item.applied.join(", ")}`);
        else if (item.type === "tool") {
          const icon = { running: "⏳", done: "✓", error: "✗" }[item.status === "running" ? "done" : item.status];
          addMsg(`tool ${item.status === "error" ? "error" : "done"}`, `${icon} ${item.name}${item.summary ? " · " + item.summary : ""}`);
        }
      }
      break;
    }
    case "mode":
      state = { ...state, ...msg };
      if (msg.mode === "work") wantWork = false;
      renderMode();
      break;
    case "looks":
      $("undo-look").disabled = !msg.canUndo;
      lastLooks = msg;
      presetNames = msg.presets ?? [];
      renderLooksMenu();
      break;
    case "packs":
      packNames = msg.names ?? [];
      activePackName = msg.active ?? null;
      renderLooksMenu();
      break;
    case "meter":
      meter = msg;
      renderMeter();
      break;
    case "preset-thumbs":
      presetThumbs = msg.svgs;
      gallerySlot?.();
      break;
    case "notice":
      addMsg("sys", msg.text);
      break;
    case "phone":
      if (Array.isArray(msg.links) && Array.isArray(msg.qr)) addPhoneCard(msg.links.map(String), msg.qr.map(String));
      break;
    case "status":
      statusText = msg.text;
      markActivity();
      renderWorking();
      break;
    case "tool": {
      const icon = { running: "⏳", done: "✓", error: "✗" }[msg.status];
      markActivity();
      if (msg.status === "running") runningTools.set(msg.id, msg.name);
      else runningTools.delete(msg.id);
      renderWorking();
      let el = toolEls.get(msg.id);
      if (!el) {
        // text after a tool call belongs in a new message, so the log keeps its order
        speakRest();
        botEl = null;
        raw = "";
        gesturesDone = 0;
        el = document.createElement("div");
        el.innerHTML = '<span class="st"></span><span class="tx"></span>';
        log.append(el);
        toolEls.set(msg.id, el);
        el.querySelector(".tx").textContent = `${msg.name}${msg.summary ? " · " + msg.summary : ""}`;
      }
      el.className = `msg tool ${msg.status}`;
      el.querySelector(".st").textContent = icon;
      log.scrollTop = log.scrollHeight;
      break;
    }
    case "permission":
      addPermission(msg.request);
      break;
    case "permission-resolved":
      resolvePermission(msg.id, { allow: "✓ Allowed", "allow-session": "✓ Allowed for this session", deny: "✗ Denied" }[msg.decision]);
      avatar.setEmotion("neutral");
      break;
    case "permission-cancelled":
      resolvePermission(msg.id, "Cancelled");
      break;
    case "cold-cache":
      addColdCache(msg);
      break;
    case "cold-resolved":
      resolveColdCache(msg.choice);
      break;
    case "hello":
      $("status").textContent = "connected";
      $("status").title = msg.provider;
      $("dot").classList.add("on");
      avatar.setVersion(msg.version);
      setBusy(busy);
      break;
    case "demo":
      if (busy) addMsg("sys", "She is still answering: ask again when she is done.");
      else {
        clearTimeout(calmTimer);
        demo.start(msg);
      }
      break;
    case "user":
      demo.cancel();
      voice.cancel();
      addUserMsg(msg.text, msg.images ?? []);
      showBubble("");
      avatar.setEmotion("thinking");
      setBusy(true);
      break;
    case "picking":
      picking = msg.on;
      renderFolderButton();
      break;
    case "images":
      addImageStrip(msg.images);
      break;
    case "shell":
      shellEls.set(msg.id, addShell(msg.command, null, null));
      break;
    case "shell-done": {
      const el = shellEls.get(msg.id);
      if (el) fillShell(el, msg.output, msg.code);
      shellEls.delete(msg.id);
      break;
    }
    case "avatar":
      addMsg("look", `✨ new look: ${msg.applied.join(", ")}`);
      avatar.setVersion(msg.version);
      break;
    case "pack":
      avatar.usePack(msg.pack);
      $("zoom").hidden = avatar.packed; // a set of pictures has one framing
      $("pack-credit").textContent = msg.pack?.credit ?? "";
      $("pack-credit").hidden = !msg.pack?.credit;
      currentLook = msg.pack ?? null;
      if ((msg.pack?.name ?? null) !== announcedLook) sayLook(); // not again on every reconnect
      announcedLook = msg.pack?.name ?? null;
      break;
    case "frames":
      avatar.receiveFrames(msg);
      break;
    case "gesture-frames":
      avatar.receiveGesture(msg);
      break;
    case "delta":
      onDelta(msg.text);
      break;
    case "done":
      endTurn();
      break;
    case "error":
      addMsg("sys", `⚠ ${msg.message}`);
      avatar.setEmotion("sad");
      endTurn();
      break;
    case "reset":
      demo.cancel();
      voice.cancel();
      log.replaceChildren();
      sayLook();
      coldEl = null;
      showBubble("");
      avatar.setEmotion("neutral");
      endTurn();
      break;
  }
}

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    $("status").textContent = "disconnected · retrying…";
    $("dot").classList.remove("on");
    setBusy(false);
    setTimeout(connect, 1500);
  };
}

// --- attaching images ---------------------------------------------------------------
// Pictures are shrunk here first (long edge 1568 px, what the model works at anyway), which
// keeps messages small; the server still enforces its own limits.

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGES = 5;
const MAX_EDGE = 1568;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
let attachments = []; // { mediaType, data (base64), url (data URL, for the preview) }

function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function prepareImage(file) {
  const name = file.name || "That image";
  if (!IMAGE_TYPES.includes(file.type)) throw new Error(`${name} is not a PNG, JPEG, GIF or WebP image.`);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) throw new Error(`${name} could not be read as an image.`);
  let blob = file;
  let type = file.type;
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale < 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    type = file.type === "image/jpeg" ? "image/jpeg" : "image/png"; // a resized GIF or WebP loses its animation
    blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
  }
  bitmap.close();
  if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error(`${name} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  const url = await readAsDataURL(blob);
  return { mediaType: type, data: url.slice(url.indexOf(",") + 1), url };
}

async function addFiles(files) {
  for (const file of files) {
    if (attachments.length >= MAX_IMAGES) {
      addMsg("sys", `At most ${MAX_IMAGES} images per message.`);
      break;
    }
    try {
      attachments.push(await prepareImage(file));
    } catch (err) {
      addMsg("sys", err.message);
    }
  }
  renderAttachments();
}

function renderAttachments() {
  const box = $("attachments");
  box.hidden = attachments.length === 0;
  box.replaceChildren(
    ...attachments.map((a, i) => {
      const thumb = document.createElement("div");
      thumb.className = "thumb";
      const img = document.createElement("img");
      img.src = a.url;
      img.alt = `attachment ${i + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "✕";
      remove.setAttribute("aria-label", "Remove image");
      remove.onclick = () => {
        attachments.splice(i, 1);
        renderAttachments();
      };
      thumb.append(img, remove);
      return thumb;
    }),
  );
}

const browserCommands = {
  "/copy": () => {
    const last = [...log.querySelectorAll(".msg.bot")].pop();
    if (last) navigator.clipboard?.writeText(last.dataset.raw ?? last.textContent).then(() => addMsg("sys", "Copied her last reply."));
    else addMsg("sys", "She has not said anything yet.");
  },
  "/export": () => {
    const lines = [...log.querySelectorAll(".msg.user, .msg.bot, .msg.tool, .msg.shell, .msg.pic-strip")].map((el) =>
      el.classList.contains("user") ? `**You:** ${el.textContent}` : el.classList.contains("bot") ? `**${state.name ?? "Risa"}:** ${el.dataset.raw ?? el.textContent}` : el.classList.contains("pic-strip") ? el.dataset.raw : el.classList.contains("shell") ? "```\n" + (el.dataset.raw ?? el.textContent) + "\n```" : `> ${el.textContent}`,
    );
    if (!lines.length) return addMsg("sys", "Nothing to export yet.");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([lines.join("\n\n") + "\n"], { type: "text/markdown" }));
    link.download = `conversation-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  },
  "/voice": () => {
    const button = $("voice");
    if (button.hidden) addMsg("sys", "This browser has no speech synthesis.");
    else button.click();
  },
};

function submit() {
  const text = input.value.trim();
  if ((!text && attachments.length === 0) || busy || ws?.readyState !== WebSocket.OPEN) return;
  if (attachments.length === 0 && Object.hasOwn(browserCommands, text)) {
    // These need this page (clipboard, downloads, the voice button), so they never reach the server.
    browserCommands[text]();
    input.value = "";
    input.style.height = "auto";
    return;
  }
  $("shell-hint").hidden = true;
  $("form").classList.remove("shell");
  ws.send(JSON.stringify({ type: "user", text, images: attachments.map(({ mediaType, data }) => ({ mediaType, data })) }));
  attachments = [];
  renderAttachments();
  input.value = "";
  input.style.height = "auto";
}

// A leading ! means "run this in the shell": show it, since nothing asks before it runs.
input.addEventListener("input", () => {
  const shell = /^!\s*\S/.test(input.value);
  $("shell-hint").hidden = !shell;
  $("form").classList.toggle("shell", shell);
});
// Stop: the button while she works, or Ctrl+C (without a text selection, so copying still works).
const stopWork = () => ws?.send(JSON.stringify({ type: "stop" }));
send.addEventListener("click", (e) => {
  if (!busy) return;
  e.preventDefault();
  stopWork();
});
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "c" || !e.ctrlKey || e.metaKey || e.altKey || !(busy || shellEls.size)) return;
  const selectedInInput = document.activeElement === input && input.selectionStart !== input.selectionEnd;
  if (selectedInInput || window.getSelection()?.toString()) return;
  e.preventDefault();
  stopWork();
});
$("attach").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", () => {
  addFiles([...$("file").files]);
  $("file").value = ""; // so choosing the same file again still fires
});
input.addEventListener("paste", (e) => {
  const pictures = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (pictures.length === 0) return; // plain text pastes as usual
  e.preventDefault();
  addFiles(pictures);
});
const panel = document.querySelector(".panel");
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
panel.addEventListener("dragover", (e) => {
  if (!hasFiles(e) || $("attach").disabled) return;
  e.preventDefault();
  panel.classList.add("drop-target");
});
panel.addEventListener("dragleave", (e) => {
  if (!panel.contains(e.relatedTarget)) panel.classList.remove("drop-target");
});
panel.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  panel.classList.remove("drop-target");
  if (!$("attach").disabled) addFiles([...e.dataTransfer.files]);
});
$("form").addEventListener("submit", (e) => { e.preventDefault(); submit(); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !composing(e)) { e.preventDefault(); submit(); }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
});
$("reset").addEventListener("click", () => ws?.send(JSON.stringify({ type: "reset" })));

$("provider").addEventListener("change", () => {
  ws?.send(JSON.stringify({ type: "provider", provider: $("provider").value }));
  renderBrain(); // snaps back to the server's answer if it refuses
});
$("use-setup").addEventListener("change", () => {
  ws?.send(JSON.stringify({ type: "claude-setup", value: $("use-setup").checked }));
});
$("effort").addEventListener("change", () => {
  ws?.send(JSON.stringify({ type: "effort", value: $("effort").value }));
});
$("permission-mode").addEventListener("change", () => {
  ws?.send(JSON.stringify({ type: "permission-mode", value: $("permission-mode").value }));
  renderMode(); // snaps back to the server's answer if it refuses
});
$("ollama-model").addEventListener("change", () => {
  ws?.send(JSON.stringify({ type: "provider", provider: "ollama", model: $("ollama-model").value }));
});
$("cursor-model").addEventListener("change", () => {
  ws?.send(JSON.stringify({ type: "provider", provider: "cursor", model: $("cursor-model").value }));
});
$("opencode-model").addEventListener("change", () => {
  ws?.send(JSON.stringify({ type: "provider", provider: "opencode", model: $("opencode-model").value }));
});
$("mode-chat").addEventListener("click", () => {
  wantWork = false;
  ws?.send(JSON.stringify({ type: "mode", mode: "chat" }));
  renderMode();
});
$("mode-work").addEventListener("click", () => {
  if (state.projectDir) {
    ws?.send(JSON.stringify({ type: "mode", mode: "work" }));
  } else {
    wantWork = true;
    renderMode();
    $("folder").focus();
  }
});
// The work bar can fold away to a one-line summary, to give the chat more room.
function setWorkbarCollapsed(collapsed, remember = true) {
  $("workbar").classList.toggle("collapsed", collapsed);
  $("workbar-expand").setAttribute("aria-expanded", String(!collapsed));
  $("workbar-collapse").setAttribute("aria-expanded", String(!collapsed));
  if (!remember) return; // restoring the saved state: no focus change
  try { localStorage.setItem("workbarCollapsed", collapsed ? "1" : "0"); } catch {}
  (collapsed ? $("workbar-expand") : $("workbar-collapse")).focus({ preventScroll: true }); // keep the keyboard where it was
}
function renderWorkSummary() {
  const dir = state.projectDir;
  const name = dir ? dir.replace(/\/+$/, "").split("/").pop() : "";
  $("worksummary-text").textContent = dir ? `📁 ${name || dir}` : "No folder chosen";
  $("worksummary-text").title = dir ?? "";
}
$("workbar-collapse").addEventListener("click", () => setWorkbarCollapsed(true));
$("workbar-expand").addEventListener("click", () => setWorkbarCollapsed(false));
try {
  // On a phone the folder bar starts folded away (it is tall, and pushes the message box off a short screen);
  // anyone who has opened or folded it themselves keeps their choice.
  const kept = localStorage.getItem("workbarCollapsed");
  if (kept === "1" || (kept === null && matchMedia("(max-width: 800px)").matches)) setWorkbarCollapsed(true, false);
} catch {}
$("worksummary-text").addEventListener("click", () => setWorkbarCollapsed(false));

// "Work here" applies what is typed; once she already works in that folder the same button opens a folder dialog,
// since the next thing someone wants there is a different folder.
let picking = false;
const folderUnchanged = () => state.mode === "work" && Boolean(state.projectDir) && $("folder").value.trim().replace(/(?<=.)\/+$/, "") === state.projectDir;

function renderFolderButton() {
  const button = $("folder-set");
  const choose = folderUnchanged();
  button.textContent = picking ? "Choosing…" : choose ? "Choose folder…" : "Work here";
  button.disabled = picking;
  button.title = choose ? "Pick a different folder in a dialog" : "Work in the folder typed here";
}
$("folder").addEventListener("input", renderFolderButton);

function applyTypedFolder() {
  ws?.send(JSON.stringify({ type: "mode", mode: "work", projectDir: $("folder").value }));
}
$("folder-set").addEventListener("click", () => {
  if (folderUnchanged()) ws?.send(JSON.stringify({ type: "pick-folder" }));
  else applyTypedFolder();
});
$("folder").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !composing(e)) applyTypedFolder(); // Enter always means "use what I typed"
});
renderMode();

// --- usage footer ----------------------------------------------------------------------
let meter = null;
const STALE_MS = 10 * 60 * 1000; // limits only update when she replies; older numbers are dimmed

function percent(fraction) {
  return `${Math.round(fraction * 100)}%`;
}

function resetText(resetsAt) {
  if (!resetsAt) return "";
  const when = new Date(resetsAt * 1000);
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = when.toDateString() === new Date().toDateString();
  return sameDay ? time : `${when.toLocaleDateString([], { month: "numeric", day: "numeric" })} ${time}`;
}

// The footer can be folded away to one small word; the choice is remembered in this browser.
let meterCollapsed = false;
try { meterCollapsed = localStorage.getItem("meterCollapsed") === "1"; } catch {}

function renderMeter() {
  const box = $("meter");
  if (!meter) return void (box.hidden = true);
  const stale = meter.limitsAt === null || Date.now() - meter.limitsAt > STALE_MS;
  const parts = [];
  let worst = 0;
  const add = (text, fraction, title) => {
    const span = document.createElement("span");
    span.textContent = text;
    span.title = title;
    if (fraction >= 0.95) span.className = "bad";
    else if (fraction >= 0.8) span.className = "warn";
    worst = Math.max(worst, fraction);
    parts.push(span);
  };
  if (meter.model) add(meter.effort ? `${meter.model} (${meter.effort})` : meter.model, 0, "The model answering you" + (meter.effort ? " and how hard she thinks" : ""));
  if (meter.session) {
    add(`session: ${percent(meter.session.used)}${meter.session.resetsAt ? ` (resets ${resetText(meter.session.resetsAt)})` : ""}`, meter.session.used, "Your five-hour usage window with Claude" + (stale ? " (as of her last reply)" : ""));
  }
  if (meter.week) {
    add(`week: ${percent(meter.week.used)}${meter.week.resetsAt ? ` (resets ${resetText(meter.week.resetsAt)})` : ""}`, meter.week.used, "Your seven-day usage window with Claude" + (stale ? " (as of her last reply)" : ""));
  }
  if (meter.ctx !== null) add(`ctx: ${percent(meter.ctx)}`, meter.ctx, "How full her memory of this conversation is. /compact frees it up.");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "meter-toggle";
  toggle.setAttribute("aria-expanded", String(!meterCollapsed));
  toggle.title = meterCollapsed ? "Show the usage details" : "Hide the usage details";
  toggle.textContent = meterCollapsed ? `▸ Usage${worst >= 0.8 ? " ⚠" : ""}` : "▾";
  if (meterCollapsed && worst >= 0.8) toggle.classList.add(worst >= 0.95 ? "bad" : "warn");
  toggle.addEventListener("click", () => {
    meterCollapsed = !meterCollapsed;
    try { localStorage.setItem("meterCollapsed", meterCollapsed ? "1" : "0"); } catch {}
    renderMeter();
  });
  const details = parts.flatMap((p, i) => (i ? [document.createTextNode(" | "), p] : [p]));
  box.replaceChildren(toggle, ...(meterCollapsed ? [] : [document.createTextNode(" "), ...details]));
  box.classList.toggle("stale", stale && Boolean(meter.session || meter.week));
  box.hidden = parts.length === 0;
}
setInterval(() => meter && renderMeter(), 60_000);

// --- looks menu and its galleries (presets, packs) --------------------------------------
let lastLooks = { names: [], presets: [] };
let packNames = [];
let activePackName = null; // the picture pack in use, or null for the drawn avatar

function renderLooksMenu() {
  const select = $("looks");
  const group = (label, options) => {
    const g = document.createElement("optgroup");
    g.label = label;
    g.append(...options);
    return g;
  };
  select.replaceChildren(
    new Option("Looks…", ""),
    ...(lastLooks.names.length ? [group("My looks", lastLooks.names.map((n) => new Option(n, `look:${n}`)))] : []),
    ...(lastLooks.presets?.length ? [new Option("Presets…", "gallery")] : []),
    ...(packNames.length ? [new Option("Packs…", "packs")] : []),
  );
  select.disabled = select.options.length === 1;
}

let presetNames = [];
let presetThumbs = null; // { name: svg } once the server has sent them

/**
 * Inline SVGs share one id namespace per page, and each drawing refers to ids such as the
 * eye clip paths; without a prefix the thumbnails would all use the main avatar's, so their eyes vanish.
 */
function uniqueIds(svg, prefix) {
  return svg
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`)
    .replace(/href="#([^"]+)"/g, (_, id) => `href="#${prefix}${id}"`);
}

function closeGallery() {
  document.querySelector(".gallery")?.remove();
}

/** One choice in the packs gallery: a pack's neutral picture, or null for the drawn avatar. */
function packItem(name) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "preset";
  item.title = name ?? "The avatar drawn by code";
  if (name === activePackName) item.setAttribute("aria-current", "true");
  const pic = document.createElement("span");
  pic.className = "preset-pic";
  if (name === null) {
    pic.classList.add("plain");
    pic.textContent = "drawn by code";
  } else {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = `/pack-thumb/${encodeURIComponent(name)}`;
    pic.append(img);
  }
  item.append(pic, Object.assign(document.createElement("span"), { className: "preset-name", textContent: name ?? "Drawn avatar" }));
  item.onclick = () => {
    closeGallery();
    if (name !== activePackName) ws?.send(JSON.stringify({ type: "pack-select", name }));
  };
  return item;
}

function openGallery(kind = "presets") {
  if (document.querySelector(".gallery")) return closeGallery();
  const packs = kind === "packs";
  const box = document.createElement("div");
  box.className = "gallery";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", packs ? "Choose a picture pack" : "Choose a preset character");
  const grid = document.createElement("div");
  grid.className = "gallery-grid";
  box.append(
    Object.assign(document.createElement("div"), {
      className: "gallery-title",
      textContent: packs ? "Packs: your own pictures instead of the drawn avatar" : "Presets: pick a character",
    }),
    grid,
  );
  document.querySelector(".stage").append(box);
  const fill = () => {
    if (packs) return grid.replaceChildren(...[null, ...packNames].map(packItem));
    grid.replaceChildren(
      ...presetNames.map((name) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "preset";
        item.title = name;
        const pic = document.createElement("span");
        pic.className = "preset-pic";
        // our own renderer's SVG; show the head and shoulders
        if (presetThumbs?.[name]) pic.innerHTML = uniqueIds(presetThumbs[name], `preset-${name}-`).replace(/viewBox="[^"]*"/, 'viewBox="75 10 250 250"');
        item.append(pic, Object.assign(document.createElement("span"), { className: "preset-name", textContent: name }));
        item.onclick = () => {
          closeGallery();
          ws?.send(JSON.stringify({ type: "look-preset", name }));
        };
        return item;
      }),
    );
  };
  const fillAndFocus = () => {
    fill();
    grid.querySelector("button")?.focus(); // so arrow keys and Escape work from the start
  };
  fillAndFocus();
  if (!packs && !presetThumbs) {
    gallerySlot = fillAndFocus;
    ws?.send(JSON.stringify({ type: "preset-thumbs" }));
  }
  box.addEventListener("keydown", (e) => {
    const items = [...grid.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + columns, ArrowUp: i - columns }[e.key];
    if (e.key === "Escape") closeGallery();
    else if (next !== undefined && items[next]) items[next].focus();
    else return;
    e.preventDefault();
  });
}
let gallerySlot = null;
document.addEventListener("click", (e) => {
  if (!e.target.closest(".gallery, #looks")) closeGallery();
});

$("undo-look").addEventListener("click", () => ws?.send(JSON.stringify({ type: "look-undo" })));
$("looks").addEventListener("change", () => {
  const value = $("looks").value;
  if (value === "gallery") openGallery("presets");
  else if (value === "packs") openGallery("packs");
  else if (value.startsWith("look:")) ws?.send(JSON.stringify({ type: "look-load", name: value.slice(5) }));
  $("looks").value = "";
});
$("save-look").addEventListener("click", () => {
  const form = $("save-look-form");
  form.hidden = !form.hidden;
  if (!form.hidden) $("look-name").focus();
});
$("save-look-form").addEventListener("submit", (e) => {
  e.preventDefault();
  ws?.send(JSON.stringify({ type: "look-save", name: $("look-name").value }));
  $("look-name").value = "";
  $("save-look-form").hidden = true;
});

if (voice.supported) {
  const button = $("voice");
  button.hidden = false;
  const pick = $("voice-pick");
  const rate = $("voice-rate");
  const render = () => {
    button.textContent = voice.enabled ? "Voice: on" : "Voice: off";
    pick.hidden = rate.hidden = !voice.enabled;
  };
  const fillVoices = () => {
    const voices = voice.voices(navigator.language || document.documentElement.lang);
    const key = voices.map((v) => v.label).join("\n");
    if (pick.dataset.key === key) return; // nothing new: do not rebuild a menu that may be open
    pick.dataset.key = key;
    pick.replaceChildren(
      new Option("Default voice", ""),
      ...voices.map((v) => {
        const option = new Option(v.label, v.uri);
        option.dataset.lang = v.lang;
        return option;
      }),
    );
    pick.value = voices.some((v) => v.uri === voice.voiceURI) ? voice.voiceURI : "";
  };
  refreshVoices = fillVoices;
  voice.watchVoices(fillVoices);
  pick.addEventListener("pointerdown", fillVoices); // the list may have grown since the page opened
  rate.replaceChildren(...RATES.map((r) => new Option(r === 1 ? "Speed 1×" : `Speed ${r}×`, String(r))));
  rate.value = String(voice.rate);
  if (rate.value !== String(voice.rate)) rate.value = "1.05";
  // Changing either one plays a sample, so you can hear the difference at once.
  const sample = (lang) => {
    voice.cancel();
    voice.speak(sampleText(lang)); // waits a moment after the cancel, see speech.js
  };
  pick.addEventListener("change", () => {
    voice.setVoice(pick.value);
    const chosen = pick.selectedOptions[0];
    addMsg("sys", pick.value ? `Voice: ${chosen.textContent}` : "Voice: the browser's default");
    sample(chosen.dataset.lang ?? navigator.language);
  });
  rate.addEventListener("change", () => {
    voice.setRate(Number(rate.value));
    sample(pick.selectedOptions[0]?.dataset.lang ?? navigator.language);
  });
  render();
  button.addEventListener("click", () => {
    voice.setEnabled(!voice.enabled);
    avatar.setTalking(false);
    render();
    // On a phone the tool row scrolls sideways; show the two menus that just appeared.
    if (voice.enabled) rate.scrollIntoView({ inline: "nearest", block: "nearest" });
  });
}

let full = false;
$("zoom").addEventListener("click", () => {
  full = !full;
  avatar.setFull(full);
  $("zoom").textContent = full ? "Close-up" : "Full body";
});
$("reset-look").addEventListener("click", () => ws?.send(JSON.stringify({ type: "reset-look" })));

connect();

// --- resizable divider ----------------------------------------------------------------
// On a wide screen it is the line between the companion (left) and the chat: the left column's share of
// the width. On a phone the two are stacked and it is the bar between them: the top part's share of the
// height. Each is kept between its limits and remembered across visits.
(() => {
  const main = document.querySelector("main");
  const divider = $("divider");
  const phone = matchMedia("(max-width: 800px)");
  const modes = {
    wide: { key: "stageWidth", prop: "--stage", min: 30, max: 70, fallback: 62, vertical: true, keys: ["ArrowLeft", "ArrowRight"] },
    tall: { key: "stageHeight", prop: "--stage-h", min: 25, max: 75, fallback: 46, vertical: false, keys: ["ArrowUp", "ArrowDown"] },
  };
  const mode = () => (phone.matches ? modes.tall : modes.wide);
  const PAST_LIMIT = 4; // percentage points beyond the limit before that counts as meaning it
  const clamp = (m, v) => Math.min(m.max, Math.max(m.min, v));
  const set = (m, percent, save = true) => {
    const value = clamp(m, percent);
    main.style.setProperty(m.prop, `${value}%`);
    m.value = value;
    if (m === mode()) divider.setAttribute("aria-valuenow", String(Math.round(value)));
    if (save) try { localStorage.setItem(m.key, String(value)); } catch {}
  };
  for (const m of Object.values(modes)) {
    let saved = m.fallback;
    try { saved = Number(localStorage.getItem(m.key)) || m.fallback; } catch {}
    set(m, saved, false);
  }
  // The same element serves both layouts, so what it tells assistive technology follows the layout.
  const describe = () => {
    const m = mode();
    divider.setAttribute("aria-orientation", m.vertical ? "vertical" : "horizontal");
    divider.setAttribute("aria-valuemin", String(m.min));
    divider.setAttribute("aria-valuemax", String(m.max));
    divider.setAttribute("aria-valuenow", String(Math.round(m.value)));
    divider.title = m.vertical ? "Drag to resize (double-click to reset)" : "Drag up or down to resize (double-tap to reset)";
  };
  describe();
  phone.addEventListener("change", describe);
  divider.addEventListener("pointerdown", (e) => {
    divider.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
  });
  divider.addEventListener("pointermove", (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    const m = mode();
    const box = main.getBoundingClientRect();
    const percent = m.vertical ? ((e.clientX - box.left) / box.width) * 100 : ((e.clientY - box.top) / box.height) * 100;
    // Dragged on past the smallest she gets: the chat takes the whole page and she goes behind it.
    if (percent < m.min - PAST_LIMIT) {
      divider.releasePointerCapture(e.pointerId);
      document.body.classList.remove("resizing");
      divider.dispatchEvent(new CustomEvent("past-limit"));
      return;
    }
    set(m, percent);
  });
  const stop = () => document.body.classList.remove("resizing");
  divider.addEventListener("pointerup", stop);
  divider.addEventListener("pointercancel", stop);
  divider.addEventListener("dblclick", () => set(mode(), mode().fallback));
  divider.addEventListener("keydown", (e) => {
    const m = mode();
    const step = e.shiftKey ? 5 : 1;
    if (e.key === m.keys[0]) set(m, m.value - step);
    else if (e.key === m.keys[1]) set(m, m.value + step);
    else if (e.key === "Home") set(m, m.min);
    else if (e.key === "End") set(m, m.max);
    else return;
    e.preventDefault();
  });
})();

// --- her beside the chat, or behind it --------------------------------------------------
// The button in the chat header (or dragging the divider past its limit). Behind, the chat covers the whole page
// and she shows through it (style.css).
(() => {
  const main = document.querySelector("main");
  const button = $("view");
  let view = "split";
  try { if (localStorage.getItem("stageView") === "behind") view = "behind"; } catch {}
  const apply = () => {
    main.dataset.view = view;
    const behind = view === "behind";
    const label = behind ? "Show her beside the chat" : "Put her behind the chat";
    button.setAttribute("aria-pressed", String(behind));
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  const show = (next) => {
    view = next;
    try { localStorage.setItem("stageView", view); } catch {}
    apply();
  };
  button.addEventListener("click", () => show(view === "behind" ? "split" : "behind"));
  $("divider").addEventListener("past-limit", () => show("behind"));
  apply();
  // A pack's credit line runs across the top while she is behind the chat; the chat starts below it.
  const credit = $("pack-credit");
  new ResizeObserver(() => main.style.setProperty("--credit-h", `${credit.offsetHeight}px`)).observe(credit);
})();
