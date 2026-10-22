import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { removeDir } from "./helpers/platform.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  cursorArgs,
  cursorSessionMode,
  interpretAcp,
  permissionResult,
  pickCursorModel,
  planResult,
  promptBlocks,
} from "../src/providers/cursor-acp.ts";
import { CursorProvider } from "../src/providers/cursor.ts";
import type { ProviderEvent, SessionConfig } from "../src/providers/types.ts";

const models = [
  { id: "composer-2.5[fast=true]", name: "composer-2.5" },
  { id: "grok-4.7[context=256k,reasoning_effort=high,fast=true]", name: "grok-4.7" },
];

test("cursor args: Run Everything is --force, and only in work mode", () => {
  assert.deepEqual(cursorArgs("work", "everything"), ["--force", "acp"]);
  assert.deepEqual(cursorArgs("work", "manual"), ["acp"]);
  assert.deepEqual(cursorArgs("work", "auto"), ["acp"]);
  assert.deepEqual(cursorArgs("chat", "everything"), ["acp"]);
});

test("cursor session mode: chat is ask, plan is plan, run everything still has tools", () => {
  assert.equal(cursorSessionMode("chat", "manual"), "ask");
  assert.equal(cursorSessionMode("work", "plan"), "plan");
  assert.equal(cursorSessionMode("work", "everything"), "agent");
  assert.equal(cursorSessionMode("work", "manual"), "agent");
});

test("model pick: Composer by default, a name or an id when asked, a typo is refused", () => {
  assert.equal(pickCursorModel(models, null), "composer-2.5[fast=true]");
  assert.equal(pickCursorModel(models, "grok-4.7"), models[1].id);
  assert.equal(pickCursorModel(models, models[1].id), models[1].id);
  assert.equal(pickCursorModel(models, "nope"), null);
});

test("prompt carries the persona and pictures, since ACP has no system prompt", () => {
  const blocks = promptBlocks("You are Mio.", "hello", [{ mediaType: "image/png", data: "aaa" }]);
  assert.equal((blocks[0] as { text: string }).text.includes("You are Mio."), true);
  assert.equal((blocks[0] as { text: string }).text.includes("hello"), true);
  assert.deepEqual(blocks[1], { type: "image", data: "aaa", mimeType: "image/png" });
});

test("a shell permission becomes a card, and the answer maps onto Cursor's option ids", () => {
  const effect = interpretAcp({
    id: 7,
    method: "session/request_permission",
    params: {
      toolCall: { toolCallId: "call-1", name: "Shell", title: "List files", rawInput: { command: "ls" } },
      options: [
        { optionId: "allow-once", kind: "allow_once" },
        { optionId: "allow-always", kind: "allow_always" },
        { optionId: "reject-once", kind: "reject_once" },
      ],
    },
  }, ["Read", "Grep", "Glob"]);
  assert.equal(effect.permission?.request.tool, "Shell");
  assert.equal(effect.permission?.request.input.command, "ls");
  assert.equal(effect.replies.length, 0);
  assert.deepEqual(permissionResult("allow", effect.permission!.options).outcome.optionId, "allow-once");
  assert.deepEqual(permissionResult("allow-session", effect.permission!.options).outcome.optionId, "allow-always");
  assert.deepEqual(permissionResult("deny", effect.permission!.options).outcome.optionId, "reject-once");
});

test("a pre-approved read is allowed without a card", () => {
  const effect = interpretAcp({
    id: 3,
    method: "session/request_permission",
    params: {
      toolCall: { toolCallId: "call-2", name: "Read", rawInput: { path: "README.md" } },
      options: [{ optionId: "allow-once", kind: "allow_once" }, { optionId: "reject-once", kind: "reject_once" }],
    },
  }, ["Read", "Grep", "Glob"]);
  assert.equal(effect.permission, undefined);
  assert.equal(effect.replies[0].result && (effect.replies[0].result as { outcome: { optionId: string } }).outcome.optionId, "allow-once");
});

test("streamed text and a finished tool call become companion events", () => {
  const text = interpretAcp({
    method: "session/update",
    params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "[emotion:happy] hi" } } },
  }, []);
  assert.deepEqual(text.events, [{ type: "delta", text: "[emotion:happy] hi" }]);
  const tool = interpretAcp({
    method: "session/update",
    params: { update: { sessionUpdate: "tool_call_update", toolCallId: "call-1", name: "Shell", status: "completed", rawInput: { command: "ls" } } },
  }, []);
  assert.equal(tool.events[0].type, "tool");
  if (tool.events[0].type === "tool") assert.equal(tool.events[0].status, "done");
});

test("a plan approval is a card, and declining it rejects the plan", () => {
  const effect = interpretAcp({
    id: 4,
    method: "cursor/create_plan",
    params: { name: "Tidy the readme", plan: "1. Shorten the intro", overview: "Small edit" },
  }, []);
  assert.equal(effect.permission?.kind, "plan");
  assert.equal(effect.permission?.request.tool, "Plan");
  assert.deepEqual(planResult("deny").outcome.outcome, "rejected");
  assert.deepEqual(planResult("allow").outcome.outcome, "accepted");
});

const fakeAgent = `
import { createInterface } from "node:readline";
let promptId = null;
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") return reply(msg.id, { protocolVersion: 1 });
  if (msg.method === "authenticate") return reply(msg.id, {});
  if (msg.method === "session/new" || msg.method === "session/load") {
    return reply(msg.id, {
      sessionId: msg.params.sessionId ?? "sess-1",
      models: {
        currentModelId: "composer-2.5[fast=true]",
        availableModels: [
          { modelId: "composer-2.5[fast=true]", name: "composer-2.5" },
          { modelId: "grok-4.7[fast=true]", name: "grok-4.7" },
        ],
      },
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
          toolCall: { toolCallId: "t1", name: "Shell", rawInput: { command: "echo hi" } },
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
  if (msg.id === 99) reply(promptId, { stopReason: "end_turn" });
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

test("the provider streams a reply, and Run Everything spawns with --force", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cursor-acp-"));
  const script = join(dir, "fake.mjs");
  await writeFile(script, fakeAgent);
  const seen: string[][] = [];
  const provider = new CursorProvider({
    config: config({ permissionMode: "everything", cwd: dir }),
    chatCwd: dir,
    persona: () => "You are Mio.",
    spawnAgent: (args, cwd) => {
      seen.push(args);
      return spawn(process.execPath, [script], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    },
  });
  try {
    assert.deepEqual(seen, []);
    const events: ProviderEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      provider.send("hi", (event) => {
        events.push(event);
        if (event.type === "done") resolve();
        if (event.type === "error") reject(new Error(event.message));
      });
    });
    assert.deepEqual(seen[0], ["--force", "acp"]);
    assert.equal(events.some((event) => event.type === "delta" && event.text.includes("hello")), true);
    assert.equal(provider.modelLabel, "composer-2.5");
    assert.equal(provider.sessionId, "sess-1");
  } finally {
    provider.close();
    removeDir(dir); // the script may be a moment from gone; Windows will not delete the folder it runs in until it is
  }
});

test("a permission request reaches the card and the allow answer lets the turn finish", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cursor-acp-"));
  const script = join(dir, "fake.mjs");
  await writeFile(script, fakeAgent);
  const provider = new CursorProvider({
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

test("the Cursor CLI's own approval setting is read (and only read): 'unrestricted' is the one that never asks", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { cursorApprovalMode, CURSOR_UNRESTRICTED_TEXT } = await import("../src/providers/cursor-acp.ts");
  const dir = await mkdtemp(join(tmpdir(), "cursor-config-"));
  try {
    const file = join(dir, "cli-config.json");
    assert.equal(cursorApprovalMode(file), null, "no file");
    await writeFile(file, JSON.stringify({ approvalMode: "unrestricted", permissions: { allow: [] } }));
    assert.equal(cursorApprovalMode(file), "unrestricted");
    await writeFile(file, JSON.stringify({ approvalMode: "allowlist" }));
    assert.equal(cursorApprovalMode(file), "allowlist");
    await writeFile(file, JSON.stringify({ version: 1 }));
    assert.equal(cursorApprovalMode(file), null, "no such setting: the default, which asks");
    await writeFile(file, "not json");
    assert.equal(cursorApprovalMode(file), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.match(CURSOR_UNRESTRICTED_TEXT, /Nothing was sent/);
  assert.match(CURSOR_UNRESTRICTED_TEXT, /Everything in the permission menu/);
});

test("cursorErrorText names the locked keychain and the step to take, and leaves other errors alone", async () => {
  const { cursorErrorText } = await import("../src/providers/cursor-acp.ts");
  const locked = cursorErrorText("cursor-agent exited (1). Error: Your macOS login keychain is locked.\nRun security unlock-keychain and try again.");
  assert.match(locked, /security unlock-keychain/);
  assert.match(locked, /send your message again/);
  assert.doesNotMatch(locked, /exited \(1\)/);
  assert.equal(cursorErrorText("cursor-agent exited (2). Something else broke"), "cursor-agent exited (2). Something else broke");
});
