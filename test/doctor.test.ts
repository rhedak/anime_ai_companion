import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAll, formatDoctor, type Probe } from "../src/doctor.ts";

/** The tests name paths the POSIX way; on Windows the code under test builds them with backslashes and a drive letter, so a path is read back in the POSIX form. */
const posix = (path: string): string => path.replace(/^[A-Za-z]:/, "").replace(/\\/g, "/");
/** The same for a command line, where a path can be anywhere in it. */
const posixLine = (line: string): string => line.replace(/[A-Za-z]:(?=[\\/])/g, "").replace(/\\/g, "/");
/** An `exists` that knows exactly these (POSIX-form) paths. */
const has = (...paths: string[]) => (p: string) => paths.includes(posix(p));

/** A machine where everything is fine; each test spoils one thing. */
function machine(overrides: Partial<Probe> & { files?: string[]; programs?: Record<string, string>; web?: Record<string, string> } = {}): Probe {
  const files = new Set(["/repo/node_modules/ws", "/repo/data", "/anime-character-creator/ts/src", "/anime-character-creator/ts/src/render.ts", ...(overrides.files ?? [])]);
  // `programs` and `web` replace the defaults when given, so a test can take a thing away.
  const programs: Record<string, string> = overrides.programs ?? { "claude --version": "2.1.296 (Claude Code)", "git --version": "git version 2.45" };
  const web: Record<string, string> = overrides.web ?? { "http://127.0.0.1:11434/api/tags": JSON.stringify({ models: [{ name: "a" }, { name: "b" }] }) };
  const { files: _files, programs: _programs, web: _web, ...probe } = overrides;
  return {
    env: {},
    nodeVersion: "25.9.0",
    root: "/repo",
    home: "/home/me",
    port: 3737,
    run: (command, args) => programs[posixLine([command, ...args].join(" "))] ?? null,
    exists: (path) => files.has(posix(path)),
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
  assert.ok(!lines.some((l) => /python/i.test(l.text)), "nothing about Python: the creator's TypeScript draws her, in this process");
  assert.match(formatDoctor(lines.filter((l) => l.level === "ok")), /Everything looks fine/);
});

test("no brain at all is a failure; a single missing brain is only a note", async () => {
  const none = await checkAll(machine({ programs: { "git --version": "git version 2" }, web: {} }));
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
  const fetchedLater = await checkAll({ ...gone, exists: has("/repo/node_modules/ws", "/repo/data", "/home/me/.anaico/creator/v0.2.2", "/home/me/.anaico/creator/v0.2.2/ts/src/render.ts") });
  assert.ok(fetchedLater.some((l) => l.level === "ok" && /v0\.2\.2: already fetched/.test(l.text)));
  const willFetch = await checkAll({ ...gone, exists: has("/repo/node_modules/ws", "/repo/data") });
  assert.ok(willFetch.some((l) => l.level === "warn" && /first start downloads it/.test(l.text)));
  const noGit = await checkAll({ ...gone, exists: has("/repo/node_modules/ws", "/repo/data"), run: (c, a) => (c === "git" ? null : gone.run(c, a)) });
  assert.ok(noGit.some((l) => l.level === "fail" && /git is not installed/.test(l.text)));
  const badOverride = await checkAll({ ...gone, env: { CREATOR_SRC: "/nowhere/src" } });
  assert.ok(badOverride.some((l) => l.level === "fail" && /CREATOR_SRC points at/.test(l.text)));
});

test("the creator must be its TypeScript: a folder without render.ts (the Python src of an earlier release) is a failure with the way out", async () => {
  const only = ["/repo/node_modules/ws", "/repo/data"];
  const exists = (extra: string[]) => has(...only, ...extra);
  const override = await checkAll(machine({ env: { CREATOR_SRC: "/old/src" }, exists: exists(["/old/src"]) }));
  const bad = override.find((l) => l.level === "fail" && /has no render\.ts/.test(l.text));
  assert.ok(bad, "an override that is not the TypeScript");
  assert.match(bad!.hint!, /ts\/src/);
  assert.ok((await checkAll(machine({ env: { CREATOR_SRC: "/new/ts/src" }, exists: exists(["/new/ts/src", "/new/ts/src/render.ts"]) }))).some((l) => l.level === "ok" && /CREATOR_SRC/.test(l.text)));
  const sibling = await checkAll(machine({ exists: exists(["/anime-character-creator/ts/src"]) }));
  assert.ok(sibling.some((l) => l.level === "fail" && /next to this repo\) has no render\.ts/.test(l.text)));
  const fetched = await checkAll(machine({ exists: exists(["/home/me/.anaico/creator/v0.2.2"]) }));
  assert.ok(fetched.some((l) => l.level === "fail" && /fetched for v0\.2\.2\) has no render\.ts/.test(l.text)));
  // an older release next to this repo (the Python layout) is not used; the first start fetches the pinned one, and the hint says so
  const older = await checkAll(machine({ exists: exists(["/anime-character-creator/src"]) }));
  const fetch = older.find((l) => l.level === "warn" && /first start downloads it/.test(l.text));
  assert.match(fetch!.hint!, /has no ts\/src/);
});

test("a busy port is fine when it is the companion itself, and a warning when it is not", async () => {
  const running = await checkAll(machine({ portFree: async () => false, web: { "http://127.0.0.1:3737/": "<html>" } }));
  assert.ok(running.some((l) => l.level === "ok" && /probably the companion is already running/.test(l.text)));
  const taken = await checkAll(machine({ portFree: async () => false }));
  assert.ok(taken.some((l) => l.level === "warn" && /Port 3737 is in use/.test(l.text)));
});

test("missing packages and an unwritable data folder are failures", async () => {
  const lines = await levels(machine({ exists: has("/anime-character-creator/src"), writable: () => false }));
  assert.ok(lines.some(([level, text]) => level === "fail" && /npm packages/.test(text as string)));
  assert.ok(lines.some(([level, text]) => level === "fail" && /data\/ is not writable|data/.test(text as string)));
});

test("the report lists hints under problems only, and counts them", async () => {
  const text = formatDoctor(await checkAll(machine({ env: { CREATOR_SRC: "/old/src" }, exists: has("/repo/node_modules/ws", "/repo/data", "/old/src") })));
  assert.match(text, /✗ Character creator: \/old\/src \(CREATOR_SRC\) has no render\.ts[^\n]*\n {4}Point it at the creator's ts\/src folder/);
  assert.match(text, /1 problem to fix before it will start/);
  assert.doesNotMatch(text, /✓ Node[^\n]*\n {4}/, "no hint under an ok line");
});

test("a checkout of the creator that is not at the pinned release is a warning with the way back, and one at it is fine", async () => {
  const git = "git -C /anime-character-creator describe --tags --always";
  const ahead = await checkAll(machine({ programs: { "claude --version": "2", "git --version": "git version 2.45", [git]: "v0.2.2-1-g1bcb2f8" } }));
  const warning = ahead.find((l) => /next to this repo is at v0\.2\.2-1-g1bcb2f8/.test(l.text));
  assert.equal(warning?.level, "warn");
  assert.match(warning!.text, /not the release this version pins \(v0\.2\.2\)/);
  assert.match(warning!.hint!, /checkout v0\.2\.2/);
  const exact = await checkAll(machine({ programs: { "claude --version": "2", "git --version": "git version 2.45", [git]: "v0.2.2" } }));
  assert.ok(exact.some((l) => l.level === "ok" && /the checkout next to this repo/.test(l.text)));
  assert.ok(!exact.some((l) => /not the release/.test(l.text)));
});
