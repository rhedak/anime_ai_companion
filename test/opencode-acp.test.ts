import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { removeDir } from "./helpers/platform.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  interpretAcp,
  opencodeArgs,
  opencodeConfig,
  opencodeSessionMode,
  parseModels,
  permissionResult,
  pickOpenCodeModel,
  promptBlocks,
} from "../src/providers/opencode-acp.ts";
import { OpenCodeProvider } from "../src/providers/opencode.ts";
import type { ProviderEvent, SessionConfig } from "../src/providers/types.ts";

const models = [
  { id: "opencode/big-pickle", name: "big-pickle" },
  { id: "anthropic/sonnet", name: "sonnet" },
];

test("opencode args: plain ACP without plugins, never a skip-permissions flag", () => {
  assert.deepEqual(opencodeArgs(), ["acp", "--pure"]);
});

test("chat asks about every tool (and is refused each time); work asks with reads pre-approved, or lets everything through", () => {
  // Not "deny": with no tools in the request, opencode's free models answer "free tier can only be used from within OpenCode".
  const chat = JSON.parse(opencodeConfig("chat", "manual", ["Read", "Grep", "Glob"]));
  assert.equal(chat.permission["*"], "ask");
  assert.equal(chat.permission.read, undefined);
  assert.equal(chat.autoupdate, false);
  const work = JSON.parse(opencodeConfig("work", "manual", ["Read", "Grep", "Glob"]));
  assert.equal(work.permission["*"], "ask");
  assert.equal(work.permission.read, "allow");
  assert.equal(work.permission.grep, "allow");
  assert.equal(work.permission.bash, undefined);
  const everything = JSON.parse(opencodeConfig("work", "everything", ["Read", "Grep", "Glob"]));
  assert.equal(everything.permission["*"], "allow");
});

test("session mode: chat is plan, work is build unless planning first", () => {
  assert.equal(opencodeSessionMode("chat", "manual"), "plan");
  assert.equal(opencodeSessionMode("work", "plan"), "plan");
  assert.equal(opencodeSessionMode("work", "manual"), "build");
});

test("model pick: empty keeps the default, an id or bare name matches, a typo is refused", () => {
  assert.equal(pickOpenCodeModel(models, null), null);
  assert.equal(pickOpenCodeModel(models, "anthropic/sonnet"), models[1].id);
  assert.equal(pickOpenCodeModel(models, "sonnet"), models[1].id);
  assert.equal(pickOpenCodeModel(models, "nope"), null);
});

test("prompt carries the persona and pictures, since ACP has no system prompt", () => {
  const blocks = promptBlocks("You are Mio.", "hello", [{ mediaType: "image/png", data: "aaa" }]);
  assert.equal((blocks[0] as { text: string }).text.includes("You are Mio."), true);
  assert.equal((blocks[0] as { text: string }).text.includes("hello"), true);
  assert.deepEqual(blocks[1], { type: "image", data: "aaa", mimeType: "image/png" });
});

test("a shell permission becomes a card, and the answer maps onto the option ids", () => {
  const effect = interpretAcp({
    id: 7,
    method: "session/request_permission",
    params: {
      toolCall: { toolCallId: "call-1", name: "bash", title: "List files", rawInput: { command: "ls" } },
      options: [
        { optionId: "allow-once", kind: "allow_once" },
        { optionId: "allow-always", kind: "allow_always" },
        { optionId: "reject-once", kind: "reject_once" },
      ],
    },
  });
  assert.equal(effect.permission?.request.tool, "bash");
  assert.equal(effect.permission?.request.input.command, "ls");
  assert.equal(effect.replies.length, 0);
  assert.deepEqual(permissionResult("allow", effect.permission!.options).outcome.optionId, "allow-once");
  assert.deepEqual(permissionResult("allow-session", effect.permission!.options).outcome.optionId, "allow-always");
  assert.deepEqual(permissionResult("deny", effect.permission!.options).outcome.optionId, "reject-once");
});

test("streamed text and a finished tool call become companion events", () => {
  const text = interpretAcp({
    method: "session/update",
    params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "[emotion:happy] hi" } } },
  });
  assert.deepEqual(text.events, [{ type: "delta", text: "[emotion:happy] hi" }]);
  const tool = interpretAcp({
    method: "session/update",
    params: { update: { sessionUpdate: "tool_call_update", toolCallId: "call-1", name: "bash", status: "completed", rawInput: { command: "ls" } } },
  });
  assert.equal(tool.events[0].type, "tool");
  if (tool.events[0].type === "tool") assert.equal(tool.events[0].status, "done");
});

test("an unhandled request is answered so opencode does not wait", () => {
  const effect = interpretAcp({ id: 12, method: "fs/read_text_file", params: {} });
  assert.deepEqual(effect.replies, [{ id: 12, error: { code: -32601, message: "Not handled: fs/read_text_file" } }]);
});

test("models parse from the new config-option shape and the older models shape", () => {
  const options = parseModels({
    sessionId: "s1",
    configOptions: [
      { id: "model", category: "model", type: "select", currentValue: "opencode/big-pickle", options: [
        { value: "opencode/big-pickle", name: "big-pickle" },
        { value: "anthropic/sonnet", name: "sonnet" },
      ] },
    ],
  });
  assert.equal(options.currentModelId, "opencode/big-pickle");
  assert.deepEqual(options.models, models);
  const legacy = parseModels({ models: { currentModelId: "opencode/big-pickle", availableModels: [{ modelId: "opencode/big-pickle", name: "big-pickle" }] } });
  assert.equal(legacy.currentModelId, "opencode/big-pickle");
  assert.deepEqual(legacy.models, [{ id: "opencode/big-pickle", name: "big-pickle" }]);
});

const fakeAgent = `
import { createInterface } from "node:readline";
let promptId = null;
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") return reply(msg.id, { protocolVersion: 1 });
  if (msg.method === "session/new" || msg.method === "session/load") {
    return reply(msg.id, {
      sessionId: msg.params.sessionId ?? "sess-oc-1",
      configOptions: [
        { id: "model", category: "model", type: "select", currentValue: "opencode/big-pickle", options: [
          { value: "opencode/big-pickle", name: "big-pickle" },
          { value: "anthropic/sonnet", name: "sonnet" },
        ] },
      ],
    });
  }
  if (msg.method === "session/set_mode" || msg.method === "session/set_config_option") return reply(msg.id, {});
  if (msg.method === "session/prompt") {
    promptId = msg.id;
    const text = (msg.params.prompt ?? []).map((block) => block.text ?? "").join("\\n");
    if (text.includes("PLEASE-ASK")) {
      send({
        jsonrpc: "2.0",
        id: 99,
        method: "session/request_permission",
        params: {
          toolCall: { toolCallId: "t1", name: "bash", rawInput: { command: "echo hi" } },
          options: [
            { optionId: "allow-once", kind: "allow_once" },
            { optionId: "reject-once", kind: "reject_once" },
          ],
        },
      });
      return;
    }
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "[emotion:happy] hello" } } } });
    return reply(msg.id, { stopReason: "end_turn" });
  }
  if (msg.id === 99) {
    send({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answered:" + (msg.result?.outcome?.optionId ?? msg.result?.outcome?.outcome) } } } });
    reply(promptId, { stopReason: "end_turn" });
  }
});
`;

function config(over: Partial<SessionConfig> = {}): SessionConfig {
  return {
    mode: "work",
    cwd: process.cwd(),
    model: "",
    allowedTools: ["Read", "Grep", "Glob"],
    permissionMode: "manual",
    claudeSetup: false,
    claudeSkills: false,
    effort: null,
    ...over,
  };
}

test("the provider streams a reply, starts with plain ACP, and forces Ask in the env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-acp-"));
  const script = join(dir, "fake.mjs");
  await writeFile(script, fakeAgent);
  const seen: string[][] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const provider = new OpenCodeProvider({
    config: config({ cwd: dir }),
    chatCwd: dir,
    persona: () => "You are Mio.",
    spawnAgent: (args, cwd, env) => {
      seen.push(args);
      envs.push(env);
      return spawn(process.execPath, [script], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    },
  });
  try {
    const events: ProviderEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      provider.send("hi", (event) => {
        events.push(event);
        if (event.type === "done") resolve();
        if (event.type === "error") reject(new Error(event.message));
      });
    });
    assert.deepEqual(seen[0], ["acp", "--pure"]);
    assert.equal(events.some((event) => event.type === "delta" && event.text.includes("hello")), true);
    assert.equal(provider.modelLabel, "big-pickle");
    assert.equal(provider.sessionId, "sess-oc-1");
    const env = JSON.parse(String(envs[0].OPENCODE_CONFIG_CONTENT));
    assert.equal(env.permission["*"], "ask");
    assert.equal(env.permission.read, "allow");
    assert.equal(envs[0].OPENCODE_DISABLE_PROJECT_CONFIG, "1");
  } finally {
    provider.close();
    removeDir(dir); // the script may be a moment from gone; Windows will not delete the folder it runs in until it is
  }
});

test("a permission request reaches the card and the allow answer lets the turn finish", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-acp-"));
  const script = join(dir, "fake.mjs");
  await writeFile(script, fakeAgent);
  const provider = new OpenCodeProvider({
    config: config({ cwd: dir }),
    chatCwd: dir,
    persona: () => "You are Mio.",
    spawnAgent: (_args, cwd) => spawn(process.execPath, [script], { cwd, stdio: ["pipe", "pipe", "pipe"] }),
  });
  try {
    const events: ProviderEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      provider.send("PLEASE-ASK", (event) => {
        events.push(event);
        if (event.type === "permission") provider.respondPermission(event.request.id, "allow");
        if (event.type === "done") resolve();
        if (event.type === "error") reject(new Error(event.message));
      });
    });
    const card = events.find((event) => event.type === "permission");
    assert.equal(card?.type === "permission" && card.request.input.command, "echo hi");
  } finally {
    provider.close();
    removeDir(dir); // the script may be a moment from gone; Windows will not delete the folder it runs in until it is
  }
});

test("when opencode dies at start, the page gets what it printed, not just the exit code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-acp-"));
  const script = join(dir, "dies.mjs");
  await writeFile(script, 'process.stderr.write("\\x1b[31mError: Database is locked\\x1b[0m\\n"); setTimeout(() => process.exit(1), 50);');
  const provider = new OpenCodeProvider({
    config: config({ cwd: dir }),
    chatCwd: dir,
    persona: () => "You are Mio.",
    spawnAgent: (_args, cwd) => spawn(process.execPath, [script], { cwd, stdio: ["pipe", "pipe", "pipe"] }),
  });
  try {
    const message = await new Promise<string>((resolve) => {
      provider.send("hello", (event) => {
        if (event.type === "error") resolve(event.message);
      });
    });
    assert.match(message, /^opencode exited \(1\)\./);
    assert.match(message, /Error: Database is locked/);
    assert.doesNotMatch(message, /\x1b/);
  } finally {
    provider.close();
    removeDir(dir);
  }
});

test("in chat mode a tool request is refused without a card, and the turn goes on", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-acp-"));
  const script = join(dir, "fake.mjs");
  await writeFile(script, fakeAgent);
  const envs: NodeJS.ProcessEnv[] = [];
  const provider = new OpenCodeProvider({
    config: config({ cwd: dir, mode: "chat" }),
    chatCwd: dir,
    persona: () => "You are Mio.",
    spawnAgent: (_args, cwd, env) => {
      envs.push(env);
      return spawn(process.execPath, [script], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    },
  });
  try {
    const events: ProviderEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      provider.send("PLEASE-ASK", (event) => {
        events.push(event);
        if (event.type === "done") resolve();
        if (event.type === "error") reject(new Error(event.message));
      });
    });
    assert.equal(events.some((event) => event.type === "permission"), false, "no card in chat mode");
    const said = events.flatMap((event) => (event.type === "delta" ? [event.text] : [])).join("");
    assert.match(said, /answered:reject-once/);
    assert.equal(JSON.parse(String(envs[0].OPENCODE_CONFIG_CONTENT)).permission["*"], "ask");
  } finally {
    provider.close();
    removeDir(dir); // the script may be a moment from gone; Windows will not delete the folder it runs in until it is
  }
});

test("opencode's own refusal of a network is said as that, and any other error is shown as it is", async () => {
  const { opencodeErrorText } = await import("../src/providers/opencode-acp.ts");
  const refused = opencodeErrorText("Internal error: OpenCode's free models aren't available from your current network because we've detected abusive traffic from this IP address.");
  assert.match(refused, /^opencode's service refused this request, so this is not a problem in the app/);
  assert.match(refused, /OpenCode's free models aren't available from your current network/);
  assert.doesNotMatch(refused, /Internal error/);
  assert.match(refused, /another brain in the Brain menu/);
  assert.equal(opencodeErrorText("Something else broke"), "Something else broke");
});
