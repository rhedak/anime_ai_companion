import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * The connection to a terminal Claude Code session ("pro mode"). A small channel
 * shim (src/channel-shim.ts), started by that session, dials in over a local
 * WebSocket with a token from `data/attach-token`. Browser messages go to the
 * terminal session through it, and her `reply` tool calls come back.
 */
export class TerminalLink {
  private ws: WebSocket | null = null;
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly token: string;
  private readonly persona: () => string;
  private readonly onSay: (text: string) => void;
  private readonly onChange: () => void;

  constructor(opts: { token: string; persona: () => string; onSay: (text: string) => void; onChange: () => void }) {
    this.token = opts.token;
    this.persona = opts.persona;
    this.onSay = opts.onSay;
    this.onChange = opts.onChange;
  }

  get connected(): boolean {
    return this.ws !== null;
  }

  /** Handle an upgrade request for /attach. Returns false if it was not ours or not allowed. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const given = Buffer.from(String(req.headers["x-companion-token"] ?? ""));
    const want = Buffer.from(this.token);
    // Browsers always send an Origin; the shim never does. Refuse anything that has one.
    const ok = !req.headers.origin && given.length === want.length && timingSafeEqual(given, want);
    if (!ok) return false;
    this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    return true;
  }

  /** Forward a message the user typed in the browser. */
  send(text: string): void {
    this.ws?.send(JSON.stringify({ type: "user", text }));
  }

  private accept(ws: WebSocket): void {
    if (this.ws) {
      ws.close(1013, "another terminal session is already attached");
      return;
    }
    this.ws = ws;
    ws.send(JSON.stringify({ type: "persona", text: this.persona() }));
    this.onChange();
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "say" && typeof msg.text === "string" && msg.text.trim()) this.onSay(msg.text);
      } catch {
        // ignore malformed messages
      }
    });
    ws.on("close", () => {
      if (this.ws === ws) this.ws = null;
      this.onChange();
    });
  }
}
