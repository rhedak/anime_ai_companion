import { isLoopbackHttp } from "../pack-index.ts";

/**
 * What the pack studio needs from an image model, and nothing else: draw a picture from words, or change a picture by words.
 * The model runs elsewhere (a server on this computer that the user started, or later a web service); this file is the client.
 *
 * The local protocol is two JSON posts and one get, all on a loopback address:
 *   GET  /health    -> { ok: true, name, model?, revision?, licence?, edit: boolean, generate: boolean }
 *   POST /edit      { image: <base64 PNG>, prompt, seed, width, height, steps? } -> { image: <base64 PNG> }
 *   POST /generate  { prompt, seed, width, height, steps? }                        -> { image: <base64 PNG> }
 * An error is any non-2xx answer; its body, if JSON with a `message`, is shown to the user.
 */
export interface BackendInfo {
  name: string;
  model: string | null;
  revision: string | null;
  licence: string | null;
  edit: boolean;
  generate: boolean;
}

export interface EditRequest {
  image: Buffer;
  prompt: string;
  seed: number;
  width: number;
  height: number;
  steps?: number;
}

export interface ImageBackend {
  info(): Promise<BackendInfo>;
  edit(req: EditRequest, signal?: AbortSignal): Promise<Buffer>;
  generate(req: Omit<EditRequest, "image">, signal?: AbortSignal): Promise<Buffer>;
}

export class BackendError extends Error {}

const text = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);

/** The address the user may give: plain http on this computer. A web service gets its own adapter later (with its own approval text). */
export function checkBackendUrl(value: unknown): string | null {
  if (!isLoopbackHttp(value)) return null;
  return String(value).replace(/\/+$/, "");
}

export function httpBackend(baseUrl: string, options: { timeoutMs?: number; fetch?: typeof fetch } = {}): ImageBackend {
  const url = checkBackendUrl(baseUrl);
  if (!url) throw new BackendError("The image backend address has to be http on this computer (127.0.0.1 or localhost).");
  const doFetch = options.fetch ?? fetch;
  // A picture takes seconds on a fast machine and minutes on a slow one; the first one may also load the model.
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;

  async function call(path: string, body: unknown | null, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const timer = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${url}${path}`, {
        method: body === null ? "GET" : "POST",
        headers: body === null ? undefined : { "content-type": "application/json" },
        body: body === null ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timer]) : timer,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new BackendError(`The image backend at ${url} did not answer (${error instanceof Error ? error.message : String(error)}). Is it running?`);
    }
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw new BackendError(text(json.message, 400) ?? `The image backend answered ${res.status}.`);
    return json;
  }

  const picture = (json: Record<string, unknown>): Buffer => {
    const b64 = text(json.image, 80_000_000);
    if (!b64) throw new BackendError("The image backend sent no picture.");
    return Buffer.from(b64, "base64");
  };

  return {
    async info() {
      const j = await call("/health", null);
      if (j.ok !== true) throw new BackendError("That address is not an image backend (its /health did not say ok).");
      return {
        name: text(j.name, 80) ?? "image backend",
        model: text(j.model, 120),
        revision: text(j.revision, 80),
        licence: text(j.licence, 80),
        edit: j.edit === true,
        generate: j.generate === true,
      };
    },
    async edit(req, signal) {
      const { image, ...rest } = req;
      return picture(await call("/edit", { ...rest, image: image.toString("base64") }, signal));
    },
    async generate(req, signal) {
      return picture(await call("/generate", req, signal));
    },
  };
}
