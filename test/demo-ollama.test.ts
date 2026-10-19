import assert from "node:assert/strict";
import { test } from "node:test";
import { createModelSwitch } from "../demo/model-switch.js";
import { buildMessages, systemPrompt } from "../demo/model-prompt.js";
import { OLLAMA_URL, allowCommand, createOllamaModel } from "../demo/ollama.js";

const emotions = ["neutral", "happy", "sad", "thinking"];

/** A fake Ollama: what the page's fetch would reach. Remembers the requests. */
function fakeOllama(options: { models?: string[]; status?: number; down?: boolean; chunks?: string[] } = {}) {
  const requests: { url: string; body?: any }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (options.down) throw new TypeError("Failed to fetch");
    if (options.status) return new Response("nope", { status: options.status });
    if (url.endsWith("/api/tags")) return Response.json({ models: (options.models ?? ["llama3.2:3b"]).map((name) => ({ name })) });
    const chunks = options.chunks ?? [JSON.stringify({ message: { content: "[emotion:happy] Hi " } }) + "\n", JSON.stringify({ message: { content: "there!" } }) + "\n", JSON.stringify({ done: true }) + "\n"];
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
    );
  }) as typeof fetch;
  return { fetcher, requests };
}

test("probe lists Ollama's models, and says what to do when it is not running, refuses this site, or has no model", async () => {
  const ok = fakeOllama({ models: ["llama3.2:3b", "qwen2.5:7b"] });
  const a = await createOllamaModel({ fetch: ok.fetcher }).probe();
  assert.deepEqual(a, { ok: true, models: ["llama3.2:3b", "qwen2.5:7b"] });
  assert.equal(ok.requests[0].url, `${OLLAMA_URL}/api/tags`, "it asks only the local address");

  const down = await createOllamaModel({ fetch: fakeOllama({ down: true }).fetcher, origin: "https://example.test" }).probe();
  assert.equal(down.ok, false);
  assert.ok(!down.ok && down.reason.includes(allowCommand("https://example.test")), "the reason names the command that lets this site in");

  const none = await createOllamaModel({ fetch: fakeOllama({ models: [] }).fetcher }).probe();
  assert.ok(!none.ok && /ollama pull/.test(none.reason));
  const bad = await createOllamaModel({ fetch: fakeOllama({ status: 500 }).fetcher }).probe();
  assert.ok(!bad.ok && /500/.test(bad.reason));
});

test("nothing is asked of Ollama until it is probed or used, and a chat streams the pieces and sends the model and the messages", async () => {
  const fake = fakeOllama();
  const model = createOllamaModel({ fetch: fake.fetcher });
  assert.equal(fake.requests.length, 0, "creating it touches nothing");
  assert.equal(model.ready(), false);
  await assert.rejects(model.chat([], () => {}), /no Ollama model/);

  model.use("llama3.2:3b");
  assert.equal(model.ready(), true);
  const pieces: string[] = [];
  const messages = [{ role: "user", content: "hello" }];
  const text = await model.chat(messages, (p) => pieces.push(p));
  assert.equal(text, "[emotion:happy] Hi there!");
  assert.deepEqual(pieces, ["[emotion:happy] Hi ", "there!"]);
  const sent = fake.requests[0];
  assert.equal(sent.url, `${OLLAMA_URL}/api/chat`);
  assert.equal(sent.body.model, "llama3.2:3b");
  assert.equal(sent.body.stream, true);
  assert.deepEqual(sent.body.messages, messages);
  assert.equal(sent.body.tools, undefined, "chat only: no tools");
});

test("a line split across two network chunks is still read, and a failing Ollama throws so the demo can say so", async () => {
  const line = JSON.stringify({ message: { content: "whole" } }) + "\n";
  const model = createOllamaModel({ fetch: fakeOllama({ chunks: [line.slice(0, 10), line.slice(10)] }).fetcher });
  model.use("m");
  assert.equal(await model.chat([], () => {}), "whole");
  const broken = createOllamaModel({ fetch: fakeOllama({ status: 404 }).fetcher });
  broken.use("gone");
  await assert.rejects(broken.chat([], () => {}), /404/);
});

test("stop ends a running answer quietly, and turning it off or removing it makes it not ready", async () => {
  const fetcher = (async (_url: string, init?: RequestInit) =>
    new Response(
      new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
        },
      }),
    )) as typeof fetch;
  const model = createOllamaModel({ fetch: fetcher });
  model.use("m");
  const running = model.chat([], () => {});
  setTimeout(() => model.stop(), 10);
  assert.equal(await running, "");
  model.setEnabled(false);
  assert.equal(model.ready(), false);
  assert.equal(model.loaded(), true, "it still knows the model it was given");
  model.setEnabled(true);
  assert.equal(model.ready(), true);
  await model.remove();
  assert.equal(model.ready(), false);
  assert.equal(model.loaded(), false);
});

test("the switch answers with whichever backend is on, tells the prompt which, and stops both", async () => {
  const log: string[] = [];
  const backend = (kind: string, on: boolean) => ({ kind, ready: () => on, loaded: () => on, chat: async () => (log.push(`${kind} chat`), kind), stop: () => void log.push(`${kind} stop`) });
  const none = createModelSwitch(backend("browser", false), backend("ollama", false));
  assert.equal(none.ready(), false);
  await assert.rejects(none.chat([], () => {}), /no model is on/);
  const ollamaOn = createModelSwitch(backend("browser", false), backend("ollama", true));
  assert.equal(ollamaOn.ready(), true);
  assert.equal(ollamaOn.kind(), "ollama");
  assert.equal(await ollamaOn.chat([], () => {}), "ollama");
  ollamaOn.stop();
  assert.deepEqual(log, ["ollama chat", "browser stop", "ollama stop"]);
});

test("the prompt says where the model runs: in the browser by default, on the visitor's computer for Ollama", () => {
  assert.match(systemPrompt(emotions), /very small model running inside the visitor's browser/);
  assert.match(systemPrompt(emotions, "Risa", "ollama"), /visitor's own computer through Ollama/);
  assert.doesNotMatch(systemPrompt(emotions, "Risa", "ollama"), /very small model/);
  assert.match(buildMessages([{ type: "user", text: "hi" }], emotions, "Risa", 8, "ollama")[0].content, /Ollama/);
});
