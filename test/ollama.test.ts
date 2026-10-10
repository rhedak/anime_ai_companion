import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { listOllamaModels, OllamaProvider } from "../src/providers/ollama.ts";
import type { ProviderEvent } from "../src/providers/types.ts";

/** A fake Ollama: streams the words of "echo: <last user message>" as NDJSON. */
async function fakeOllama() {
  const requests: any[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    if (req.url === "/api/tags") {
      res.end(JSON.stringify({ models: [{ name: "llama3.2:latest" }, { name: "qwen2.5:7b" }] }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    requests.push(parsed);
    if (parsed.model === "missing") {
      res.writeHead(404).end(JSON.stringify({ error: "model 'missing' not found" }));
      return;
    }
    const last = parsed.messages.at(-1).content;
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    for (const word of `[emotion:happy] echo: ${last}`.split(" ")) {
      res.write(JSON.stringify({ message: { role: "assistant", content: word + " " }, done: false }) + "\n");
    }
    res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { host: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, close: () => server.close() };
}

const ask = (p: OllamaProvider, text: string) =>
  new Promise<ProviderEvent[]>((resolve) => {
    const events: ProviderEvent[] = [];
    p.send(text, (e) => {
      events.push(e);
      if (e.type === "done" || e.type === "error") resolve(events);
    });
  });

test("streams deltas, ends with done, and sends persona plus history on the next turn", async () => {
  const fake = await fakeOllama();
  const p = new OllamaProvider({ host: fake.host, model: "llama3.2", persona: () => "PERSONA" });
  const first = await ask(p, "hello");
  assert.equal(first.at(-1)?.type, "done");
  assert.equal(first.filter((e) => e.type === "delta").map((e: any) => e.text).join("").trim(), "[emotion:happy] echo: hello");

  await ask(p, "again");
  const second = fake.requests[1].messages;
  assert.deepEqual(second.map((m: any) => m.role), ["system", "user", "assistant", "user"]);
  assert.equal(second[0].content, "PERSONA");
  assert.equal(second[3].content, "again");
  fake.close();
});

test("reports Ollama's own error message", async () => {
  const fake = await fakeOllama();
  const p = new OllamaProvider({ host: fake.host, model: "missing", persona: () => "" });
  const events = await ask(p, "hi");
  assert.deepEqual(events.at(-1), { type: "error", message: "model 'missing' not found" });
  assert.equal(p.busy, false);
  fake.close();
});

test("a friendly error when Ollama is not running", async () => {
  const p = new OllamaProvider({ host: "http://127.0.0.1:1", model: "x", persona: () => "" });
  const events = await ask(p, "hi");
  const last: any = events.at(-1);
  assert.equal(last.type, "error");
  assert.match(last.message, /Could not reach Ollama.*ollama serve/);
});

test("reset forgets the conversation; configure switches the model", async () => {
  const fake = await fakeOllama();
  const p = new OllamaProvider({ host: fake.host, model: "a", persona: () => "P" });
  await ask(p, "one");
  p.reset();
  p.configure({ mode: "chat", cwd: "", model: "b", allowedTools: [] });
  await ask(p, "two");
  assert.deepEqual(fake.requests[1].messages.map((m: any) => m.role), ["system", "user"]);
  assert.equal(fake.requests[1].model, "b");
  fake.close();
});

test("lists installed models, or null when unreachable", async () => {
  const fake = await fakeOllama();
  assert.deepEqual(await listOllamaModels(fake.host), ["llama3.2:latest", "qwen2.5:7b"]);
  assert.equal(await listOllamaModels("http://127.0.0.1:1"), null);
  fake.close();
});
