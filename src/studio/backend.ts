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
  paid?: { host: string; keyName: string };
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

/** The paid web services there is an adapter for. Each is paid per picture, so each has its own approval text (studio-service.ts) and a spending limit. */
export const XAI = "xai";
export const GEMINI = "gemini";
export const OPENAI = "openai";
export const PAID_SERVICES: readonly string[] = [XAI, GEMINI, OPENAI];
export const XAI_BASE = "https://api.x.ai/v1";
export const XAI_MODEL = "grok-imagine-image-2.0";
export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_MODEL = "gemini-3.1-flash-image";
export const OPENAI_BASE = "https://api.openai.com/v1";
export const OPENAI_MODEL = "gpt-image-2.5-sunburst";
const USD_TICKS = 10_000_000_000; // xAI reports `usage.cost_in_usd_ticks`: 10 000 000 000 ticks are one dollar

/** The address the user may give: plain http on this computer, or the name of a paid web service (`xai`, `gemini`). */
export function checkBackendUrl(value: unknown): string | null {
  if (typeof value === "string" && PAID_SERVICES.includes(value)) return value;
  if (!isLoopbackHttp(value)) return null;
  return String(value).replace(/\/+$/, "");
}

export interface PaidOptions {
  /** Where the key comes from when it is not in the environment: this session only, never written anywhere. */
  key?: string;
  /** What this pack may cost in all, and what it has cost so far (the job's earlier phases and sessions). */
  limitUsd: number;
  spentUsd: number;
  /** Told the new total after every paid call. */
  onSpend?: (totalUsd: number) => void;
  fetch?: typeof fetch;
  /** Tests only: a loopback address in place of the service (the adapter's `baseEnv`). */
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
}
/** Kept for the tests that name the first service. */
export type XaiOptions = PaidOptions;

/** What differs between the paid services: where they are, how a request looks, and how the picture and its cost are read from an answer. */
interface PaidAdapter {
  /** `xai`, `gemini`: the value of the `studioBackend` setting. */
  service: string;
  label: string;
  /** Environment variables the key may be in, first one first (the first is the name shown to the user). */
  keyEnv: string[];
  baseUrl: string;
  baseEnv: string;
  model: string;
  modelEnv: string;
  headers(key: string): Record<string, string>;
  request(kind: "edit" | "generate", req: { prompt: string; image?: Buffer; width: number; height: number }, model: string): { path: string; body?: Record<string, unknown>; form?: FormData };
  /** The picture (base64) and what the call cost in dollars (null: the answer does not say), or why there is no picture. */
  read(json: Record<string, any>, model: string): { image: string | null; costUsd: number | null; why?: string };
  /** The service's own words for an error. */
  detail(json: Record<string, any>): string | null;
}

const dataUri = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;

const xaiAdapter: PaidAdapter = {
  service: XAI,
  label: "xAI Grok Imagine",
  keyEnv: ["XAI_API_KEY"],
  baseUrl: XAI_BASE,
  baseEnv: "COMPANION_XAI_BASE",
  model: XAI_MODEL,
  modelEnv: "COMPANION_XAI_MODEL",
  headers: (key) => ({ authorization: `Bearer ${key}` }),
  // The endpoint and payload follow the `imagine` package's grok client: POST /images/edits, the picture as a data URI, `b64_json` back.
  request: (kind, req) => ({
    path: kind === "edit" ? "/images/edits" : "/images/generations",
    body: { n: 1, response_format: "b64_json", aspect_ratio: "auto", resolution: "1k", prompt: req.prompt, ...(req.image ? { image: { url: dataUri(req.image) } } : {}) },
  }),
  read: (json) => {
    const ticks = json.usage?.cost_in_usd_ticks;
    const item = Array.isArray(json.data) ? json.data[0] : null;
    return { image: text(item?.b64_json, 80_000_000), costUsd: Number.isInteger(ticks) && ticks >= 0 ? ticks / USD_TICKS : null };
  },
  detail: (json) => text(json.error?.message, 300) ?? text(json.error, 300) ?? text(json.message, 300),
};

/**
 * Dollars per million tokens, from the Gemini API's published pricing (ai.google.dev/gemini-api/docs/pricing): what a request costs is not in the
 * answer, only the token counts are, so the cost is worked out here. A model that is not in this table is not metered, and the job stops after
 * its first picture rather than draw blind (COMPANION_GEMINI_MODEL can name another model, with that result).
 */
const GEMINI_PRICES: Record<string, { input: number; text: number; image: number }> = {
  "gemini-3.1-flash-image": { input: 0.5, text: 3, image: 60 },
  "gemini-2.5-flash-image": { input: 0.3, text: 2.5, image: 30 },
  "gemini-3-pro-image": { input: 2, text: 12, image: 120 },
};

const geminiAdapter: PaidAdapter = {
  service: GEMINI,
  label: "Google Gemini",
  keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  baseUrl: GEMINI_BASE,
  baseEnv: "COMPANION_GEMINI_BASE",
  model: GEMINI_MODEL,
  modelEnv: "COMPANION_GEMINI_MODEL",
  headers: (key) => ({ "x-goog-api-key": key }),
  // generateContent: the picture and the words as parts, only a picture asked for back. The size follows the picture sent when no ratio is named.
  request: (_kind, req, model) => ({
    path: `/models/${encodeURIComponent(model)}:generateContent`,
    body: {
      contents: [{ role: "user", parts: [...(req.image ? [{ inline_data: { mime_type: "image/png", data: req.image.toString("base64") } }] : []), { text: req.prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { imageSize: "1K" } },
    },
  }),
  read: (json, model) => {
    const candidate = Array.isArray(json.candidates) ? json.candidates[0] : null;
    const parts: any[] = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const found = parts.map((p) => p?.inlineData ?? p?.inline_data).find((d) => typeof d?.data === "string" && d.data.length > 0);
    const price = GEMINI_PRICES[model];
    const u = json.usageMetadata;
    let costUsd: number | null = null;
    if (price && u && Number.isFinite(u.promptTokenCount)) {
      const details: { modality?: string; tokenCount?: number }[] = Array.isArray(u.candidatesTokensDetails) ? u.candidatesTokensDetails : [];
      const image = details.filter((d) => d.modality === "IMAGE").reduce((n, d) => n + (Number(d.tokenCount) || 0), 0);
      // Without the split, every output token is counted as an image token: the dearer price, so the limit errs on the safe side.
      const other = details.length ? Number(u.candidatesTokenCount ?? 0) - image : 0;
      const imageTokens = details.length ? image : Number(u.candidatesTokenCount ?? 0);
      const thinking = Number(u.thoughtsTokenCount ?? 0);
      costUsd = (u.promptTokenCount * price.input + imageTokens * price.image + (Math.max(0, other) + thinking) * price.text) / 1_000_000;
    }
    const why = [json.promptFeedback?.blockReason, candidate?.finishReason && candidate.finishReason !== "STOP" ? candidate.finishReason : null].filter(Boolean).join(", ");
    return { image: found?.data ?? null, costUsd, why: why || undefined };
  },
  detail: (json) => text(json.error?.message, 300) ?? text(json.message, 300),
};

/**
 * Dollars per million tokens, from OpenAI's published pricing (developers.openai.com/api/docs/pricing). The answer's `usage` has the token counts and
 * no price. A model that is not here is not metered (the job stops after its first picture); `gpt-image-1.5` also bills text output, which an image
 * answer does not have.
 */
const OPENAI_PRICES: Record<string, { text: number; image: number; out: number }> = {
  "gpt-image-2.5-sunburst": { text: 5, image: 8, out: 30 },
  "gpt-image-2.5-flare": { text: 5, image: 8, out: 30 },
  "gpt-image-2": { text: 5, image: 8, out: 30 },
  "gpt-image-1.5": { text: 5, image: 8, out: 32 },
  "gpt-image-1-mini": { text: 2, image: 2.5, out: 8 },
};

const openaiAdapter: PaidAdapter = {
  service: OPENAI,
  label: "OpenAI",
  keyEnv: ["OPENAI_API_KEY"],
  baseUrl: OPENAI_BASE,
  baseEnv: "COMPANION_OPENAI_BASE",
  model: OPENAI_MODEL,
  modelEnv: "COMPANION_OPENAI_MODEL",
  headers: (key) => ({ authorization: `Bearer ${key}` }),
  // The edits endpoint takes a form with the picture as a file; the output is asked for at the size of the picture sent (any size with sides in
  // multiples of 16 is allowed), so nothing has to be stretched afterwards. `quality: high` is what `imagine` uses for reference-guided work,
  // from OpenAI's own guide; `input_fidelity` is left out because the gpt-image-2 models do not take it.
  request: (kind, req, model) => {
    const size = `${req.width}x${req.height}`;
    if (kind === "generate") return { path: "/images/generations", body: { model, prompt: req.prompt, n: 1, size, quality: "high" } };
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", req.prompt);
    form.set("n", "1");
    form.set("size", size);
    form.set("quality", "high");
    form.set("image[]", new Blob([new Uint8Array(req.image ?? Buffer.alloc(0))], { type: "image/png" }), "picture.png");
    return { path: "/images/edits", form };
  },
  read: (json, model) => {
    const item = Array.isArray(json.data) ? json.data[0] : null;
    const price = OPENAI_PRICES[model];
    const u = json.usage;
    let costUsd: number | null = null;
    if (price && u && Number.isFinite(u.output_tokens)) {
      const d = u.input_tokens_details;
      const textIn = Number(d?.text_tokens) || 0;
      // Without the split every input token is counted at the dearer (image) price, so the limit errs on the safe side.
      const imageIn = d ? Number(d.image_tokens) || 0 : Number(u.input_tokens) || 0;
      costUsd = (textIn * price.text + imageIn * price.image + Number(u.output_tokens) * price.out) / 1_000_000;
    }
    return { image: text(item?.b64_json, 80_000_000), costUsd };
  },
  detail: (json) => text(json.error?.message, 300) ?? text(json.message, 300),
};

const ADAPTERS: Record<string, PaidAdapter> = { [XAI]: xaiAdapter, [GEMINI]: geminiAdapter, [OPENAI]: openaiAdapter };

/** The name of the environment variable the key of a paid service is read from, for what the user is told. */
export const keyName = (service: string): string => ADAPTERS[service]?.keyEnv[0] ?? "";

/**
 * A paid image service. It costs money per picture, so every call is counted against a limit and the call that would start past it is refused.
 * The key is read from the environment at the moment of the call, goes in one header, and is taken out of every message that leaves this file.
 */
function paidBackend(adapter: PaidAdapter, options: PaidOptions): ImageBackend {
  const override = process.env[adapter.baseEnv];
  const base = options.baseUrl ?? (override && isLoopbackHttp(override) ? override.replace(/\/+$/, "") : adapter.baseUrl);
  const model = process.env[adapter.modelEnv]?.trim().slice(0, 80) || adapter.model;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let spent = options.spentUsd;
  let unmetered = false;
  const key = () => (options.key ?? adapter.keyEnv.map((n) => process.env[n]?.trim()).find(Boolean) ?? "").trim();
  const missing = () => `${adapter.keyEnv[0]} is not set in this app's environment. Set it where the app is started (for example in ~/.zshrc), then restart the app.`;
  const scrub = (message: string) => {
    const k = key();
    return (k.length >= 8 ? message.split(k).join("…") : message).slice(0, 400);
  };

  async function call(kind: "edit" | "generate", req: { prompt: string; image?: Buffer; width: number; height: number }, signal?: AbortSignal): Promise<Buffer> {
    if (!key()) throw new BackendError(missing());
    if (unmetered) throw new BackendError(`${adapter.label} did not say what the last picture cost, so the spending limit cannot be kept. Nothing more is drawn.`);
    if (spent >= options.limitUsd) throw new BackendError(`The spending limit for this pack ($${options.limitUsd.toFixed(2)}) is reached ($${spent.toFixed(2)} spent). Nothing more is drawn; raise it with /studio budget <dollars> and carry on.`);
    const { path, body, form } = adapter.request(kind, req, model);
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(`${base}${path}`, {
          method: "POST",
          headers: { ...(form ? {} : { "content-type": "application/json" }), "user-agent": "anaico-pack-studio", ...adapter.headers(key()) },
          body: form ?? JSON.stringify(adapter.service === XAI ? { model, ...body } : body),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]) : AbortSignal.timeout(5 * 60_000),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new BackendError(scrub(`${adapter.label} did not answer (${error instanceof Error ? error.message : String(error)}).`));
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
        const detail = adapter.detail(json) ?? "";
        throw new BackendError(scrub(`${adapter.label} answered ${res.status}${detail ? `: ${detail}` : ""}.`));
      }
      const got = adapter.read(json, model);
      if (got.costUsd !== null) {
        spent += got.costUsd;
        options.onSpend?.(spent);
      } else unmetered = true;
      const b64 = got.image ? text(got.image, 80_000_000) : null;
      if (!b64) throw new BackendError(scrub(`${adapter.label} sent no picture (it may have declined the request${got.why ? `: ${got.why}` : ""}).`));
      return Buffer.from(b64, "base64");
    }
  }

  return {
    async info() {
      if (!key()) throw new BackendError(missing());
      return { name: `${adapter.label} (paid web service)`, model, revision: null, licence: null, edit: true, generate: true, paid: { host: new URL(base).host, keyName: adapter.keyEnv[0] } };
    },
    // The services take no seed: a picture drawn again is a new draw all the same.
    edit: (req, signal) => call("edit", { prompt: req.prompt, image: req.image, width: req.width, height: req.height }, signal),
    generate: (req, signal) => call("generate", { prompt: req.prompt, width: req.width, height: req.height }, signal),
  };
}

export const xaiBackend = (options: PaidOptions): ImageBackend => paidBackend(xaiAdapter, options);

/** The client for a backend address: a paid web service by name, or the loopback server. A paid one carries the limit and a counter of what is spent. */
export function makeBackend(url: string, paid?: Omit<PaidOptions, "fetch" | "baseUrl" | "sleep">): ImageBackend {
  const adapter = ADAPTERS[url];
  return adapter ? paidBackend(adapter, paid ?? { limitUsd: 0, spentUsd: 0 }) : httpBackend(url);
}

export function httpBackend(baseUrl: string, options: { timeoutMs?: number; fetch?: typeof fetch } = {}): ImageBackend {
  const url = PAID_SERVICES.includes(baseUrl) ? null : checkBackendUrl(baseUrl);
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
