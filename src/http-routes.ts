import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { frameMime, isPackName, readPack, type FramePack } from "./frame-pack.ts";
import { gateRequest, isLoopbackAddress, sessionCookie } from "./lan.ts";
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
  /** --lan is on: devices on the network may come in, with the token. */
  lan: boolean;
  lanToken(): string;
  transcript: Pick<Transcript, "findShown">;
  /** Where picture packs live. */
  packDirs: string[];
  emotionNames(): string[];
  /** The picture pack in use, if any. */
  activePack(): FramePack | null;
}

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
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
    const gate = deps.lan ? gateRequest(req, deps.lanToken()) : { action: "refuse" as const, status: 401 as const, text: "Not available." };
    if (gate.action === "allow") return true;
    if (gate.action === "sign-in") {
      res.writeHead(302, { "set-cookie": sessionCookie(deps.lanToken()), location: gate.location, "cache-control": "no-store", ...headers }).end();
    } else {
      res.writeHead(gate.status, { "content-type": "text/plain; charset=utf-8", ...headers }).end(gate.text);
    }
    return false;
  }

  return async (req, res) => {
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
    const file = normalize(join(deps.publicDir, path === "/" ? "index.html" : path));
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
