import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { frameMime, isPackName, readPack, type FramePack } from "./frame-pack.ts";
import { cookieName, cookieValue, gateRequest, hostHeaderAllowed, isLoopbackAddress, sessionCookie } from "./lan.ts";
import { DEVICE_DAYS } from "./phone-devices.ts";
import type { PhoneHttp } from "./phone-service.ts";
import { checkShownImage } from "./shown-images.ts";
import type { Transcript } from "./transcript.ts";

/** What the web side needs from the server around it. */
export interface HttpDeps {
  host: string;
  port: number;
  /** The page's own files: index.html, app.js, … */
  publicDir: string;
  /** The user's own styling (data/custom.css). */
  customCssPath: string;
  /** Whether phone access is on (`--lan`, or turned on from /phone): devices on the network may come in, with the token. Asked per request: it can change while the server runs. */
  lan(): boolean;
  /** The old shared token (`--lan` only, for one more release); empty when it is off. */
  lanToken(): string;
  /** Pairing and the cookies of phones that were allowed on the computer. */
  phone?: PhoneHttp;
  transcript: Pick<Transcript, "findShown">;
  /** Where picture packs live. */
  packDirs: string[];
  emotionNames(): string[];
  /** The picture pack in use, if any. */
  activePack(): FramePack | null;
  /**
   * A small preview of a pack (`packs/thumbs/<id>.webp`, or the index thumbnail when the pack is not installed).
   * Null falls through to the pack's own neutral picture, which is what a folder without a preview uses.
   */
  packThumb?(name: string): Promise<{ body: Buffer; mime: string } | null>;
}

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/**
 * Defence in depth for a page that talks to a server able to run commands: no inline or foreign scripts at all, no framing
 * (clickjacking the approval buttons), nothing leaves the origin.
 */
export function securityHeaders(host: string, port: number) {
  return {
    "content-security-policy": [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      `connect-src 'self' ws://${host}:${port} ws://localhost:${port}`, // 'self' covers the phone's own address
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  };
}

/** The request handler for the HTTP server: the gate for other devices, then the page, her pictures and the user's stylesheet. */
export function createRequestHandler(deps: HttpDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const headers = securityHeaders(deps.host, deps.port);

  /** Whether this request may go on. Another device (--lan) needs the token; everything else is refused. */
  function letThrough(req: IncomingMessage, res: ServerResponse): boolean {
    if (isLoopbackAddress(req.socket.remoteAddress)) return true;
    const gate = deps.lan() ? gateRequest(req, deps.lanToken(), undefined, deps.phone?.isDevice) : { action: "refuse" as const, status: 401 as const, text: "Not available." };
    if (gate.action === "allow") {
      // A phone that is let in again and again stays let in: the page load renews its cookie (the 90 days start over).
      const path = (req.url ?? "/").split("?")[0];
      const cookie = cookieValue(req.headers.cookie, cookieName);
      if ((path === "/" || path === "/index.html") && cookie && deps.phone?.isDevice(cookie)) res.setHeader("set-cookie", sessionCookie(cookie, DEVICE_DAYS));
      return true;
    }
    if (gate.action === "sign-in") {
      res.writeHead(302, { "set-cookie": sessionCookie(deps.lanToken()), location: gate.location, "cache-control": "no-store", ...headers }).end();
    } else {
      res.writeHead(gate.status, { "content-type": "text/plain; charset=utf-8", ...headers }).end(gate.text);
    }
    return false;
  }

  /**
   * The pairing routes, open to the network while phone access is on, because the phone has no credential yet: the page, and the two calls it makes. Everything they hand out
   * is useless without the code from a fresh link and a yes on the computer.
   */
  async function pairing(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (isLoopbackAddress(req.socket.remoteAddress) || !deps.lan() || !deps.phone) return false;
    if (path !== "/pair" && path !== "/pair.js" && path !== "/pair/start" && path !== "/pair/status") return false;
    const plain = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers };
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) => res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers, ...extra }).end(JSON.stringify(body));
    if (!hostHeaderAllowed(req.headers.host)) return void res.writeHead(421, plain).end("Unknown host."), true;
    if (path === "/pair" || path === "/pair.js") {
      const body = await readFile(join(deps.publicDir, path === "/pair" ? "pair.html" : "pair.js")).catch(() => null);
      if (!body) return void res.writeHead(404).end("Not found"), true;
      res.writeHead(200, { "content-type": path === "/pair" ? mime[".html"] : mime[".js"], "cache-control": "no-store", ...headers }).end(body);
      return true;
    }
    if (path === "/pair/start" && req.method === "POST") {
      if (req.headers.origin !== `http://${req.headers.host}`) return void res.writeHead(403, plain).end("Wrong origin."), true;
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 2000) return void res.writeHead(413, plain).end("Too large."), true;
      }
      let code: unknown;
      try {
        code = (JSON.parse(raw) as { code?: unknown }).code;
      } catch {}
      const result = deps.phone.start(code, req.socket.remoteAddress ?? "", req.headers["user-agent"]);
      if (!result.ok) return json(result.status, { error: result.reason }), true;
      json(200, { id: result.request.id, code: result.request.code, seconds: Math.max(0, Math.round((result.request.expiresAt - Date.now()) / 1000)) });
      return true;
    }
    if (path === "/pair/status" && req.method === "GET") {
      const answer = await deps.phone.status(new URL(req.url ?? "/", "http://localhost").searchParams.get("id"));
      json(200, { state: answer.state }, answer.setCookie ? { "set-cookie": answer.setCookie } : {});
      return true;
    }
    res.writeHead(405, plain).end("Not allowed.");
    return true;
  }

  return async (req, res) => {
    if (await pairing(req, res, new URL(req.url ?? "/", "http://localhost").pathname)) return;
    if (!letThrough(req, res)) return;
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const shown = /^\/shown\/([0-9a-f-]{36})$/.exec(path);
    if (shown) {
      // A picture she showed in the chat. The id is unguessable and the file is re-checked on every request.
      const record = deps.transcript.findShown(shown[1]);
      const ok = record && !("error" in (await checkShownImage(record.path, record.root)));
      if (!record || !ok) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": record.mime, "cache-control": "private, max-age=3600", ...headers });
      res.end(await readFile(record.path));
      return;
    }
    const thumb = /^\/pack-thumb\/([^/]+)$/.exec(path);
    if (thumb) {
      // The gallery's picture of a pack: its neutral picture, for any pack in the folders, not only the one in use.
      let name = "";
      try {
        name = decodeURIComponent(thumb[1]);
      } catch {}
      const preview = isPackName(name) ? await deps.packThumb?.(name) : null;
      if (preview) {
        res.writeHead(200, { "content-type": preview.mime, "cache-control": "no-cache", ...headers });
        res.end(preview.body);
        return;
      }
      const found = isPackName(name) ? await readPack(deps.packDirs, name, deps.emotionNames()) : null;
      const file = found?.ok ? found.pack.emotions.neutral.idle : "";
      const body = found?.ok && (await readFile(found.pack.files.get(file)!.path).catch(() => null));
      if (!body) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": frameMime(file), "cache-control": "no-cache", ...headers });
      res.end(body);
      return;
    }
    const frame = /^\/frames\/([^/]+)\/([^/]+)$/.exec(path);
    if (frame) {
      // Only files the scan of the chosen pack found are sent, never a path taken from the url.
      let name = "", file = "";
      try {
        [name, file] = [decodeURIComponent(frame[1]), decodeURIComponent(frame[2])];
      } catch {}
      const pack = deps.activePack();
      const known = pack?.name === name ? pack.files.get(file) : undefined;
      const body = known && (await readFile(known.path).catch(() => null));
      if (!known || !body) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": frameMime(file), "cache-control": "no-cache", ...headers });
      res.end(body);
      return;
    }
    if (path === "/custom.css") {
      // The user's own styling (see public/theme.css). Missing file: an empty sheet, not a 404.
      const css = await readFile(deps.customCssPath).catch(() => "");
      res.writeHead(200, { "content-type": mime[".css"], "cache-control": "no-cache", ...headers });
      res.end(css);
      return;
    }
    // Browsers ask for /favicon.ico whatever the page says: the same picture, as PNG (they take either), instead of a 404.
    const file = normalize(join(deps.publicDir, path === "/" ? "index.html" : path === "/favicon.ico" ? "favicon.png" : path));
    if (file !== deps.publicDir && !file.startsWith(deps.publicDir + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream", ...headers });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  };
}
