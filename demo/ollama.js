// A language model on the visitor's own computer, through Ollama, only when the visitor asks for it (demo/model-dialog.js). The page talks
// straight to Ollama's local address from the browser: nothing goes to any other server, and nothing is fetched or tried before the visitor
// presses the button. It has the interface of demo/model.js (ready, loaded, setEnabled, chat, stop, remove), so the demo's stand-in server
// does not care which one answers. Chat only: no tools, no files.

export const OLLAMA_URL = "http://localhost:11434";

/** What the visitor runs so that Ollama accepts this page (it refuses other websites by default). */
export const allowCommand = (origin) => `OLLAMA_ORIGINS=${origin} ollama serve`;

/**
 * @param {{ fetch?: typeof fetch, url?: string, origin?: string }} [options] `fetch` and `url` are for tests.
 */
export function createOllamaModel({ fetch: fetcher = globalThis.fetch?.bind(globalThis), url = OLLAMA_URL, origin = globalThis.location?.origin ?? "" } = {}) {
  let model = "";
  let enabled = false;
  /** @type {AbortController | null} */
  let running = null;

  return {
    kind: "ollama",
    ready: () => enabled && model !== "",
    loaded: () => model !== "",
    /** The model it is using (empty when off). */
    name: () => (enabled ? model : ""),
    setEnabled(on) {
      enabled = on && model !== "";
    },

    /**
     * Asks Ollama what it has. A browser says the same ("Failed to fetch") when Ollama is not running and when it refuses this page,
     * so the reason says both and the command that fixes the second.
     * @returns {Promise<{ ok: true, models: string[] } | { ok: false, reason: string }>}
     */
    async probe() {
      try {
        const res = await fetcher(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return { ok: false, reason: `Ollama answered ${res.status}.` };
        const body = await res.json();
        const models = (body.models ?? []).map((m) => String(m.name ?? m.model ?? "")).filter(Boolean);
        if (!models.length) return { ok: false, reason: "Ollama is running but has no model yet. Install one, for example: ollama pull llama3.2" };
        return { ok: true, models };
      } catch {
        return {
          ok: false,
          reason:
            "This page could not reach Ollama. Either it is not running, or it does not accept this site yet. " +
            `Allow it and restart Ollama (in a terminal: ${allowCommand(origin || "https://rhedak.github.io")}; the Ollama app needs OLLAMA_ORIGINS set in its environment). ` +
            "(your browser may also ask whether this page may connect to devices on your network: say yes).",
        };
      }
    },

    /** Uses this model from now on. */
    use(name) {
      model = name;
      enabled = true;
    },

    /**
     * One answer, streamed: `onPiece` gets each piece as it is written; resolves with the whole text.
     * @param {{ role: string, content: string }[]} messages
     * @param {(piece: string) => void} onPiece
     */
    async chat(messages, onPiece) {
      if (!model) throw new Error("no Ollama model is chosen");
      running = new AbortController();
      let text = "";
      try {
        const res = await fetcher(`${url}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, messages, stream: true, options: { temperature: 0.7, num_predict: 200 } }),
          signal: running.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        const take = (line) => {
          if (!line.trim()) return;
          const piece = JSON.parse(line).message?.content ?? "";
          if (!piece) return;
          text += piece;
          onPiece(piece);
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          lines.forEach(take);
        }
        take(pending);
      } catch (err) {
        if (err?.name !== "AbortError") throw err;
      } finally {
        running = null;
      }
      return text;
    },

    /** Stops an answer that is being written (the page's stop button). */
    stop() {
      running?.abort();
    },

    /** Nothing was downloaded, so this only forgets the choice. */
    async remove() {
      enabled = false;
      model = "";
    },
  };
}
