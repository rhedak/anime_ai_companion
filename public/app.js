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

function setBusy(on) {
  // In pro mode replies come whenever the terminal session sends them, so never lock the input.
  busy = on && state.mode !== "attached";
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

let state = { mode: "chat", projectDir: null, sessionId: null, model: "", allowedTools: [] };
let wantWork = false; // the user clicked Work but has not chosen a folder yet
const toolEls = new Map();
const permEls = new Map();

function renderBrain() {
  $("provider").value = state.provider ?? "claude";
  const picker = $("ollama-model");
  const ollama = state.provider === "ollama";
  picker.hidden = !ollama;
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
}

function renderMode() {
  renderBrain();
  const attached = state.mode === "attached";
  $("mode-chat").disabled = attached;
  $("mode-work").disabled = attached || state.canUseTools === false;
  $("workrow").hidden = attached;
  if (attached) {
    $("mode-chat").classList.remove("on");
    $("mode-work").classList.remove("on");
    $("workbar").hidden = false;
    $("workinfo").textContent = "Pro mode: connected to your terminal Claude Code session. Permissions are handled there.";
    setBusy(false);
    return;
  }
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
    case "history": {
      // The conversation so far, replayed to a freshly opened or reloaded tab.
      log.replaceChildren();
      toolEls.clear();
      for (const item of msg.items) {
        if (item.type === "user") addMsg("user", item.text);
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
      select.replaceChildren(new Option("Looks…", ""), ...msg.names.map((n) => new Option(n, n)));
      select.disabled = msg.names.length === 0;
      break;
    }
    case "notice":
      addMsg("sys", msg.text);
      break;
    case "tool": {
      const icon = { running: "⏳", done: "✓", error: "✗" }[msg.status];
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

$("provider").addEventListener("change", () => {
  ws?.send(JSON.stringify({ type: "provider", provider: $("provider").value }));
  renderBrain(); // snaps back to the server's answer if it refuses
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

$("undo-look").addEventListener("click", () => ws?.send(JSON.stringify({ type: "look-undo" })));
$("looks").addEventListener("change", () => {
  const name = $("looks").value;
  if (name) ws?.send(JSON.stringify({ type: "look-load", name }));
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
