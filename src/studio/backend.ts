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
  /** Set for a service that bills per picture and is reached over the internet: the host that receives the pictures. */
  paid?: { host: string };
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

/** The one web service there is an adapter for. It is paid, so it has its own approval text (studio-service.ts) and a spending limit. */
export const XAI = "xai";
export const XAI_BASE = "https://api.x.ai/v1";
export const XAI_MODEL = "grok-imagine-image-2.0";
const USD_TICKS = 10_000_000_000; // xAI reports `usage.cost_in_usd_ticks`: 10 000 000 000 ticks are one dollar

/** The address the user may give: plain http on this computer, or the name of the one web service (`xai`). */
export function checkBackendUrl(value: unknown): string | null {
  if (value === XAI) return XAI;
  if (!isLoopbackHttp(value)) return null;
  return String(value).replace(/\/+$/, "");
}

export interface XaiOptions {
  /** Where the key comes from when it is not in the environment: this session only, never written anywhere. */
  key?: string;
  /** What this pack may cost in all, and what it has cost so far (the job's earlier phases and sessions). */
  limitUsd: number;
  spentUsd: number;
  /** Told the new total after every paid call. */
  onSpend?: (totalUsd: number) => void;
  fetch?: typeof fetch;
  /** Tests only (COMPANION_XAI_BASE): a loopback address in place of api.x.ai. */
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
}

export const xaiKeyPresent = (): boolean => Boolean(process.env.XAI_API_KEY?.trim());

/**
 * xAI's Grok Imagine (the endpoint and payload follow the `imagine` package's grok client: POST /images/edits with the picture as a data URI,
 * `b64_json` back, the cost in `usage.cost_in_usd_ticks`). It costs money per picture, so every call is counted against a limit and the call
 * that would start past it is refused. The key is read from `XAI_API_KEY` at the moment of the call, goes in one header, and is taken out of
 * every message that leaves this file.
 */
export function xaiBackend(options: XaiOptions): ImageBackend {
  const override = process.env.COMPANION_XAI_BASE;
  const base = options.baseUrl ?? (override && isLoopbackHttp(override) ? override.replace(/\/+$/, "") : XAI_BASE);
  const model = process.env.COMPANION_XAI_MODEL?.trim().slice(0, 80) || XAI_MODEL;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let spent = options.spentUsd;
  let unmetered = false;
  const key = () => (options.key ?? process.env.XAI_API_KEY ?? "").trim();
  const scrub = (message: string) => {
    const k = key();
    return (k.length >= 8 ? message.split(k).join("…") : message).slice(0, 400);
  };

  async function call(path: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<Buffer> {
    if (!key()) throw new BackendError("XAI_API_KEY is not set in this app's environment. Set it where the app is started (for example in ~/.zshrc), then restart the app.");
    if (unmetered) throw new BackendError("xAI did not say what the last picture cost, so the spending limit cannot be kept. Nothing more is drawn.");
    if (spent >= options.limitUsd) throw new BackendError(`The spending limit for this pack ($${options.limitUsd.toFixed(2)}) is reached ($${spent.toFixed(2)} spent). Nothing more is drawn; raise it with /studio budget <dollars> and carry on.`);
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(`${base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key()}`, "user-agent": "anaico-pack-studio" },
          body: JSON.stringify({ model, n: 1, response_format: "b64_json", aspect_ratio: "auto", resolution: "1k", ...payload }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]) : AbortSignal.timeout(5 * 60_000),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new BackendError(scrub(`xAI did not answer (${error instanceof Error ? error.message : String(error)}).`));
      }
      let json: Record<string, any> = {};
      try {
        json = (await res.json()) as Record<string, any>;
      } catch {
        /* not JSON */
      }
      if (!res.ok) {
        // Too many requests, or the service busy: a failed call is not billed, so wait a little and ask again (twice at most).
        if ((res.status === 429 || res.status === 503) && attempt < 2) {
          await sleep(Math.min(30_000, Number(res.headers.get("retry-after")) * 1000 || 2000 * (attempt + 1)));
          continue;
        }
        const detail = text(json.error?.message, 300) ?? text(json.error, 300) ?? text(json.message, 300) ?? "";
        throw new BackendError(scrub(`xAI answered ${res.status}${detail ? `: ${detail}` : ""}.`));
      }
      const ticks = json.usage?.cost_in_usd_ticks;
      if (Number.isInteger(ticks) && ticks >= 0) {
        spent += ticks / USD_TICKS;
        options.onSpend?.(spent);
      } else unmetered = true;
      const item = Array.isArray(json.data) ? json.data[0] : null;
      const b64 = text(item?.b64_json, 80_000_000);
      if (!b64) throw new BackendError("xAI sent no picture (it may have declined the request).");
      return Buffer.from(b64, "base64");
    }
  }

  return {
    async info() {
      if (!key()) throw new BackendError("XAI_API_KEY is not set in this app's environment. Set it where the app is started (for example in ~/.zshrc), then restart the app.");
      return { name: "xAI Grok Imagine (paid web service)", model, revision: null, licence: null, edit: true, generate: true, paid: { host: new URL(base).host } };
    },
    // The service takes no seed: a picture drawn again is a new draw all the same.
    edit: (req, signal) => call("/images/edits", { prompt: req.prompt, image: { url: `data:image/png;base64,${req.image.toString("base64")}` } }, signal),
    generate: (req, signal) => call("/images/generations", { prompt: req.prompt }, signal),
  };
}

/** The client for a backend address: the web service by name, or the loopback server. `xai` carries the limit and a counter of what is spent. */
export function makeBackend(url: string, xai?: Omit<XaiOptions, "fetch" | "baseUrl" | "sleep">): ImageBackend {
  return url === XAI ? xaiBackend(xai ?? { limitUsd: 0, spentUsd: 0 }) : httpBackend(url);
}

export function httpBackend(baseUrl: string, options: { timeoutMs?: number; fetch?: typeof fetch } = {}): ImageBackend {
  const url = baseUrl === XAI ? null : checkBackendUrl(baseUrl);
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
