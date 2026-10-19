// The dialog that offers the small in-browser model: what it is, where it comes from, how big it is, and an honest word about how good it is.
// Nothing is downloaded until the visitor presses the button. Built with createElement and textContent only.

import { webgpuSupport } from "./model.js";
import { MODEL } from "./model-prompt.js";

const DOCS = "https://rhedak.github.io/anime_ai_companion/brains.html#ollama";
const DOWNLOAD = "https://rhedak.github.io/anime_ai_companion/download.html";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const link = (text, href) => el("a", { href, textContent: text, target: "_blank", rel: "noopener noreferrer" });

/**
 * @param {{ model: ReturnType<typeof import("./model.js").createModel>, ollama: ReturnType<typeof import("./ollama.js").createOllamaModel>, onReady: () => void, onOff: () => void, onRemoved: () => void, onOllamaOn: (name: string) => void, onOllamaOff: () => void }} options
 * @returns {{ open(): void }}
 */
export function createModelDialog({ model, ollama, onReady, onOff, onRemoved, onOllamaOn, onOllamaOff }) {
  const dialog = /** @type {HTMLDialogElement} */ (el("dialog", { id: "model-dialog", className: "model-dialog" }));
  dialog.setAttribute("aria-labelledby", "model-dialog-title");
  document.body.append(dialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close(); // a click on the backdrop
  });

  let loading = false;
  let error = "";
  /** What asking Ollama came to: nothing yet, a list of its models, or why it could not be reached. */
  let ollamaState = { checking: false, models: /** @type {string[]} */ ([]), error: "" };
  let progress = { fraction: 0, text: "" };

  async function render() {
    const support = await webgpuSupport();
    const cached = support.ok && (await model.installed());
    const lines = [];
    const buttons = [];
    const close = el("button", { type: "button", textContent: "Close", className: "quiet" });
    close.onclick = () => dialog.close();

    if (ollama.ready()) {
      // The two are never on together; the one that is on is shown alone.
      lines.push(el("p", {}, `Ollama is on (${ollama.name()}, on your computer): it answers what her script cannot. Changing her looks still works as before.`));
      const off = el("button", { type: "button", textContent: "Turn it off" });
      off.onclick = () => (ollama.setEnabled(false), onOllamaOff(), dialog.close());
      buttons.push(off, close);
      dialog.replaceChildren(el("h2", { id: "model-dialog-title", textContent: "Chat with a model" }), ...lines, ...fullAppNote(), el("div", { className: "model-buttons" }, ...buttons));
      return;
    }
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
      el("h2", { id: "model-dialog-title", textContent: model.ready() || loading ? "Chat with a small model in your browser" : "Chat with a model" }),
      ...(loading || model.ready() ? [] : ollamaBlock()),
      ...intro,
      ...lines,
      el("div", { className: "model-buttons" }, ...buttons),
    );
  }

  /** The offer to use Ollama on the visitor's own computer: nothing is tried until the button is pressed. */
  function ollamaBlock() {
    const nodes = [
      el("h3", { textContent: "On your computer, with Ollama (better)" }),
      el("p", {}, "If you run ", link("Ollama", DOCS), " you can use one of its models here. This page talks straight to it on your own computer; nothing is sent to anyone else, and nothing is tried until you press the button. A model of about 3B or bigger works best."),
    ];
    if (ollamaState.models.length) {
      const select = /** @type {HTMLSelectElement} */ (el("select", { id: "ollama-model", "aria-label": "Ollama model" }));
      for (const name of ollamaState.models) select.append(el("option", { value: name, textContent: name }));
      const use = el("button", { type: "button", className: "primary", textContent: "Use it" });
      use.onclick = () => {
        ollama.use(select.value);
        onOllamaOn(select.value);
        dialog.close();
      };
      nodes.push(el("p", {}, "Ollama is there. Model: ", select), el("div", { className: "model-buttons" }, use));
    } else {
      const connect = el("button", { type: "button", className: "primary", textContent: ollamaState.checking ? "Looking…" : "Connect to Ollama" });
      connect.disabled = ollamaState.checking;
      connect.onclick = async () => {
        ollamaState = { checking: true, models: [], error: "" };
        await render();
        const found = await ollama.probe();
        ollamaState = "reason" in found ? { checking: false, models: [], error: found.reason } : { checking: false, models: found.models, error: "" };
        await render();
      };
      if (ollamaState.error) nodes.push(el("p", { className: "model-error", textContent: ollamaState.error }));
      nodes.push(el("div", { className: "model-buttons" }, connect));
    }
    nodes.push(...fullAppNote(), el("h3", { textContent: "Or in this browser, small and slow" }));
    return nodes;
  }

  /** Whatever model is on, this is a taste: the full app is the point. */
  function fullAppNote() {
    return [el("p", { className: "model-note" }, "This is only a taste. The full app gives her a coding agent with tools, memory and picture packs: ", link("download it", DOWNLOAD), ".")];
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
