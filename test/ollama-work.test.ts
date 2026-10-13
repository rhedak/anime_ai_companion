import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_TOOL_ROUNDS, OllamaProvider, ollamaSupportsTools } from "../src/providers/ollama.ts";
import type { PermissionMode, ProviderEvent } from "../src/providers/types.ts";

type Reply = { text?: string; calls?: { name: string; arguments: unknown }[]; error?: string; status?: number };

/** A fake Ollama: /api/show reports `capabilities`, and /api/chat answers from `script(requestNumber, body)`. */
async function fakeOllama(script: (n: number, body: any) => Reply, capabilities: string[] | null = ["completion", "tools"]) {
  const chats: any[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/api/show") return void res.end(JSON.stringify(capabilities ? { capabilities } : {}));
    chats.push(body);
    const reply = script(chats.length, body);
    if (reply.status) return void res.writeHead(reply.status).end(JSON.stringify({ error: reply.error }));
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    if (reply.text) res.write(JSON.stringify({ message: { role: "assistant", content: reply.text }, done: false }) + "\n");
    if (reply.calls) {
      const tool_calls = reply.calls.map((c) => ({ function: { name: c.name, arguments: c.arguments } }));
      res.write(JSON.stringify({ message: { role: "assistant", content: "", tool_calls }, done: false }) + "\n");
    }
    res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }) + "\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { host: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, chats, close: () => server.close() };
}

function setup(mode: "chat" | "work" = "work", permissionMode: PermissionMode = "manual") {
  const dir = mkdtempSync(join(tmpdir(), "anaico-ollama-"));
  writeFileSync(join(dir, "hello.txt"), "hello from the file\n");
  const make = (host: string, forceTools?: string[]) => {
    const p = new OllamaProvider({ host, model: "qwen3-coder", persona: () => "PERSONA", forceTools });
    p.configure({ mode, cwd: dir, model: "qwen3-coder", allowedTools: ["Read", "Grep", "Glob"], permissionMode, claudeSetup: false, claudeSkills: false, effort: null });
    return p;
  };
  return { dir, make, done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Sends a message and answers each approval card with `decide`; resolves with every event. */
const ask = (p: OllamaProvider, text: string, decide: (e: Extract<ProviderEvent, { type: "permission" }>) => "allow" | "allow-session" | "deny" = () => "allow") =>
  new Promise<ProviderEvent[]>((resolve) => {
    const events: ProviderEvent[] = [];
    p.send(text, (e) => {
      events.push(e);
      if (e.type === "permission") setImmediate(() => p.respondPermission(e.request.id, decide(e)));
      if (e.type === "done" || e.type === "error") resolve(events);
    });
  });
const said = (events: ProviderEvent[]) => events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");

test("a model that reports tools can read a file: the call is run, its result goes back, the answer follows", async () => {
  const w = setup();
  const fake = await fakeOllama((n) => (n === 1 ? { text: "[emotion:thinking] Let me look.", calls: [{ name: "read_file", arguments: { path: "hello.txt" } }] } : { text: "It says hello." }));
  try {
    const p = w.make(fake.host);
    assert.equal(p.canUseTools, false, "not known until asked");
    assert.equal(await p.checkTools(), true);
    assert.equal(p.canUseTools, true);
    const events = await ask(p, "what is in hello.txt?");
    assert.deepEqual(events.filter((e) => e.type === "permission"), [], "reading is pre-approved, so no card");
    assert.deepEqual(events.filter((e) => e.type === "tool").map((e: any) => [e.name, e.summary, e.status]), [["Read", "hello.txt", "running"], ["Read", "hello.txt", "done"]]);
    assert.match(said(events), /Let me look\.[^]*It says hello\./);
    assert.equal(events.at(-1)?.type, "done");

    const [first, second] = fake.chats;
    assert.deepEqual(first.tools.map((t: any) => t.function.name), ["read_file", "grep", "bash", "write_file"]);
    assert.equal(first.options.num_ctx, 16384);
    assert.match(first.messages[0].content, /^PERSONA[^]*Tools \(work mode, experimental\)/);
    assert.deepEqual(second.messages.map((m: any) => m.role), ["system", "user", "assistant", "tool"]);
    assert.equal(second.messages[3].tool_name, "read_file");
    assert.match(second.messages[3].content, /hello from the file/);
  } finally {
    fake.close();
    w.done();
  }
});

test("a command waits for the user: allowed once it runs, denied it does not, and the model is told which", async () => {
  const w = setup();
  const marker = join(w.dir, "ran.txt");
  const fake = await fakeOllama((n) => (n % 2 === 1 ? { calls: [{ name: "bash", arguments: { command: "echo done > ran.txt" } }] } : { text: "ok" }));
  try {
    const p = w.make(fake.host);
    await p.checkTools();
    const denied = await ask(p, "run it", (e) => {
      assert.equal(e.request.tool, "Bash");
      assert.deepEqual(e.request.input, { command: "echo done > ran.txt" });
      return "deny";
    });
    assert.equal(existsSync(marker), false, "nothing ran before the user said yes, and not after a no");
    assert.equal(denied.at(-1)?.type, "done");
    assert.match(fake.chats[1].messages.at(-1).content, /declined/);
    assert.equal(denied.filter((e) => e.type === "tool").at(-1)?.status, "error");

    await ask(p, "run it again", () => "allow");
    assert.equal(readFileSync(marker, "utf8").trim(), "done");
  } finally {
    fake.close();
    w.done();
  }
});

test("'allow for this session' covers only that exact call", async () => {
  const w = setup();
  const fake = await fakeOllama((n) => {
    if (n === 1 || n === 3) return { calls: [{ name: "bash", arguments: { command: "echo one" } }] };
    if (n === 5) return { calls: [{ name: "bash", arguments: { command: "echo two" } }] };
    return { text: "ok" };
  });
  try {
    const p = w.make(fake.host);
    await p.checkTools();
    let cards = 0;
    const decide = () => (cards++, "allow-session" as const);
    await ask(p, "a", decide);
    await ask(p, "b", decide); // the same command again
    assert.equal(cards, 1);
    await ask(p, "c", decide); // another command
    assert.equal(cards, 2);
  } finally {
    fake.close();
    w.done();
  }
});

test("plan mode offers only reading and searching, and refuses a write the model tries anyway", async () => {
  const w = setup("work", "plan");
  const fake = await fakeOllama((n) => (n === 1 ? { calls: [{ name: "write_file", arguments: { path: "x.txt", content: "no" } }] } : { text: "here is a plan" }));
  try {
    const p = w.make(fake.host);
    await p.checkTools();
    const events = await ask(p, "make x.txt");
    assert.deepEqual(fake.chats[0].tools.map((t: any) => t.function.name), ["read_file", "grep"]);
    assert.match(fake.chats[0].messages[0].content, /Plan mode/);
    assert.equal(existsSync(join(w.dir, "x.txt")), false);
    assert.deepEqual(events.filter((e) => e.type === "permission"), []);
    assert.match(fake.chats[1].messages.at(-1).content, /Plan mode/);
  } finally {
    fake.close();
    w.done();
  }
});

test("chat mode never offers tools, even for a model that has them", async () => {
  const w = setup("chat");
  const fake = await fakeOllama(() => ({ text: "hi" }));
  try {
    const p = w.make(fake.host);
    await p.checkTools();
    await ask(p, "hello");
    assert.equal(fake.chats[0].tools, undefined);
    assert.equal(fake.chats[0].options, undefined);
    assert.doesNotMatch(fake.chats[0].messages[0].content, /Tools/);
  } finally {
    fake.close();
    w.done();
  }
});

test("a model that keeps calling tools is stopped after the cap, and the history has no call without an answer", async () => {
  const w = setup();
  const fake = await fakeOllama((n) => (n <= MAX_TOOL_ROUNDS ? { calls: [{ name: "read_file", arguments: { path: "hello.txt" } }] } : { text: "fine" }));
  try {
    const p = w.make(fake.host);
    await p.checkTools();
    const events = await ask(p, "loop");
    assert.equal(events.at(-1)?.type, "done");
    assert.ok(events.some((e) => e.type === "notice" && /stopped after 12 steps/.test(e.text)));
    assert.equal(fake.chats.length, MAX_TOOL_ROUNDS);
    await ask(p, "again");
    const next = fake.chats.at(-1).messages;
    const calls = next.filter((m: any) => m.tool_calls?.length).length;
    const results = next.filter((m: any) => m.role === "tool").length;
    assert.equal(calls, results, "every call in the history has its result");
  } finally {
    fake.close();
    w.done();
  }
});

test("stopping while a card waits ends the reply cleanly and leaves a usable conversation", async () => {
  const w = setup();
  const fake = await fakeOllama((n) => (n === 1 ? { text: "Running it.", calls: [{ name: "bash", arguments: { command: "echo never" } }] } : { text: "back" }));
  try {
    const p = w.make(fake.host);
    await p.checkTools();
    const events: ProviderEvent[] = [];
    const finished = new Promise<void>((resolve) =>
      p.send("go", (e) => {
        events.push(e);
        if (e.type === "permission") setImmediate(() => assert.equal(p.interrupt(), true)); // the user pressed stop instead of answering
        if (e.type === "done" || e.type === "error") resolve();
      }),
    );
    await finished;
    assert.equal(events.at(-1)?.type, "done");
    assert.ok(events.some((e) => e.type === "permission-cancelled"));
    assert.equal(p.busy, false);
    await ask(p, "next");
    const roles = fake.chats.at(-1).messages.map((m: any) => m.role);
    assert.ok(!roles.includes("tool"));
    assert.ok(fake.chats.at(-1).messages.every((m: any) => !m.tool_calls));
  } finally {
    fake.close();
    w.done();
  }
});

test("Ollama saying a model has no tools turns work mode off for it, with a clear message", async () => {
  const w = setup();
  const fake = await fakeOllama(() => ({ status: 400, error: "registry.ollama.ai/library/llama2 does not support tools" }));
  try {
    const p = w.make(fake.host, ["qwen3-coder"]);
    await p.checkTools();
    assert.equal(p.canUseTools, true);
    const events = await ask(p, "hi");
    assert.match((events.at(-1) as any).message, /does not support tools after all/);
    assert.equal(p.canUseTools, false);
  } finally {
    fake.close();
    w.done();
  }
});

test("tool support: Ollama's own report wins; without one a known family counts, an unknown model is not assumed, and the user can vouch", async () => {
  const withTools = await fakeOllama(() => ({}), ["completion", "tools"]);
  const without = await fakeOllama(() => ({}), ["completion"]);
  const silent = await fakeOllama(() => ({}), null);
  try {
    assert.equal(await ollamaSupportsTools(withTools.host, "anything"), true);
    assert.equal(await ollamaSupportsTools(without.host, "qwen3-coder"), false, "the report beats the name");
    assert.equal(await ollamaSupportsTools(silent.host, "qwen2.5-coder:7b"), true);
    assert.equal(await ollamaSupportsTools(silent.host, "some-new-model"), null);
    assert.equal(await ollamaSupportsTools(silent.host, "some-new-model", ["some-new-model"]), true);
    assert.equal(await ollamaSupportsTools(silent.host, "x", ["all"]), true);
    assert.equal(await ollamaSupportsTools("http://127.0.0.1:1", "x"), null);
  } finally {
    [withTools, without, silent].forEach((f) => f.close());
  }
});
