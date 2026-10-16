// The renderer in the browser: the creator's own drawing code, compiled from TypeScript to JavaScript (about half a megabyte, no library
// and no download from anywhere else), and this app's request handling (src/render-ops.ts, compiled the same way). It is the code the
// server's worker thread runs, so a request gets the same reply here as there. Nothing in this file draws anything itself.
// `demo/stage.mjs` builds the two folders it needs and puts them next to the page:
//   js/render-ops.js       src/render-ops.ts (createRenderOps, creatorFromModules)
//   creator/js/<name>.js   the creator's ts/src files
// Both are loaded by relative URL from this file, so the demo works under any sub-folder (/demo/ on the docs site).

/** The compiled module at `path` (relative to this file), imported at run time. */
const load = (path) => import(new URL(path, import.meta.url).href);

/**
 * Loads the creator and returns `{ call(request) }`, which answers a request of src/render-ops.ts ({"op": "frames", ...}) with its reply.
 * `onStatus(text)` is told what is happening (the first load is half a megabyte of JavaScript).
 * @param {{ onStatus?: (text: string) => void }} [options]
 */
export async function loadRenderer({ onStatus = () => {} } = {}) {
  onStatus("Loading her drawing code…");
  const [ops, render, presets, head, body, model, urlstate, pynum, pyjson, pyjsonload, pyvalue] = await Promise.all([
    load("js/render-ops.js"),
    ...["render", "presets", "core-head", "body", "model", "urlstate", "pynum", "pyjson", "pyjsonload", "pyvalue"].map((name) => load(`creator/js/${name}.js`)),
  ]);
  const { handleLine } = ops.createRenderOps(ops.creatorFromModules({ render, presets, head, body, model, urlstate, pynum, pyjson, pyjsonload, pyvalue }));
  return {
    // This runs on the page's own thread, so a request blocks the page while it draws; the frames are small, and a worker can come later.
    // A request is JSON text in and a reply JSON text out, as it is between the server and its worker thread.
    async call(request) {
      return JSON.parse(handleLine(JSON.stringify(request)));
    },
  };
}
