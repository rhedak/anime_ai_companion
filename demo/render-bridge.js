// The renderer in the browser: Pyodide (Python compiled to WebAssembly) running the very same python/render_ops.py as the server's
// worker, on the creator's own package. Nothing here draws anything itself. The files it needs sit next to the page:
//   creator-files.json              the list of the creator's .py files
//   creator/<path>                  each of them
//   render_ops.py                   the request handling shared with the server

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(el);
  });
}

const text = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
};

/**
 * Loads Python and the creator, and returns `{ call(request) }`, which answers a request of python/render_ops.py with its reply.
 * `onStatus(text)` is told what is happening (the first load is a few megabytes).
 * @param {{ onStatus?: (text: string) => void }} [options]
 */
export async function loadRenderer({ onStatus = () => {} } = {}) {
  onStatus("Loading the in-browser Python (a few megabytes, once)…");
  await loadScript(`${PYODIDE}pyodide.js`);
  const pyodide = await globalThis.loadPyodide({ indexURL: PYODIDE });

  onStatus("Loading her drawing code…");
  const files = JSON.parse(await text("creator-files.json"));
  for (const path of files) {
    const dir = `/pkg/${path.split("/").slice(0, -1).join("/")}`;
    pyodide.FS.mkdirTree(dir);
    pyodide.FS.writeFile(`/pkg/${path}`, await text(`creator/${path}`));
  }
  pyodide.FS.mkdirTree("/app");
  pyodide.FS.writeFile("/app/render_ops.py", await text("render_ops.py"));
  pyodide.runPython(`
import sys, json as _json
sys.path.insert(0, "/pkg")
sys.path.insert(0, "/app")
from render_ops import handle as _handle

def _call(request_json):
    return _json.dumps(_handle(_json.loads(request_json)))
`);
  const call = pyodide.globals.get("_call");
  return {
    // Python runs on this thread, so a request blocks the page while it draws; the frames are small, and a worker can come later.
    async call(request) {
      return JSON.parse(call(JSON.stringify(request)));
    },
  };
}
