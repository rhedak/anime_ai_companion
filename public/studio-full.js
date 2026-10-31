/**
 * The full pack studio on its own page (opened from "Open full studio" in the panel). It is the same studio as the panel
 * (studio.js), with the same socket and the same server rules; this page only shows it in a tab of its own.
 * Loopback only: the server answers any other address with "not found" (src/http-routes.ts).
 */
import { createStudio } from "./studio.js";

const host = /** @type {HTMLElement} */ (document.getElementById("studio-host"));
let ws = /** @type {WebSocket | null} */ (null);
let first = true;

const studio = createStudio({
  send: (msg) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)),
  host: () => host,
  say: (text) => {
    const line = document.createElement("p");
    line.textContent = text;
    host.append(line);
    return line;
  },
  closeWindow: () => {
    // A tab the page opened closes; one the user opened by hand (or the desktop app's browser) may not, so say what to do.
    window.close();
    const note = document.createElement("p");
    note.textContent = "The pack studio is closed. You can close this tab.";
    host.append(note);
  },
});

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (typeof msg.type !== "string" || !msg.type.startsWith("studio-")) return;
    studio.handle(msg);
    // The first state of this page opens the panel: when the studio is off, that asks whether to turn it on, as the panel does.
    if (first && msg.type === "studio-state") {
      first = false;
      if (!studio.isOpen()) studio.open();
    }
  };
  ws.onclose = () => setTimeout(connect, 1500);
}

connect();
