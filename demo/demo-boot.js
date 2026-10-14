// Runs before public/app.js and hands it a socket that lives in this page instead of a WebSocket to a server, and adds the demo's
// suggested prompts above the message box.
import { loadRenderer } from "./render-bridge.js";
import { createLocalSocket } from "./local-socket.js";
import { GREETING, reply } from "./script.js";

// No top-level await: app.js must find `anaicoSocket` when it starts, so the emotions are fetched in the background.
const emotions = fetch("emotions.json").then((res) => res.json());
// The picture packs the demo offers (written by stage.mjs); none if the list is missing, and the demo is the same without them.
const packs = fetch("packs.json").then((res) => (res.ok ? res.json() : {})).catch(() => ({}));

/** @type {any} */ (window).anaicoSocket = () => {
  // The renderer starts a moment after the socket exists, so its first progress line has somewhere to go.
  const socket = createLocalSocket({
    renderer: Promise.resolve().then(() => loadRenderer({ onStatus: (text) => socket.notice(text) })),
    emotions,
    reply,
    greeting: GREETING,
    packs,
    onPack: (name) => showChips(name !== null),
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
];

/** @param {boolean} packed she is a set of pictures just now */
function showChips(packed) {
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
  for (const chip of packed ? PACK_CHIPS : CHIPS) {
    const { label, text } = typeof chip === "string" ? { label: chip, text: chip } : chip;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
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
