import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";

/** A stand-in for an image model: answers the studio's protocol with a deterministic picture made from the request. No GPU, no weights. */
export interface FakeBackend {
  url: string;
  requests: { path: string; body: Record<string, unknown>; authorization?: string; googKey?: string }[];
  stop(): Promise<void>;
}

export async function startFakeBackend(options: { failEdit?: string; delayMs?: number; xai?: { costTicks?: number | null; failWith?: { status: number; message: string }; busyFirst?: number }; gemini?: { noPicture?: string; noUsage?: boolean }; openai?: { noUsage?: boolean }; noWeights?: boolean } = {}): Promise<FakeBackend> {
  const requests: FakeBackend["requests"] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, name: "fake backend", model: "fake-1", revision: "abc", licence: "MIT", edit: true, generate: true, ...(options.noWeights ? { weights: false } : {}) });
      const raw = Buffer.concat(chunks);
      const isForm = /multipart\/form-data/.test(String(req.headers["content-type"]));
      // A form (OpenAI): its text fields by name, and the first PNG in it as `image`.
      const readForm = (): Record<string, unknown> => {
        const text = raw.toString("latin1");
        const fields: Record<string, unknown> = {};
        for (const m of text.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n--/g)) fields[m[1]] = m[2];
        const start = raw.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const end = raw.indexOf(Buffer.from("IEND"), start) + 8;
        if (start >= 0 && end > start) fields.image = raw.subarray(start, end).toString("base64");
        return fields;
      };
      const body = isForm ? readForm() : raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
      requests.push({ path: req.url ?? "", body: { ...body, image: body.image ? "<png>" : undefined }, authorization: req.headers.authorization, googKey: req.headers["x-goog-api-key"] as string | undefined });
      if (req.url === "/edit" && options.failEdit) return send(500, { message: options.failEdit });
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      // The paid web service's shape (the app's xai backend, pointed here by COMPANION_XAI_BASE): the picture in a data URI, the cost in usage.
      if (options.xai && (req.url === "/images/edits" || req.url === "/images/generations")) {
        const x = options.xai;
        if (x.busyFirst && requests.filter((r) => r.path.startsWith("/images/")).length <= x.busyFirst) return send(429, { error: "slow down" });
        if (x.failWith) return send(x.failWith.status, { error: { message: x.failWith.message } });
        const data = (body.image as { url?: string } | undefined)?.url?.split(",")[1];
        const input = data ? Buffer.from(data, "base64") : null;
        const meta = input ? await sharp(input).metadata() : { width: 896, height: 1024 };
        const w = meta.width ?? 896, h = meta.height ?? 1024, seed = requests.length;
        const base = input ? sharp(input) : sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 255 } } });
        const band = await sharp({ create: { width: w, height: Math.max(8, Math.floor(h / 16)), channels: 3, background: { r: (seed * 53) % 256, g: (seed * 97) % 256, b: 120 } } }).png().toBuffer();
        const patch = await sharp({ create: { width: Math.floor(w * 0.12), height: Math.floor(h * 0.08), channels: 3, background: { r: 30 + ((seed * 71) % 200), g: 60, b: 90 } } }).png().toBuffer();
        const png = await base.composite([{ input: band, top: Math.floor(h / 2), left: 0 }, { input: patch, top: Math.floor(h * 0.2), left: Math.floor(w * 0.44) }]).png().toBuffer();
        const usage = x.costTicks === null ? {} : { usage: { cost_in_usd_ticks: x.costTicks ?? 200_000_000 } };
        return send(200, { data: [{ b64_json: png.toString("base64") }], ...usage });
      }
      // OpenAI's shape (COMPANION_OPENAI_BASE): a form with the picture, the answer's picture in data[].b64_json, token counts in usage.
      if (options.openai && (req.url === "/images/edits" || req.url === "/images/generations")) {
        const input = body.image ? Buffer.from(String(body.image), "base64") : null;
        const [sw, sh] = String(body.size ?? "896x1024").split("x").map(Number);
        const base = input ? sharp(input).resize(sw, sh) : sharp({ create: { width: sw, height: sh, channels: 3, background: { r: 255, g: 0, b: 255 } } });
        const patch = await sharp({ create: { width: Math.floor(sw * 0.12), height: Math.floor(sh * 0.08), channels: 3, background: { r: 30 + ((requests.length * 71) % 200), g: 60, b: 90 } } }).png().toBuffer();
        const png = await base.composite([{ input: patch, top: Math.floor(sh * 0.2), left: Math.floor(sw * 0.44) }]).png().toBuffer();
        const usage = options.openai.noUsage ? undefined : { input_tokens: 400, input_tokens_details: { text_tokens: 100, image_tokens: 300 }, output_tokens: 4000, total_tokens: 4400 };
        return send(200, { data: [{ b64_json: png.toString("base64") }], usage });
      }
      // Google's shape (COMPANION_GEMINI_BASE): the picture in an inline_data part, the answer's picture in inlineData, token counts in usageMetadata.
      if (options.gemini && /^\/models\/[^/]+:generateContent$/.test(req.url ?? "")) {
        const g = options.gemini;
        if (g.noPicture) return send(200, { candidates: [{ finishReason: g.noPicture, content: { parts: [{ text: "no" }] } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 5, candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 5 }] } });
        const parts = ((body.contents as { parts: Record<string, any>[] }[])[0]?.parts ?? []);
        const data = parts.find((p) => p.inline_data)?.inline_data?.data as string | undefined;
        const input = data ? Buffer.from(data, "base64") : null;
        const meta = input ? await sharp(input).metadata() : { width: 896, height: 1024 };
        const w = meta.width ?? 896, h = meta.height ?? 1024, seed = requests.length;
        const base = input ? sharp(input) : sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 255 } } });
        const patch = await sharp({ create: { width: Math.floor(w * 0.12), height: Math.floor(h * 0.08), channels: 3, background: { r: 30 + ((seed * 71) % 200), g: 60, b: 90 } } }).png().toBuffer();
        const png = await base.composite([{ input: patch, top: Math.floor(h * 0.2), left: Math.floor(w * 0.44) }]).png().toBuffer();
        const usageMetadata = g.noUsage ? undefined : { promptTokenCount: 1300, candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1120 }] };
        return send(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }], usageMetadata });
      }
      if (req.url === "/edit" || req.url === "/generate") {
        const w = Number(body.width), h = Number(body.height), seed = Number(body.seed);
        // The input picture with a band of a colour that depends on the seed, so every candidate differs.
        const base = body.image
          ? sharp(Buffer.from(String(body.image), "base64")).resize(w, h)
          : sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 255 } } });
        const band = await sharp({ create: { width: w, height: Math.max(8, Math.floor(h / 16)), channels: 3, background: { r: (seed * 53) % 256, g: (seed * 97) % 256, b: 120 } } }).png().toBuffer();
        // A patch where a face is (so a face edit visibly changes something), and a band across the middle (which a face edit must not keep).
        const patch = await sharp({ create: { width: Math.floor(w * 0.12), height: Math.floor(h * 0.08), channels: 3, background: { r: 30 + ((seed * 71) % 200), g: 60, b: 90 } } }).png().toBuffer();
        const png = await base.composite([{ input: band, top: Math.floor(h / 2), left: 0 }, { input: patch, top: Math.floor(h * 0.2), left: Math.floor(w * 0.44) }]).png().toBuffer();
        return send(200, { image: png.toString("base64") });
      }
      send(404, { message: "no such route" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, requests, stop: () => new Promise((resolve) => server.close(() => resolve())) };
}
