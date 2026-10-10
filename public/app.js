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
  avatar.setTalking(false);
  botEl = null;
  raw = "";
  setBusy(false);
  clearTimeout(calmTimer);
  calmTimer = setTimeout(() => avatar.setEmotion("neutral"), 9000);
}

function handle(msg) {
  switch (msg.type) {
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

let full = false;
$("zoom").addEventListener("click", () => {
  full = !full;
  avatar.setFull(full);
  $("zoom").textContent = full ? "Close-up" : "Full body";
});
$("reset-look").addEventListener("click", () => ws?.send(JSON.stringify({ type: "reset-look" })));

connect();
