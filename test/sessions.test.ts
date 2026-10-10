import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { listSessions, loadSessionItems, sessionDirFor, sessionPath } from "../src/sessions.ts";

// Shaped like the lines in ~/.claude/projects/<folder>/<id>.jsonl, trimmed.
const A = "11111111-2222-3333-4444-555555555555";
const B = "66666666-7777-8888-9999-000000000000";
const line = (o: object) => JSON.stringify({ isSidechain: false, ...o });
const user = (content: unknown, extra: object = {}) => line({ type: "user", message: { role: "user", content }, ...extra });
const assistant = (...content: object[]) => line({ type: "assistant", message: { role: "assistant", content } });

const sessionA = [
  line({ type: "queue-operation", content: "hello" }),
  user("(system note, not from the user: you made a mistake.)\n\nhello there"),
  line({ type: "attachment" }),
  assistant({ type: "thinking", thinking: "" }),
  assistant({ type: "text", text: "[emotion:happy] Hi!" }),
  assistant({ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } }),
  user([{ type: "tool_result", tool_use_id: "t1", content: "files", is_error: false }]),
  assistant({ type: "tool_use", id: "t2", name: "Read", input: { file_path: "/x" } }),
  user([{ type: "tool_result", tool_use_id: "t2", content: "nope", is_error: true }]),
  assistant({ type: "tool_use", id: "t3", name: "Grep", input: { pattern: "a" } }), // interrupted: no result
  user("<command-name>/compact</command-name>"),
  user("The summary of the earlier conversation", { isCompactSummary: true }),
  user("context the harness added", { isMeta: true }),
  user("side chatter", { isSidechain: true }),
  assistant({ type: "text", text: "Done." }),
  "not json",
].join("\n");

let dir = "";
const previous = process.env.CLAUDE_CONFIG_DIR;
const cwd = "/Users/someone/my_project";

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "sessions-"));
  process.env.CLAUDE_CONFIG_DIR = dir;
  await mkdir(sessionDirFor(cwd), { recursive: true });
  await writeFile(join(sessionDirFor(cwd), `${A}.jsonl`), sessionA);
  await writeFile(join(sessionDirFor(cwd), `${B}.jsonl`), user("an older one") + "\n");
  await writeFile(join(sessionDirFor(cwd), "notes.jsonl"), user("not a session id"));
  await utimes(join(sessionDirFor(cwd), `${B}.jsonl`), new Date("2026-01-01"), new Date("2026-01-01"));
});

after(async () => {
  if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previous;
  await rm(dir, { recursive: true, force: true });
});

test("a folder's session directory is its path with odd characters as dashes", () => {
  assert.equal(sessionDirFor(cwd), join(dir, "projects", "-Users-someone-my-project"));
});

test("lists sessions newest first, titled by what the user first said, without our own notes", async () => {
  const sessions = await listSessions(cwd);
  assert.deepEqual(sessions.map((s) => [s.id, s.title]), [[A, "hello there"], [B, "an older one"]]);
  assert.deepEqual(await listSessions("/nowhere"), []);
});

test("rebuilds the visible conversation and skips injected context", async () => {
  const items = await loadSessionItems(sessionPath(cwd, A)!);
  assert.deepEqual(items, [
    { type: "user", text: "hello there" },
    { type: "bot", text: "[emotion:happy] Hi!" },
    { type: "tool", id: "t1", name: "Bash", summary: "ls -la", status: "done" },
    { type: "tool", id: "t2", name: "Read", summary: "/x", status: "error" },
    { type: "tool", id: "t3", name: "Grep", summary: "a", status: "done" },
    { type: "bot", text: "Done." },
  ]);
  assert.equal((await loadSessionItems(sessionPath(cwd, A)!, 2)).length, 2);
});

test("only well-formed session ids become paths", () => {
  assert.equal(sessionPath(cwd, "../../etc/passwd"), null);
  assert.equal(sessionPath(cwd, "notes"), null);
  assert.ok(sessionPath(cwd, A)?.endsWith(`${A}.jsonl`));
});
