// The dialog that offers the small in-browser model: what it is, where it comes from, how big it is, and an honest word about how good it is.
// Nothing is downloaded until the visitor presses the button. Built with createElement and textContent only.

import { webgpuSupport } from "./model.js";
import { MODEL } from "./model-prompt.js";

const DOCS = "https://rhedak.github.io/anime_ai_companion/brains.html#ollama";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const link = (text, href) => el("a", { href, textContent: text, target: "_blank", rel: "noopener noreferrer" });

/**
 * @param {{ model: ReturnType<typeof import("./model.js").createModel>, onReady: () => void, onOff: () => void, onRemoved: () => void }} options
 * @returns {{ open(): void }}
 */
export function createModelDialog({ model, onReady, onOff, onRemoved }) {
  const dialog = /** @type {HTMLDialogElement} */ (el("dialog", { id: "model-dialog", className: "model-dialog" }));
  dialog.setAttribute("aria-labelledby", "model-dialog-title");
  document.body.append(dialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close(); // a click on the backdrop
  });

  let loading = false;
  let error = "";
  let progress = { fraction: 0, text: "" };

  async function render() {
    const support = await webgpuSupport();
    const cached = support.ok && (await model.installed());
    const lines = [];
    const buttons = [];
    const close = el("button", { type: "button", textContent: "Close", className: "quiet" });
    close.onclick = () => dialog.close();

    if (loading) {
      lines.push(el("p", {}, cached ? "Loading the model from this browser's storage…" : `Downloading the model (about ${MODEL.downloadMB} MB)…`));
      const bar = el("progress", { max: 1, value: progress.fraction });
      lines.push(bar, el("p", { className: "model-progress", textContent: progress.text }));
      lines.push(el("p", { className: "model-note" }, "You can close this: it carries on, and she tells you when it is ready."));
      buttons.push(close);
    } else if (model.ready()) {
      lines.push(el("p", {}, "The small model is on: it answers what her script cannot (a chat, a joke, a question). Changing her looks still works as before."));
      const off = el("button", { type: "button", textContent: "Turn it off" });
      off.onclick = () => (model.setEnabled(false), onOff(), dialog.close());
      const remove = el("button", { type: "button", textContent: `Remove it from this browser (frees ${MODEL.downloadMB} MB)`, className: "quiet" });
      remove.onclick = async () => {
        remove.disabled = true;
        await model.remove();
        onRemoved();
        dialog.close();
      };
      buttons.push(off, remove, close);
    } else if (!support.ok) {
      lines.push(el("p", {}, support.reason ?? "This browser cannot run it."));
      lines.push(el("p", { className: "model-note" }, "Everything else in the demo works without it."));
      buttons.push(close);
    } else {
      const go = el("button", {
        type: "button",
        className: "primary",
        textContent: model.loaded() ? "Turn it on" : cached ? "Load it (already in this browser)" : `Download and use it (${MODEL.downloadMB} MB)`,
      });
      go.onclick = () => start();
      buttons.push(go, el("button", { type: "button", textContent: "Not now", className: "quiet", onclick: () => dialog.close() }));
    }

    const intro = loading || model.ready() || !support.ok
      ? []
      : [
          el("p", {}, `This downloads a small language model, ${MODEL.title}, once (about ${MODEL.downloadMB} MB, plus a library of about 2 MB) and runs it on your graphics card, inside this page.`),
          el("p", {}, "It comes from huggingface.co (the model), cdn.jsdelivr.net (the library that runs it) and raw.githubusercontent.com (its compiled GPU code); those servers see your IP address when you download. Nothing you type is sent to anyone, before or after. Your browser keeps the files for next time, and you can remove them here."),
          el("p", { className: "model-warning" }, "It is small, so its answers are simple and often wrong, and the first answer can take 10 to 20 seconds on a laptop's built-in graphics. For a proper chat we recommend running a model on your own computer rather than in the browser, for example with ", link("Ollama", DOCS), "."),
          el("p", { className: "model-note" }, `Model: ${MODEL.title} by Hugging Face (${MODEL.licence}), run with WebLLM (Apache-2.0).`),
          ...(error ? [el("p", { className: "model-error", textContent: error })] : []),
        ];
    dialog.replaceChildren(
      el("h2", { id: "model-dialog-title", textContent: "Chat with a small model in your browser" }),
      ...intro,
      ...lines,
      el("div", { className: "model-buttons" }, ...buttons),
    );
  }

  async function start() {
    loading = true;
    error = "";
    progress = { fraction: 0, text: "" };
    await render();
    try {
      await model.load((fraction, text) => {
        progress = { fraction, text };
        const bar = dialog.querySelector("progress");
        if (bar) bar.value = fraction;
        const caption = dialog.querySelector(".model-progress");
        if (caption) caption.textContent = text;
      });
      loading = false;
      onReady();
      if (dialog.open) dialog.close();
    } catch (err) {
      loading = false;
      error = `It could not be loaded: ${err?.message ?? err}`;
      if (dialog.open) await render();
    }
  }

  return {
    open() {
      void render().then(() => {
        if (!dialog.open) dialog.showModal();
      });
    },
  };
}
