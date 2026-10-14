import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAll, formatDoctor, parsePython, type Probe } from "../src/doctor.ts";

/** A machine where everything is fine; each test spoils one thing. */
function machine(overrides: Partial<Probe> & { files?: string[]; programs?: Record<string, string>; web?: Record<string, string> } = {}): Probe {
  const files = new Set(["/repo/node_modules/ws", "/repo/data", "/anime-character-creator/src", ...(overrides.files ?? [])]);
  // `programs` and `web` replace the defaults when given, so a test can take a thing away.
  const programs: Record<string, string> = overrides.programs ?? { "/repo/.venv/bin/python --version": "Python 3.12.1", "claude --version": "2.1.296 (Claude Code)", "git --version": "git version 2.45" };
  const web: Record<string, string> = overrides.web ?? { "http://127.0.0.1:11434/api/tags": JSON.stringify({ models: [{ name: "a" }, { name: "b" }] }) };
  const { files: _files, programs: _programs, web: _web, ...probe } = overrides;
  return {
    env: {},
    nodeVersion: "25.9.0",
    root: "/repo",
    home: "/home/me",
    python: "/repo/.venv/bin/python",
    port: 3737,
    run: (command, args) => programs[[command, ...args].join(" ")] ?? null,
    exists: (path) => files.has(path),
    readText: () => JSON.stringify({ creator: { ref: "v0.2.2" } }),
    writable: () => true,
    get: async (url) => web[url] ?? null,
    portFree: async () => true,
    ...probe,
  };
}

const levels = async (p: Probe) => (await checkAll(p)).map((l) => [l.level, l.text.slice(0, 40)]);

test("everything in place: all ok, exit clean, and the summary says so", async () => {
  const lines = await checkAll(machine());
  const bad = lines.filter((l) => l.level === "fail");
  assert.deepEqual(bad, []);
  assert.ok(lines.some((l) => l.level === "ok" && /Claude Code 2\.1\.296/.test(l.text)));
  assert.ok(lines.some((l) => l.level === "ok" && /Ollama.*2 models/.test(l.text)));
  assert.ok(lines.some((l) => l.level === "ok" && /Python 3\.12/.test(l.text)));
  assert.match(formatDoctor(lines.filter((l) => l.level === "ok")), /Everything looks fine/);
});

test("a Python that is too old, or missing, is a failure with the way out", async () => {
  const old = await checkAll(machine({ programs: { "/repo/.venv/bin/python --version": "Python 3.9.9", "claude --version": "2" } }));
  const tooOld = old.find((l) => l.level === "fail")!;
  assert.match(tooOld.text, /Python 3\.9 is too old/);
  assert.match(tooOld.hint!, /uv sync/);
  const missing = await checkAll(machine({ python: "python3", programs: {} }));
  assert.ok(missing.some((l) => l.level === "fail" && /Python not found/.test(l.text)));
});

test("no brain at all is a failure; a single missing brain is only a note", async () => {
  const none = await checkAll(machine({ programs: { "/repo/.venv/bin/python --version": "Python 3.12.1", "git --version": "git version 2" }, web: {} }));
  assert.ok(none.some((l) => l.level === "fail" && /No brain found/.test(l.text)));
  const one = await checkAll(machine());
  assert.ok(!one.some((l) => l.level === "fail"));
  assert.ok(one.some((l) => l.level === "warn" && /Cursor: not found/.test(l.text)), "a brain you do not use is only a warning");
  assert.ok(one.some((l) => l.level === "warn" && /opencode: not found/.test(l.text)));
});

test("the creator: next to the repo, already fetched, to be fetched, or impossible", async () => {
  const sibling = await checkAll(machine());
  assert.ok(sibling.some((l) => l.level === "ok" && /next to this repo/.test(l.text)));
  const gone = machine();
  const fetchedLater = await checkAll({ ...gone, exists: (p) => p === "/repo/node_modules/ws" || p === "/repo/data" || p === "/home/me/.anaico/creator/v0.2.2/src" });
  assert.ok(fetchedLater.some((l) => l.level === "ok" && /v0\.2\.2: already fetched/.test(l.text)));
  const willFetch = await checkAll({ ...gone, exists: (p) => p === "/repo/node_modules/ws" || p === "/repo/data" });
  assert.ok(willFetch.some((l) => l.level === "warn" && /first start downloads it/.test(l.text)));
  const noGit = await checkAll({ ...gone, exists: (p) => p === "/repo/node_modules/ws" || p === "/repo/data", run: (c, a) => (c === "git" ? null : gone.run(c, a)) });
  assert.ok(noGit.some((l) => l.level === "fail" && /git is not installed/.test(l.text)));
  const badOverride = await checkAll({ ...gone, env: { CREATOR_SRC: "/nowhere/src" } });
  assert.ok(badOverride.some((l) => l.level === "fail" && /CREATOR_SRC points at/.test(l.text)));
});

test("a busy port is fine when it is the companion itself, and a warning when it is not", async () => {
  const running = await checkAll(machine({ portFree: async () => false, web: { "http://127.0.0.1:3737/": "<html>" } }));
  assert.ok(running.some((l) => l.level === "ok" && /probably the companion is already running/.test(l.text)));
  const taken = await checkAll(machine({ portFree: async () => false }));
  assert.ok(taken.some((l) => l.level === "warn" && /Port 3737 is in use/.test(l.text)));
});

test("missing packages and an unwritable data folder are failures", async () => {
  const lines = await levels(machine({ exists: (p) => p === "/anime-character-creator/src", writable: () => false }));
  assert.ok(lines.some(([level, text]) => level === "fail" && /npm packages/.test(text as string)));
  assert.ok(lines.some(([level, text]) => level === "fail" && /data\/ is not writable|data/.test(text as string)));
});

test("the report lists hints under problems only, and counts them", async () => {
  const text = formatDoctor(await checkAll(machine({ programs: { "/repo/.venv/bin/python --version": "Python 3.9.9", "claude --version": "2" } })));
  assert.match(text, /✗ Python 3\.9 is too old[^]*\n {4}Run `uv sync`/);
  assert.match(text, /1 problem to fix before it will start/);
  assert.doesNotMatch(text, /✓ Node[^\n]*\n {4}/, "no hint under an ok line");
});

test("Python versions are read from `python --version` output", () => {
  assert.deepEqual(parsePython("Python 3.12.1"), [3, 12]);
  assert.deepEqual(parsePython("Python 3.9.9\n"), [3, 9]);
  assert.equal(parsePython("command not found"), null);
});

test("a checkout of the creator that is not at the pinned release is a warning with the way back, and one at it is fine", async () => {
  const git = "git -C /anime-character-creator describe --tags --always";
  const ahead = await checkAll(machine({ programs: { "/repo/.venv/bin/python --version": "Python 3.12.1", "claude --version": "2", "git --version": "git version 2.45", [git]: "v0.2.2-1-g1bcb2f8" } }));
  const warning = ahead.find((l) => /next to this repo is at v0\.2\.2-1-g1bcb2f8/.test(l.text));
  assert.equal(warning?.level, "warn");
  assert.match(warning!.text, /not the release this version pins \(v0\.2\.2\)/);
  assert.match(warning!.hint!, /checkout v0\.2\.2/);
  const exact = await checkAll(machine({ programs: { "/repo/.venv/bin/python --version": "Python 3.12.1", "claude --version": "2", "git --version": "git version 2.45", [git]: "v0.2.2" } }));
  assert.ok(exact.some((l) => l.level === "ok" && /the checkout next to this repo/.test(l.text)));
  assert.ok(!exact.some((l) => /not the release/.test(l.text)));
});
