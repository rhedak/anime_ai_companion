import { createAvatar } from "./avatar.js";

const $ = (id) => document.getElementById(id);
let ws = null;
const avatar = createAvatar($("avatar"), (emotion) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "frames", emotion }));
});
const log = $("log"), input = $("input"), send = $("send"), bubble = $("bubble");

let busy = false;
let botEl = null;
let raw = "";
let calmTimer = null;

// Strips [emotion:x] tags (including a half-streamed one at the end) and returns the last emotion.
function parseReply(text) {
  let emotion = null;
  const clean = text
    .replace(/\[emotion:(\w+)\]/g, (_, e) => ((emotion = e.toLowerCase()), ""))
    .replace(/\[avatar\b[^\]]*\]/g, "")
    .replace(/\[[^\]]*$/, "")
    .replace(/^\s+/, "");
  return { clean, emotion };
}

function addMsg(kind, text) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  log.append(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function setBusy(on) {
  busy = on;
  send.disabled = on || !ws || ws.readyState !== WebSocket.OPEN;
}

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
  clearTimeout(calmTimer);
  if (!botEl) {
    botEl = addMsg("bot", "");
    avatar.setEmotion("thinking");
  }
  raw += text;
  const { clean, emotion } = parseReply(raw);
  if (emotion) avatar.setEmotion(emotion);
  avatar.setTalking(clean.length > 0);
  botEl.textContent = clean;
  showBubble(clean);
  log.scrollTop = log.scrollHeight;
}

function endTurn() {
  toolEls.clear();
  for (const id of [...permEls.keys()]) resolvePermission(id, "Cancelled");
  avatar.setTalking(false);
  botEl = null;
  raw = "";
  setBusy(false);
  clearTimeout(calmTimer);
  calmTimer = setTimeout(() => avatar.setEmotion("neutral"), 9000);
}

// --- work mode: folder, tool activity and approvals ---------------------------------

let state = { mode: "chat", projectDir: null, sessionId: null, model: "", allowedTools: [] };
let wantWork = false; // the user clicked Work but has not chosen a folder yet
const toolEls = new Map();
const permEls = new Map();

function renderMode() {
  const work = state.mode === "work";
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
  const button = (label, cls, decision) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = cls;
    b.onclick = () => ws.send(JSON.stringify({ type: "permission-reply", id: req.id, decision }));
    return b;
  };
  actions.append(button("Allow once", "allow", "allow"), button("Allow for this session", "session", "allow-session"), button("Deny", "deny", "deny"));
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
    case "mode":
      state = { ...state, ...msg };
      if (msg.mode === "work") wantWork = false;
      renderMode();
      break;
    case "notice":
      addMsg("sys", msg.text);
      break;
    case "tool": {
      const icon = { running: "⏳", done: "✓", error: "✗" }[msg.status];
      let el = toolEls.get(msg.id);
      if (!el) {
        // text after a tool call belongs in a new message, so the log keeps its order
        botEl = null;
        raw = "";
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
      addMsg("user", msg.text);
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

function submit() {
  const text = input.value.trim();
  if (!text || busy || ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "user", text }));
  input.value = "";
  input.style.height = "auto";
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); submit(); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
});
$("reset").addEventListener("click", () => ws?.send(JSON.stringify({ type: "reset" })));

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

let full = false;
$("zoom").addEventListener("click", () => {
  full = !full;
  avatar.setFull(full);
  $("zoom").textContent = full ? "Close-up" : "Full body";
});
$("reset-look").addEventListener("click", () => ws?.send(JSON.stringify({ type: "reset-look" })));

connect();
