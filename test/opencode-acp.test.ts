import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
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
  opencodeSupportsPure,
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
  assert.deepEqual(opencodeArgs(), ["acp", "--pure", "--print-logs", "--log-level", "ERROR"]);
  assert.deepEqual(opencodeArgs(true), ["acp", "--pure", "--print-logs", "--log-level", "ERROR"]);
});

test("--pure is only passed where it still exists: opencode 2.x dropped it and exits 1 on launch", () => {
  assert.deepEqual(opencodeArgs(opencodeSupportsPure("1.19.3")), ["acp", "--pure", "--print-logs", "--log-level", "ERROR"]);
  assert.deepEqual(opencodeArgs(opencodeSupportsPure("opencode 1.18.35")), ["acp", "--pure", "--print-logs", "--log-level", "ERROR"]);
  assert.deepEqual(opencodeArgs(opencodeSupportsPure("opencode v2.0.32")), ["acp"]); // what 2.x really prints
  assert.deepEqual(opencodeArgs(opencodeSupportsPure("2.0.32")), ["acp"]);
  assert.deepEqual(opencodeArgs(opencodeSupportsPure("v2.1.0")), ["acp"]);
  // An unreadable answer keeps opencode's default (the flag), so a 1.x install is never started differently by mistake.
  assert.deepEqual(opencodeArgs(opencodeSupportsPure("")), ["acp", "--pure", "--print-logs", "--log-level", "ERROR"]);
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
    claudeChrome: false,
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
    versionOf: async () => "1.19.3",
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
    assert.deepEqual(seen[0], ["acp", "--pure", "--print-logs", "--log-level", "ERROR"]);
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

test("an opencode 2.x install is started without --pure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-acp-"));
  const script = join(dir, "fake.mjs");
  await writeFile(script, fakeAgent);
  const seen: string[][] = [];
  const provider = new OpenCodeProvider({
    config: config({ cwd: dir }),
    chatCwd: dir,
    persona: () => "You are Mio.",
    versionOf: async () => "2.0.32",
    spawnAgent: (args, cwd) => {
      seen.push(args);
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
    assert.deepEqual(seen[0], ["acp"]);
  } finally {
    provider.close();
    removeDir(dir);
  }
});

test("a version that cannot be read keeps --pure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-acp-"));
  const script = join(dir, "fake.mjs");
  await writeFile(script, fakeAgent);
  const seen: string[][] = [];
  const spawnAgent = (args: string[], cwd: string) => {
    seen.push(args);
    return spawn(process.execPath, [script], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  };
  const unreadable = new OpenCodeProvider({ config: config({ cwd: dir }), chatCwd: dir, persona: () => "You are Mio.", versionOf: async () => Promise.reject(new Error("no such program")), spawnAgent });
  try {
    await new Promise<void>((resolve, reject) => {
      unreadable.send("hi", (event) => {
        if (event.type === "done") resolve();
        if (event.type === "error") reject(new Error(event.message));
      });
    });
    assert.deepEqual(seen[0], ["acp", "--pure", "--print-logs", "--log-level", "ERROR"]);
  } finally {
    unreadable.close();
    removeDir(dir);
  }
});

test("a process that dies on launch reports the code and what it printed on stderr", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-acp-"));
  const script = join(dir, "die.mjs");
  await writeFile(script, `process.stderr.write("ERROR\\n  Unrecognized flag: --pure in command opencode acp\\n");\nprocess.exit(1);\n`);
  const provider = new OpenCodeProvider({
    config: config({ cwd: dir }),
    chatCwd: dir,
    persona: () => "You are Mio.",
    versionOf: async () => "2.0.32",
    spawnAgent: (_args, cwd) => spawn(process.execPath, [script], { cwd, stdio: ["pipe", "pipe", "pipe"] }),
  });
  try {
    const events: ProviderEvent[] = [];
    await new Promise<void>((resolve) => {
      provider.send("hi", (event) => {
        events.push(event);
        if (event.type === "done" || event.type === "error") resolve();
      });
    });
    const error = events.find((event) => event.type === "error");
    assert.ok(error && error.type === "error" && /exited \(1\)/.test(error.message));
    assert.ok(error && error.type === "error" && /Unrecognized flag: --pure/.test(error.message));
  } finally {
    provider.close();
    removeDir(dir);
  }
});

test("a write to the stdin of a process that has already gone is not an uncaught EPIPE that takes the server down", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-acp-"));
  const crashes: Error[] = [];
  const onCrash = (err: Error) => crashes.push(err);
  process.on("uncaughtException", onCrash);
  // A process whose stdin has no reader any more: every write fails with EPIPE, asynchronously, the way a real pipe does.
  const stdin = new Writable({ write: (_chunk, _encoding, done) => done(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })) });
  const gone = Object.assign(new EventEmitter(), { stdin, stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
  const provider = new OpenCodeProvider({
    config: config({ cwd: dir }),
    chatCwd: dir,
    persona: () => "You are Mio.",
    versionOf: async () => "2.1.0",
    spawnAgent: () => {
      setTimeout(() => {
        gone.stderr.write("it died\n");
        gone.emit("close", 1);
      }, 100);
      return gone as never;
    },
  });
  try {
    const events: ProviderEvent[] = [];
    await new Promise<void>((resolve) => {
      provider.send("hi", (event) => {
        events.push(event);
        if (event.type === "done" || event.type === "error") resolve();
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 100)); // an EPIPE is raised on a later tick
    assert.deepEqual(crashes.map((err) => err.message), []);
    assert.ok(events.some((event) => event.type === "error" && /exited \(1\)[^]*it died/.test(event.message)));
  } finally {
    process.off("uncaughtException", onCrash);
    provider.close();
    removeDir(dir);
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
    versionOf: async () => "1.19.3",
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

test("a prompt opencode never answers ends with the quota error from its log, and the next message starts a fresh process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-acp-"));
  const script = join(dir, "fake.mjs");
  // Like the real one with its free quota used up: the prompt gets no answer, and the reason is only in the log on stderr.
  await writeFile(script, fakeAgent.replace('if (msg.method === "session/prompt") {', `if (msg.method === "session/prompt") {
    process.stderr.write('timestamp=2026-10-22T23:00:19.330Z level=ERROR message="stream error" session.id=sess-oc-1 small=false agent=build error.error="AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go"\\n');
    return;`));
  let starts = 0;
  const provider = new OpenCodeProvider({
    config: config({ cwd: dir }),
    chatCwd: dir,
    persona: () => "You are Mio.",
    versionOf: async () => "1.19.3",
    spawnAgent: (_args, cwd) => {
      starts++;
      return spawn(process.execPath, [script], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    },
  });
  try {
    const ask = () =>
      new Promise<string>((resolve) => {
        provider.send("hello", (event) => {
          if (event.type === "error") resolve(event.message);
        });
      });
    const first = await ask();
    assert.match(first, /^Free usage limit reached\./);
    assert.match(first, /Choose another model in the model menu/);
    assert.equal(provider.busy, false);
    assert.match(await ask(), /^Free usage limit reached\./);
    assert.equal(starts, 2, "the stuck process was replaced");
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
    versionOf: async () => "1.19.3",
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

test("a failed model call in opencode's log becomes the turn's error, and the quota case says what to do", async () => {
  const { opencodeStreamError, opencodeErrorText } = await import("../src/providers/opencode-acp.ts");
  const line = (small: string, sid: string, error: string) =>
    `timestamp=2026-10-22T23:00:19.330Z level=ERROR run=e9747a8a message="stream error" providerID=opencode modelID=big-pickle session.id=${sid} small=${small} agent=build mode=primary error.error="${error}"`;
  const quota = "AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go";
  assert.equal(opencodeStreamError(line("false", "ses_a", quota), "ses_a"), "Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go");
  assert.equal(opencodeStreamError(line("true", "ses_a", quota), "ses_a"), null); // the title agent's call
  assert.equal(opencodeStreamError(line("false", "ses_b", quota), "ses_a"), null); // another session
  assert.equal(opencodeStreamError("timestamp=x level=INFO message=loop session.id=ses_a", "ses_a"), null);
  assert.equal(opencodeStreamError(line("false", "ses_a", "AI_RetryError: Failed after 3 attempts. Last error: Rate limited"), "ses_a"), "Rate limited");
  const said = opencodeErrorText("Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go");
  assert.match(said, /^Free usage limit reached\./);
  assert.match(said, /Choose another model in the model menu/);
  assert.match(said, /https:\/\/opencode\.ai\/go\.$/);
});

test("a data folder written by another opencode version is explained, with opencode's own words kept", async () => {
  const { opencodeErrorText } = await import("../src/providers/opencode-acp.ts");
  const said = opencodeErrorText("opencode exited (1). Error: Unexpected error\n\nDatabase is not empty and has no session table");
  assert.match(said, /^opencode exited \(1\)\. Error: Unexpected error/);
  assert.match(said, /no session table/);
  assert.match(said, /opencode debug paths/);
  assert.match(said, /different version/);
});

test("closing while a turn is in flight does not start the agent again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-acp-"));
  const script = join(dir, "fake.mjs");
  await writeFile(script, fakeAgent);
  let spawned = 0;
  const provider = new OpenCodeProvider({
    config: config({ cwd: dir }),
    chatCwd: dir,
    persona: () => "You are Mio.",
    versionOf: async () => "1.19.3",
    spawnAgent: (_args, cwd) => {
      spawned++;
      return spawn(process.execPath, [script], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    },
  });
  try {
    provider.send("hi", () => {});
    await new Promise((resolve) => setTimeout(resolve, 20)); // the turn is under way
    provider.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(spawned <= 1, `close() must not be followed by a second start (started ${spawned})`);
  } finally {
    provider.close();
    removeDir(dir);
  }
});
