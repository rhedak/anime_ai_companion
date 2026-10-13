import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ClaudeCodeProvider } from "../src/providers/claude-code.ts";
import type { ProviderEvent } from "../src/providers/types.ts";

// A real `claude` capture: she answers, the turn ends, then a finished background subagent makes the CLI
// start a second turn on its own. The stand-in below replays it; a real claude is never started, because
// PATH holds only the stand-in while these tests run.
const fixture = new URL("./fixtures/claude-background-subagent.jsonl", import.meta.url).pathname;

function standIn(): { dir: string; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "anaico-claude-"));
  const script = join(dir, "claude");
  writeFileSync(
    script,
    `#!${process.execPath}
const lines = require("fs").readFileSync(${JSON.stringify(fixture)}, "utf8").split("\\n").filter(Boolean);
// Split the recording after each result: the first turn answers the user, the second starts on its own.
const parts = [[]];
for (const line of lines) {
  parts.at(-1).push(line);
  if (JSON.parse(line).type === "result") parts.push([]);
}
const print = (part) => part.forEach((l) => console.log(l));
require("readline").createInterface({ input: process.stdin }).on("line", () => {
  print(parts[0]);
  setTimeout(() => print(parts[1]), 100);
});
`,
  );
  chmodSync(script, 0o755);
  const saved = process.env.PATH;
  process.env.PATH = dir;
  return {
    dir,
    restore: () => {
      process.env.PATH = saved;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function provider(): ClaudeCodeProvider {
  return new ClaudeCodeProvider({
    config: { mode: "chat", cwd: tmpdir(), model: "haiku", allowedTools: [], permissionMode: "manual", claudeSetup: false, claudeSkills: false, effort: null },
    chatCwd: tmpdir(),
    persona: () => "persona",
  });
}

const until = (done: () => boolean) =>
  new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const tick = () => (done() ? resolve() : Date.now() - started > 5000 ? reject(new Error("timed out")) : setTimeout(tick, 20));
    tick();
  });

const text = (events: ProviderEvent[]) => events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");

test("a turn claude starts on its own reaches the handler given to onUnprompted", async () => {
  const { restore } = standIn();
  const claude = provider();
  try {
    const first: ProviderEvent[] = [];
    const second: ProviderEvent[] = [];
    claude.onUnprompted(() => (event) => second.push(event));
    claude.send("hi", (event) => first.push(event));

    await until(() => second.some((e) => e.type === "done"));

    assert.equal(text(first), "I'm waiting for the background subagent to finish its reply.");
    assert.equal(first.at(-1)?.type, "done");
    assert.equal(text(second), 'The background subagent finished and replied "done".');
    assert.equal(second.at(-1)?.type, "done");
    assert.equal(claude.busy, false, "free again after the unprompted turn ends");
  } finally {
    claude.close();
    restore();
  }
});

test("a turn nobody asked for is busy while it runs, so a user message is refused until it ends", async () => {
  const { restore } = standIn();
  const claude = provider();
  try {
    let busyDuring: boolean | null = null;
    const second: ProviderEvent[] = [];
    claude.onUnprompted(() => (event) => {
      if (event.type === "delta" && busyDuring === null) busyDuring = claude.busy;
      second.push(event);
    });
    claude.send("hi", () => {});
    await until(() => second.some((e) => e.type === "done"));
    assert.equal(busyDuring, true);
  } finally {
    claude.close();
    restore();
  }
});

test("without a handler the extra turn is dropped, as before, and the provider stays usable", async () => {
  const { restore } = standIn();
  const claude = provider();
  try {
    const first: ProviderEvent[] = [];
    claude.send("hi", (event) => first.push(event));
    await until(() => first.some((e) => e.type === "done"));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(claude.busy, false);
  } finally {
    claude.close();
    restore();
  }
});

test("background tasks are reported while the subagent runs and cleared when it ends", async () => {
  const { restore } = standIn();
  const claude = provider();
  try {
    const seen: string[][] = [];
    claude.onBackground((tasks) => seen.push(tasks.map((t) => t.description)));
    claude.onUnprompted(() => () => {});
    claude.send("hi", () => {});
    await until(() => seen.length >= 2);
    assert.deepEqual(seen, [["Reply with done"], []]);
    assert.deepEqual(claude.backgroundTasks, []);
  } finally {
    claude.close();
    restore();
  }
});

test("the fixture is what the test says it is: two turns, the second marked as a task notification", () => {
  const results = readFileSync(fixture, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.type === "result");
  assert.equal(results.length, 2);
  assert.equal(results[1].origin?.kind, "task-notification");
});
