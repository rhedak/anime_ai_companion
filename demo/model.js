// The small language model that runs in the visitor's browser (WebLLM, on the graphics card), only when the visitor asks for it
// (demo/model-dialog.js). Nothing here runs, and nothing is fetched, before that: the library comes from the CDN on first use, and the model
// files come from Hugging Face and the compiled GPU code from GitHub, each only when the visitor has said yes in the dialog.

import { MODEL, modelId } from "./model-prompt.js";

/**
 * What the visitor's browser can do: WebGPU at all, and whether it has the `shader-f16` feature (which picks the model build).
 * @returns {Promise<{ ok: boolean, f16?: boolean, reason?: string }>}
 */
export async function webgpuSupport() {
  const gpu = /** @type {any} */ (navigator).gpu;
  if (!gpu) return { ok: false, reason: "This browser has no WebGPU. A recent Chrome or Edge on a computer with a graphics card has it." };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: "WebGPU is there, but the browser found no graphics adapter to use." };
    return { ok: true, f16: adapter.features.has("shader-f16") };
  } catch (err) {
    return { ok: false, reason: `WebGPU could not be started: ${err?.message ?? err}` };
  }
}

/** Has the answer just written, a second time, a stretch it wrote before? */
export function repeatsItself(text) {
  if (text.length < 100) return false;
  return text.slice(0, -40).includes(text.slice(-40));
}

export function createModel() {
  /** @type {any} */
  let webllm = null;
  /** @type {any} */
  let engine = null;
  let id = "";
  let enabled = false;

  function interrupt() {
    try {
      engine?.interruptGenerate();
    } catch {}
  }

  async function library() {
    webllm ??= await import(/* @vite-ignore */ MODEL.library);
    return webllm;
  }

  return {
    /** Is the model on, and answering what the script cannot? */
    ready: () => enabled && engine !== null,
    /** Is the model loaded (it may be switched off)? */
    loaded: () => engine !== null,
    setEnabled(on) {
      enabled = on && engine !== null;
    },

    /** Whether the model files are already in this browser (the browser's Cache Storage, where WebLLM keeps them): loading would not download. */
    async installed() {
      try {
        if (!globalThis.caches || !(await caches.has("webllm/model"))) return false;
        const cache = await caches.open("webllm/model");
        // The weights themselves, not just a small file about them (a removed model can leave those behind).
        return (await cache.keys()).some((request) => request.url.includes("/SmolLM2-360M-Instruct-") && request.url.includes("params_shard_"));
      } catch {
        return false;
      }
    },

    /**
     * Downloads (unless it is cached) and loads the model; resolves when it can answer. `onProgress(fraction, text)` reports it.
     * @param {(fraction: number, text: string) => void} onProgress
     */
    async load(onProgress) {
      const support = await webgpuSupport();
      if (!support.ok) throw new Error(support.reason);
      onProgress(0, "Loading the library…");
      const lib = await library();
      id = modelId(Boolean(support.f16));
      engine = await lib.CreateMLCEngine(id, { initProgressCallback: (report) => onProgress(report.progress ?? 0, report.text ?? "") });
      enabled = true;
    },

    /**
     * One answer, streamed: `onPiece` gets each piece as it is written; resolves with the whole text.
     * @param {{ role: string, content: string }[]} messages
     * @param {(piece: string) => void} onPiece
     */
    async chat(messages, onPiece) {
      if (!engine) throw new Error("the small model is not loaded");
      // A model this small loops (the same line again and again) and rambles past "one to three sentences", so: a short limit, penalties for
      // repeating itself, and an end to the answer as soon as it repeats a stretch it has already written.
      const stream = await engine.chat.completions.create({
        messages,
        stream: true,
        temperature: 0.6,
        top_p: 0.9,
        max_tokens: 120,
        frequency_penalty: 0.6,
        presence_penalty: 0.2,
      });
      let text = "";
      for await (const chunk of stream) {
        const piece = chunk.choices?.[0]?.delta?.content ?? "";
        if (!piece) continue;
        text += piece;
        onPiece(piece);
        if (repeatsItself(text)) {
          interrupt();
          break;
        }
      }
      return text;
    },

    /** Stops an answer that is being written (the page's stop button). */
    stop: interrupt,

    /** Switches it off, frees the graphics memory, and deletes the downloaded files from this browser. */
    async remove() {
      enabled = false;
      try {
        await engine?.unload();
      } catch {}
      engine = null;
      const lib = await library();
      for (const name of [MODEL.idF16, MODEL.idF32]) {
        try {
          await lib.deleteModelAllInfoInCache(name);
        } catch {}
      }
      // The library's own delete leaves small files behind (tensor-cache.json): take out anything of these two models.
      try {
        const cache = await caches.open("webllm/model");
        for (const request of await cache.keys()) {
          if (/\/mlc-ai\/SmolLM2-360M-Instruct-q4f(16|32)_1-MLC\//.test(request.url)) await cache.delete(request);
        }
      } catch {}
    },
  };
}
