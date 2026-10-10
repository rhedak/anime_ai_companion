import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import WebSocket from "ws";
import { TerminalLink } from "../src/terminal-link.ts";

async function setup() {
  const said: string[] = [];
  let changes = 0;
  const link = new TerminalLink({
    token: "secret-token",
    persona: () => "PERSONA",
    onSay: (t) => said.push(t),
    onChange: () => changes++,
  });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => {
    if (!link.handleUpgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/attach`;
  return { link, said, changes: () => changes, url, close: () => server.close() };
}

const connect = (url: string, headers: Record<string, string>) =>
  new Promise<{ ws: WebSocket; first: string | null }>((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on("message", (raw) => resolve({ ws, first: String(raw) }));
    ws.on("unexpected-response", () => resolve({ ws, first: null }));
    ws.on("error", () => resolve({ ws, first: null }));
    ws.on("close", () => resolve({ ws, first: null }));
  });

test("accepts the right token, sends the persona, relays both ways", async () => {
  const t = await setup();
  const { ws, first } = await connect(t.url, { "x-companion-token": "secret-token" });
  assert.deepEqual(JSON.parse(first!), { type: "persona", text: "PERSONA" });
  assert.equal(t.link.connected, true);

  const incoming = new Promise<string>((r) => ws.once("message", (m) => r(String(m))));
  t.link.send("hello there");
  assert.deepEqual(JSON.parse(await incoming), { type: "user", text: "hello there" });

  ws.send(JSON.stringify({ type: "say", text: "[emotion:happy] hi" }));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(t.said, ["[emotion:happy] hi"]);

  ws.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(t.link.connected, false);
  assert.ok(t.changes() >= 2); // connected, then disconnected
  t.close();
});

test("rejects a wrong or missing token, and anything that looks like a browser", async () => {
  const t = await setup();
  assert.equal((await connect(t.url, { "x-companion-token": "nope" })).first, null);
  assert.equal((await connect(t.url, {})).first, null);
  assert.equal((await connect(t.url, { "x-companion-token": "secret-token", origin: "http://evil.example" })).first, null);
  assert.equal(t.link.connected, false);
  t.close();
});

test("only one terminal session at a time", async () => {
  const t = await setup();
  const a = await connect(t.url, { "x-companion-token": "secret-token" });
  const closed = new Promise<number>((r) => {
    const second = new WebSocket(t.url, { headers: { "x-companion-token": "secret-token" } });
    second.on("message", () => {});
    second.on("close", (code) => r(code));
  });
  assert.equal(await closed, 1013);
  assert.equal(t.link.connected, true);
  a.ws.close();
  t.close();
});
