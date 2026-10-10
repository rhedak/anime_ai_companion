import { createAvatar } from "./avatar.js";
import { createVoice, takeSentences } from "./speech.js";

const $ = (id) => document.getElementById(id);
let ws = null;
const avatar = createAvatar(
  $("avatar"),
  (emotion) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "frames", emotion }));
  },
  (emotion, gesture) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "gesture-frames", emotion, gesture }));
  },
);
const log = $("log"), input = $("input"), send = $("send"), bubble = $("bubble");

// With voice on, her mouth follows the speech; otherwise it follows the arriving text.
const voice = createVoice((speaking) => {
  if (voice.enabled) avatar.setTalking(speaking);
});
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
    .replace(/\[[^\]]*$/, "")
    .replace(/^\s+/, "");
  return { clean, emotion, gestures };
}

let gesturesDone = 0; // gestures of the current reply already played

function addMsg(kind, text) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  log.append(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

/** A message of the user's, with its pictures: thumbnails when we have them, a note after a reload. */
function addUserMsg(text, pics = [], count = pics.length) {
  const div = document.createElement("div");
  div.className = "msg user";
  if (pics.length) {
    const row = document.createElement("div");
    row.className = "pics";
    for (const url of pics) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "attached image";
      row.append(img);
    }
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
  // In pro mode replies come whenever the terminal session sends them, so never lock the input.
  busy = on && state.mode !== "attached";
  send.disabled = on || !ws || ws.readyState !== WebSocket.OPEN;
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
  botEl.textContent = clean;
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
  provider: { claude: "Claude Code: the full model, tools in work mode", ollama: "A model running on your own machine (chat only)" },
  "permission-mode": {
    manual: "She asks before each action",
    plan: "She plans, and changes nothing until you approve",
    acceptEdits: "File edits go ahead; other actions still ask",
    auto: "She runs on her own and pauses if anything looks unsafe",
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
const menuRefreshers = [];
const closeMenus = () => document.querySelectorAll(".menu-pop").forEach((p) => p.remove());
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
    for (const option of select.options) {
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
    wrap.append(pop);
    button.setAttribute("aria-expanded", "true");
    (pop.querySelector('[aria-checked="true"]') ?? pop.querySelector("button")).focus();
  };
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    button.getAttribute("aria-expanded") === "true" ? close(false) : open();
  });
  const refresh = () => {
    text.textContent = select.selectedOptions[0]?.text ?? "";
    button.disabled = select.disabled;
    button.title = select.title;
  };
  refresh();
  menuRefreshers.push(refresh);
  $("menus").append(wrap);
  return wrap;
}
const providerMenu = makeMenu($("provider"), "Brain");
const ollamaMenu = makeMenu($("ollama-model"), "Ollama model");
const effortMenu = makeMenu($("effort"), "Effort");
const permissionMenu = makeMenu($("permission-mode"), "Permission mode");

function renderBrain() {
  $("provider").value = state.provider ?? "claude";
  const picker = $("ollama-model");
  const ollama = state.provider === "ollama";
  ollamaMenu.hidden = !ollama;
  effortMenu.hidden = ollama || state.mode === "attached";
  $("effort").value = state.effort ?? "default";
  if (ollama) {
    const models = state.ollamaModels ?? [];
    picker.replaceChildren(
      ...(models.length ? models : [state.ollamaModel ?? "(no models found)"]).map((m) => new Option(m, m, false, m === state.ollamaModel)),
    );
    picker.disabled = models.length === 0;
  }
  const noTools = state.canUseTools === false;
  $("mode-work").title = noTools ? "This model cannot use tools" : "Let her work in a project folder; you approve each action";
  $("provider").disabled = state.mode === "attached";
  menuRefreshers.forEach((refresh) => refresh());
}

function renderMode() {
  renderBrain();
  const attached = state.mode === "attached";
  $("mode-chat").disabled = attached;
  $("mode-work").disabled = attached || state.canUseTools === false;
  $("workrow").hidden = attached;
  $("attach").disabled = attached;
  $("attach").title = attached ? "Images cannot be sent to a terminal session" : "Attach images (or paste or drop them)";
  if (attached) {
    $("mode-chat").classList.remove("on");
    $("mode-work").classList.remove("on");
    permissionMenu.hidden = true;
    $("workbar").hidden = false;
    $("workinfo").textContent = "Pro mode: connected to your terminal Claude Code session. Permissions are handled there.";
    setBusy(false);
    return;
  }
  const work = state.mode === "work";
  $("permission-mode").value = state.permissionMode;
  permissionMenu.hidden = !work;
  menuRefreshers.forEach((refresh) => refresh());
  $("mode-chat").classList.toggle("on", !work);
  $("mode-work").classList.toggle("on", work);
  $("workbar").hidden = !(work || wantWork);
  if (state.projectDir && document.activeElement !== $("folder")) $("folder").value = state.projectDir;
  const info = $("workinfo");
  info.replaceChildren();
  if (!work) {
    info.textContent = "Pick the folder she may work in. She asks before changing anything.";
    return;
  }
  const resume = `claude --resume ${state.sessionId}`;
  const copy = document.createElement("button");
  copy.textContent = "copy";
  copy.title = "Continue this conversation in a terminal (only one side should write at a time)";
  copy.onclick = () => navigator.clipboard?.writeText(resume).then(() => (copy.textContent = "copied"));
  const pre = state.allowedTools.length ? `, without asking: ${state.allowedTools.join(", ")}` : "";
  info.append(`${state.model}${pre} · terminal: `);
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
    if (state.permissionMode !== "acceptEdits" && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(req.tool)) {
      more.append(button("Allow, and accept all edits", "ghost", "allow", "acceptEdits"));
    }
    if (state.permissionMode !== "auto") more.append(button("Allow, and switch to Auto", "ghost", "allow", "auto"));
    if (more.children.length) actions.append(more);
  }
  card.append(pre, actions);
  log.append(card);
  log.scrollTop = log.scrollHeight;
  permEls.set(req.id, { card, actions });
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
      toolEls.clear();
      for (const item of msg.items) {
        if (item.type === "user") addUserMsg(item.text, [], item.images ?? 0);
        else if (item.type === "bot") {
          const { clean } = parseReply(item.text);
          if (clean) addMsg("bot", clean);
        } else if (item.type === "look") addMsg("look", `✨ new look: ${item.applied.join(", ")}`);
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
    case "say": {
      // A whole message from the terminal session (pro mode), not a stream.
      clearTimeout(calmTimer);
      clearTimeout(talkTimer);
      const { clean, emotion, gestures } = parseReply(msg.text);
      if (emotion) avatar.setEmotion(emotion);
      for (const g of gestures) avatar.gesture(g);
      if (clean) {
        addMsg("bot", clean);
        showBubble(clean);
        if (voice.enabled) voice.speak(clean);
        else {
          avatar.setTalking(true);
          talkTimer = setTimeout(() => avatar.setTalking(false), Math.min(9000, 700 + clean.length * 45));
        }
      }
      calmTimer = setTimeout(() => avatar.setEmotion("neutral"), 9000 + clean.length * 45);
      break;
    }
    case "looks": {
      $("undo-look").disabled = !msg.canUndo;
      const select = $("looks");
      const group = (label, options) => {
        const g = document.createElement("optgroup");
        g.label = label;
        g.append(...options);
        return g;
      };
      select.replaceChildren(
        new Option("Looks…", ""),
        ...(msg.names.length ? [group("My looks", msg.names.map((n) => new Option(n, `look:${n}`)))] : []),
        ...(msg.presets?.length ? [new Option("Presets…", "gallery")] : []),
      );
      select.disabled = select.options.length === 1;
      presetNames = msg.presets ?? [];
      break;
    }
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
    case "hello":
      $("status").textContent = "connected";
      $("status").title = msg.provider;
      $("dot").classList.add("on");
      avatar.setVersion(msg.version);
      setBusy(busy);
      break;
    case "user":
      voice.cancel();
      addUserMsg(msg.text, msg.images ?? []);
      showBubble("");
      avatar.setEmotion("thinking");
      setBusy(true);
      break;
    case "avatar":
      addMsg("look", `✨ new look: ${msg.applied.join(", ")}`);
      avatar.setVersion(msg.version);
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
      voice.cancel();
      log.replaceChildren();
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
    if (last) navigator.clipboard?.writeText(last.textContent).then(() => addMsg("sys", "Copied her last reply."));
    else addMsg("sys", "She has not said anything yet.");
  },
  "/export": () => {
    const lines = [...log.querySelectorAll(".msg.user, .msg.bot, .msg.tool")].map((el) =>
      el.classList.contains("user") ? `**You:** ${el.textContent}` : el.classList.contains("bot") ? `**Mio:** ${el.textContent}` : `> ${el.textContent}`,
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
  ws.send(JSON.stringify({ type: "user", text, images: attachments.map(({ mediaType, data }) => ({ mediaType, data })) }));
  attachments = [];
  renderAttachments();
  input.value = "";
  input.style.height = "auto";
}

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
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
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
$("folder-set").addEventListener("click", () => {
  ws?.send(JSON.stringify({ type: "mode", mode: "work", projectDir: $("folder").value }));
});
$("folder").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("folder-set").click();
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

function renderMeter() {
  const box = $("meter");
  if (!meter) return void (box.hidden = true);
  const stale = meter.limitsAt === null || Date.now() - meter.limitsAt > STALE_MS;
  const parts = [];
  const add = (text, fraction, title) => {
    const span = document.createElement("span");
    span.textContent = text;
    span.title = title;
    if (fraction >= 0.95) span.className = "bad";
    else if (fraction >= 0.8) span.className = "warn";
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
  box.replaceChildren(...parts.flatMap((p, i) => (i ? [document.createTextNode(" | "), p] : [p])));
  box.classList.toggle("stale", stale && Boolean(meter.session || meter.week));
  box.hidden = parts.length === 0;
}
setInterval(() => meter && renderMeter(), 60_000);

// --- preset gallery ------------------------------------------------------------------
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

function openGallery() {
  if (document.querySelector(".gallery")) return closeGallery();
  const box = document.createElement("div");
  box.className = "gallery";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Choose a preset character");
  const grid = document.createElement("div");
  grid.className = "gallery-grid";
  box.append(Object.assign(document.createElement("div"), { className: "gallery-title", textContent: "Presets: pick a character" }), grid);
  document.querySelector(".stage").append(box);
  const fill = () => {
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
  if (!presetThumbs) {
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
  if (value === "gallery") openGallery();
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
  const render = () => (button.textContent = voice.enabled ? "Voice: on" : "Voice: off");
  render();
  button.addEventListener("click", () => {
    voice.setEnabled(!voice.enabled);
    avatar.setTalking(false);
    render();
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
// The left column's share of the width, kept between 30% and 70% and remembered across visits.
(() => {
  const main = document.querySelector("main");
  const divider = $("divider");
  const MIN = 30, MAX = 70, DEFAULT = 62;
  const clamp = (v) => Math.min(MAX, Math.max(MIN, v));
  const set = (percent, save = true) => {
    const value = clamp(percent);
    main.style.setProperty("--stage", `${value}%`);
    divider.setAttribute("aria-valuenow", String(Math.round(value)));
    if (save) try { localStorage.setItem("stageWidth", String(value)); } catch {}
  };
  let saved = DEFAULT;
  try { saved = Number(localStorage.getItem("stageWidth")) || DEFAULT; } catch {}
  set(saved, false);
  const current = () => Number(divider.getAttribute("aria-valuenow"));
  divider.addEventListener("pointerdown", (e) => {
    divider.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
  });
  divider.addEventListener("pointermove", (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    const box = main.getBoundingClientRect();
    set(((e.clientX - box.left) / box.width) * 100);
  });
  const stop = () => document.body.classList.remove("resizing");
  divider.addEventListener("pointerup", stop);
  divider.addEventListener("pointercancel", stop);
  divider.addEventListener("dblclick", () => set(DEFAULT));
  divider.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowLeft") set(current() - step);
    else if (e.key === "ArrowRight") set(current() + step);
    else if (e.key === "Home") set(MIN);
    else if (e.key === "End") set(MAX);
    else return;
    e.preventDefault();
  });
})();
