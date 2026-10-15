// Runs before public/app.js and hands it a socket that lives in this page instead of a WebSocket to a server, and adds the demo's
// suggested prompts above the message box.
import { loadRenderer } from "./render-bridge.js";
import { createLocalSocket } from "./local-socket.js";
import { GREETING, reply } from "./script.js";
import { createModel } from "./model.js";
import { createModelDialog } from "./model-dialog.js";

/** A phone-sized window: the page stacks her over the chat there, and the chat gets little height. */
const phone = () => matchMedia("(max-width: 800px)").matches;
const remembered = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
// On a phone she starts behind the chat, which then has the whole screen (the page's own "behind the chat" view, which app.js reads from
// here when it starts). A choice the visitor has made with that button is kept.
if (phone() && remembered("stageView") === null) remember("stageView", "behind");

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
/** The drawing code is still loading: the idea buttons are held until it has. */
let loading = true;

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
  // The buttons wait for her: a click before the drawing code is loaded is accepted and then nothing happens for a long while.
  void socket.ready.then(() => {
    loading = false;
    showChips(packed);
  });
  return socket;
};

// The notice at the top: the whole of it, or one short line, since it takes height from the chat. On a phone it starts short.
(() => {
  const banner = document.querySelector(".demo-banner");
  const toggle = banner?.querySelector(".demo-banner-toggle");
  if (!banner || !toggle) return;
  const saved = remembered("demoBannerCollapsed");
  const set = (collapsed) => {
    banner.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.textContent = collapsed ? "▾" : "▴";
    const label = collapsed ? "Show the whole notice" : "Hide most of this notice";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
  };
  set(saved === null ? phone() : saved === "1");
  toggle.addEventListener("click", () => {
    const collapsed = !banner.classList.contains("collapsed");
    set(collapsed);
    remember("demoBannerCollapsed", collapsed ? "1" : "0");
  });
})();

/** Things worth trying, as buttons. Each is sent exactly as if it had been typed. */
const CHIPS = [
  "Make your hair mint green",
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

/** The suggested prompts can be folded away, which gives the chat the room. */
let chipsCollapsed = remembered("demoChipsCollapsed") === "1";

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
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "chips-toggle";
    toggle.setAttribute("aria-controls", "demo-chips-list");
    toggle.addEventListener("click", () => {
      chipsCollapsed = !chipsCollapsed;
      remember("demoChipsCollapsed", chipsCollapsed ? "1" : "0");
      applyChipsState();
    });
    const list = document.createElement("div");
    list.id = "demo-chips-list";
    list.className = "chips-list";
    list.setAttribute("aria-label", "Things to try");
    bar.append(toggle, list);
    form.before(bar);
  }
  const list = /** @type {HTMLElement} */ (document.getElementById("demo-chips-list"));
  list.replaceChildren();
  for (const chip of isPacked ? PACK_CHIPS : CHIPS) {
    const { label, text, action } = typeof chip === "string" ? { label: chip, text: chip, action: null } : { text: "", action: null, ...chip };
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = typeof label === "function" ? label() : label;
    if (loading && !action) {
      button.disabled = true;
      button.title = "She is still loading";
    }
    button.addEventListener("click", () => {
      if (action) return action();
      // While she is still answering, the send button is the stop button: leave her alone until she is done.
      if (document.getElementById("send")?.classList.contains("stop")) return;
      // A command is answered without the visitor's message in the log, so a button for one says what it was.
      if (text.startsWith("/")) socket?.echo(button.textContent ?? text);
      input.value = text;
      input.dispatchEvent(new Event("input"));
      /** @type {HTMLFormElement} */ (form).requestSubmit();
    });
    list.append(button);
  }
  applyChipsState();
}

function applyChipsState() {
  const bar = document.getElementById("demo-chips");
  const toggle = bar?.querySelector(".chips-toggle");
  if (!bar || !toggle) return;
  bar.classList.toggle("collapsed", chipsCollapsed);
  toggle.setAttribute("aria-expanded", String(!chipsCollapsed));
  toggle.textContent = chipsCollapsed ? "Ideas ▾" : "Ideas ▴";
  const label = chipsCollapsed ? "Show the things to try" : "Hide the things to try";
  toggle.setAttribute("aria-label", label);
  toggle.setAttribute("title", label);
}
showChips(false);
