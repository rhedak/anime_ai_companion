// Runs before public/app.js and hands it a socket that lives in this page instead of a WebSocket to a server.
import { loadRenderer } from "./render-bridge.js";
import { createLocalSocket } from "./local-socket.js";
import { reply } from "./script.js";

const emotions = await (await fetch("emotions.json")).json();

/** @type {any} */ (window).anaicoSocket = () => {
  // The renderer starts a moment after the socket exists, so its first progress line has somewhere to go.
  const socket = createLocalSocket({
    renderer: Promise.resolve().then(() => loadRenderer({ onStatus: (text) => socket.notice(text) })),
    emotions,
    reply,
  });
  return socket;
};
