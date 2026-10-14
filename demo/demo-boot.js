// Runs before public/app.js and hands it a socket that lives in this page instead of a WebSocket to a server, and adds the demo's
// suggested prompts above the message box.
import { loadRenderer } from "./render-bridge.js";
import { createLocalSocket } from "./local-socket.js";
import { GREETING, reply } from "./script.js";
import { createModel } from "./model.js";
import { createModelDialog } from "./model-dialog.js";

// No top-level await: app.js must find `anaicoSocket` when it starts, so the emotions are fetched in the background.
const emotions = fetch("emotions.json").then((res) => res.json());
// The picture packs the demo offers (written by stage.mjs); none if the list is missing, and the demo is the same without them.
const packs = fetch("packs.json").then((res) => (res.ok ? res.json() : {})).catch(() => ({}));

// The small in-browser model: nothing of it is loaded or fetched until the visitor opens the dialog and says yes.
const model = createModel();
const OLLAMA = "https://rhedak.github.io/anime_ai_companion/brains.html#ollama";
const modelDialog = createModelDialog({
  model,
  onReady: () => {
    showChips(packed);
    socket?.announce(
      "[emotion:happy] [gesture:wave] The small model is loaded, so now I can chat. I'm small, though: expect simple, sometimes silly answers. " +
        `For a proper chat, run a model on your own computer instead, for example with [Ollama](${OLLAMA}). Changing my looks works as before: just ask.`,
    );
  },
  onOff: () => {
    showChips(packed);
    socket?.announce("[emotion:neutral] Okay, the small model is off. I'm back to my script.");
  },
  onRemoved: () => {
    showChips(packed);
    socket?.announce("[emotion:neutral] The small model's files are removed from this browser, and it is off.");
  },
});
/** @type {ReturnType<typeof createLocalSocket> | null} */
let socket = null;
let packed = false;

/** @type {any} */ (window).anaicoSocket = () => {
  // The renderer starts a moment after the socket exists, so its first progress line has somewhere to go.
  socket = createLocalSocket({
    renderer: Promise.resolve().then(() => loadRenderer({ onStatus: (text) => socket.notice(text) })),
    emotions,
    reply,
    greeting: GREETING,
    packs,
    onPack: (name) => showChips(name !== null),
    model,
  });
  return socket;
};

/** Things worth trying, as buttons. Each is sent exactly as if it had been typed. */
const CHIPS = [
  "Make my hair mint green",
  "Blue eyes and a witch hat",
  "Put on glasses and a red coat",
  "Become Linnea",
  "Be shy",
  "Wave at me",
  { label: "Show all her expressions", text: "/show" },
  { label: "Try the picture pack", text: "/frames risa-dress" },
  "Show me work mode",
  "What can you do?",
  { label: () => (model.ready() ? "Small model: on" : "Chat with a small model…"), action: () => modelDialog.open() },
];

/** The same while she is a set of pictures: nothing that would redraw her, and the way back. */
const PACK_CHIPS = [
  "Be shy",
  "Be sad",
  "Wave at me",
  "Cheer for me",
  { label: "Show all her expressions", text: "/show" },
  "Show me work mode",
  "What can you do?",
  { label: "Back to the drawn avatar", text: "/frames off" },
  { label: () => (model.ready() ? "Small model: on" : "Chat with a small model…"), action: () => modelDialog.open() },
];

/** @param {boolean} isPacked she is a set of pictures just now */
function showChips(isPacked) {
  packed = isPacked;
  const form = document.getElementById("form");
  const input = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("input"));
  if (!form || !input) return;
  let bar = document.getElementById("demo-chips");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "demo-chips";
    bar.setAttribute("aria-label", "Things to try");
    form.before(bar);
  }
  bar.replaceChildren();
  for (const chip of isPacked ? PACK_CHIPS : CHIPS) {
    const { label, text, action } = typeof chip === "string" ? { label: chip, text: chip, action: null } : { text: "", action: null, ...chip };
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = typeof label === "function" ? label() : label;
    button.addEventListener("click", () => {
      if (action) return action();
      // While she is still answering, the send button is the stop button: leave her alone until she is done.
      if (document.getElementById("send")?.classList.contains("stop")) return;
      input.value = text;
      input.dispatchEvent(new Event("input"));
      /** @type {HTMLFormElement} */ (form).requestSubmit();
    });
    bar.append(button);
  }
}
showChips(false);
