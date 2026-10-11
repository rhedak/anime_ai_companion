import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Transcript, claudeSessionExists } from "../src/transcript.ts";

test("gathers streamed text into messages and orders tools between them", () => {
  const t = new Transcript("unused");
  t.user("hi");
  t.delta("Let me ");
  t.delta("check.");
  t.tool({ type: "tool", id: "a", name: "Bash", summary: "ls", status: "running" });
  t.tool({ type: "tool", id: "a", name: "Bash", summary: "ls", status: "done" }); // same id: updated in place
  t.delta("All good.");
  t.flush();
  assert.deepEqual(t.items, [
    { type: "user", text: "hi" },
    { type: "bot", text: "Let me check." },
    { type: "tool", id: "a", name: "Bash", summary: "ls", status: "done" },
    { type: "bot", text: "All good." },
  ]);
});

test("a snapshot includes a reply that is still streaming without closing it", () => {
  const t = new Transcript("unused");
  t.user("hi");
  t.delta("typing");
  assert.equal(t.snapshot().at(-1)?.type, "bot");
  assert.equal(t.items.length, 1);
  t.delta("...");
  t.flush();
  assert.deepEqual(t.items.at(-1), { type: "bot", text: "typing..." });
});

test("saves and loads, keeping the session id", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "aic-")), "sub", "transcript.json");
  const a = new Transcript(path);
  a.user("remember me");
  a.look(["hair_color=#ff0000"]);
  await a.save({ provider: "claude", sessionId: "11111111-2222-3333-4444-555555555555" });

  const b = new Transcript(path);
  assert.deepEqual(await b.load(), {
    provider: "claude",
    sessionId: "11111111-2222-3333-4444-555555555555",
    contextTokens: null,
    lastReplyAt: null,
  });
  assert.deepEqual(b.items, a.items);
  assert.equal(await new Transcript(join(tmpdir(), "does-not-exist.json")).load(), null);
});

test("finds a Claude Code session on disk, and rejects odd ids", async () => {
  const config = await mkdtemp(join(tmpdir(), "aic-claude-"));
  const id = "99999999-8888-7777-6666-555555555555";
  await mkdir(join(config, "projects", "-some-folder"), { recursive: true });
  await writeFile(join(config, "projects", "-some-folder", `${id}.jsonl`), "{}\n");
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  try {
    assert.equal(await claudeSessionExists(id), true);
    assert.equal(await claudeSessionExists("00000000-0000-0000-0000-000000000000"), false);
    assert.equal(await claudeSessionExists("../../etc/passwd"), false);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
});

test("keeps how big the conversation was and when she last replied, for the cold-cache check", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "aic-")), "transcript.json");
  const a = new Transcript(path);
  a.user("hi");
  await a.save({ provider: "claude", sessionId: "s1", contextTokens: 354_000, lastReplyAt: 1_700_000_000_000 });
  const meta = await new Transcript(path).load();
  assert.equal(meta?.contextTokens, 354_000);
  assert.equal(meta?.lastReplyAt, 1_700_000_000_000);
});

test("a log saved before these were kept loads with them unknown", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "aic-")), "transcript.json");
  await writeFile(path, JSON.stringify({ provider: "claude", sessionId: "s1", items: [] }));
  const meta = await new Transcript(path).load();
  assert.equal(meta?.contextTokens, null);
  assert.equal(meta?.lastReplyAt, null);
});
