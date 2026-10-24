import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";

/** A stand-in for an image model: answers the studio's protocol with a deterministic picture made from the request. No GPU, no weights. */
export interface FakeBackend {
  url: string;
  requests: { path: string; body: Record<string, unknown> }[];
  stop(): Promise<void>;
}

export async function startFakeBackend(options: { failEdit?: string } = {}): Promise<FakeBackend> {
  const requests: FakeBackend["requests"] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, name: "fake backend", model: "fake-1", revision: "abc", licence: "MIT", edit: true, generate: true });
      const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
      requests.push({ path: req.url ?? "", body: { ...body, image: body.image ? "<png>" : undefined } });
      if (req.url === "/edit" && options.failEdit) return send(500, { message: options.failEdit });
      if (req.url === "/edit" || req.url === "/generate") {
        const w = Number(body.width), h = Number(body.height), seed = Number(body.seed);
        // The input picture with a band of a colour that depends on the seed, so every candidate differs.
        const base = body.image
          ? sharp(Buffer.from(String(body.image), "base64")).resize(w, h)
          : sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 255 } } });
        const band = await sharp({ create: { width: w, height: Math.max(8, Math.floor(h / 16)), channels: 3, background: { r: (seed * 53) % 256, g: (seed * 97) % 256, b: 120 } } }).png().toBuffer();
        const png = await base.composite([{ input: band, top: Math.floor(h / 2), left: 0 }]).png().toBuffer();
        return send(200, { image: png.toString("base64") });
      }
      send(404, { message: "no such route" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, requests, stop: () => new Promise((resolve) => server.close(() => resolve())) };
}
