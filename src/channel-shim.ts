/**
 * A Claude Code "channel" for the companion (pro mode). Claude Code starts this
 * as a stdio MCP server inside the user's terminal session; it dials the
 * companion server and relays both ways:
 *   browser message -> <channel> event in the session
 *   her `reply` tool call -> speech in the browser
 *
 * stdout belongs to the MCP protocol, so everything we say goes to stderr.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.COMPANION_PORT ?? 3737);
const log = (text: string) => process.stderr.write(`[companion-channel] ${text}\n`);

const token = (await readFile(join(root, "data/attach-token"), "utf8")).trim();
let ws: WebSocket | null = null;
let onUser: (text: string) => void = () => {};

/** Connect (and reconnect). Resolves with the persona text from the first handshake. */
function connect(): Promise<string> {
  return new Promise((resolveFirst, rejectFirst) => {
    let first = true;
    let attempts = 0;
    const dial = () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/attach`, { headers: { "x-companion-token": token } });
      socket.on("message", (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === "persona" && first) {
          first = false;
          ws = socket;
          resolveFirst(msg.text);
        } else if (msg.type === "persona") {
          ws = socket;
          log("reconnected");
        } else if (msg.type === "user") {
          onUser(msg.text);
        }
      });
      socket.on("close", () => {
        if (ws === socket) ws = null;
        if (first && ++attempts > 10) return rejectFirst(new Error("companion server not reachable"));
        setTimeout(dial, 1500);
      });
      socket.on("error", () => {}); // "close" follows and handles the retry
    };
    dial();
  });
}

const persona = await connect().catch((err) => {
  log(`${err.message}. Start it with: npm start`);
  process.exit(1);
});

const mcp = new Server(
  { name: "companion", version: "0.1.0" },
  {
    capabilities: { experimental: { "claude/channel": {} }, tools: {} },
    instructions: persona,
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Speak through the animated companion in the user's browser. Use it to answer messages that arrive from the companion channel.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "What the companion says, with optional [emotion:...] and [avatar ...] tags" } },
        required: ["text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "reply") throw new Error(`unknown tool: ${req.params.name}`);
  const text = String((req.params.arguments as { text?: string } | undefined)?.text ?? "");
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { isError: true, content: [{ type: "text", text: "The companion window is not connected right now." }] };
  }
  ws.send(JSON.stringify({ type: "say", text }));
  return { content: [{ type: "text", text: "sent" }] };
});

onUser = (text) => {
  void mcp.notification({
    method: "notifications/claude/channel",
    params: { content: text, meta: { chat_id: "browser" } },
  });
};

await mcp.connect(new StdioServerTransport());
log("connected to the companion");
