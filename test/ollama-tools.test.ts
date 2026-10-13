import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TOOLS, describeCall, resolveInside, runTool, toArgs, toolDefinitions } from "../src/providers/ollama-tools.ts";

function project() {
  const outside = mkdtempSync(join(tmpdir(), "anaico-outside-"));
  const dir = mkdtempSync(join(tmpdir(), "anaico-project-"));
  writeFileSync(join(outside, "secret.txt"), "top secret");
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "src", "a.ts"), "const one = 1;\nconst Two = 2;\nexport { one };\n");
  writeFileSync(join(dir, "node_modules", "skipped.js"), "const one = 1;\n");
  writeFileSync(join(dir, "bin.dat"), Buffer.from([1, 2, 0, 3]));
  symlinkSync(outside, join(dir, "link"));
  return { dir, outside, done: () => [dir, outside].forEach((d) => rmSync(d, { recursive: true, force: true })) };
}

test("paths stay inside the project: dot-dot, absolute, and symlinks that lead out are all refused", async () => {
  const p = project();
  try {
    await resolveInside(p.dir, "src/a.ts");
    await resolveInside(p.dir, "src/new/deeper/file.txt"); // does not exist yet: its parents are checked
    for (const bad of ["../x", `${p.outside}/secret.txt`, "link/secret.txt", "link/new.txt", "src/../../x", "", "a\0b"]) {
      await assert.rejects(resolveInside(p.dir, bad), Error, bad);
    }
    await assert.rejects(resolveInside(p.dir, 5 as any));
  } finally {
    p.done();
  }
});

test("read_file reads text, starts at a line, and refuses binary, missing, big and outside files", async () => {
  const p = project();
  try {
    const whole = await runTool("read_file", { path: "src/a.ts" }, { cwd: p.dir });
    assert.equal(whole.ok, true);
    assert.match(whole.output, /const one = 1;/);
    const later = await runTool("read_file", { path: "src/a.ts", start_line: 3 }, { cwd: p.dir });
    assert.equal(later.output.trim(), "export { one };");
    assert.match((await runTool("read_file", { path: "bin.dat" }, { cwd: p.dir })).output, /binary/);
    assert.match((await runTool("read_file", { path: "nope.txt" }, { cwd: p.dir })).output, /no file/);
    const escape = await runTool("read_file", { path: "link/secret.txt" }, { cwd: p.dir });
    assert.equal(escape.ok, false);
    assert.doesNotMatch(escape.output, /top secret/);
    writeFileSync(join(p.dir, "long.txt"), "x".repeat(30_000));
    assert.match((await runTool("read_file", { path: "long.txt" }, { cwd: p.dir })).output, /cut off/);
  } finally {
    p.done();
  }
});

test("grep finds matches with file and line, skips node_modules and binaries, and says when nothing matched", async () => {
  const p = project();
  try {
    const hit = await runTool("grep", { pattern: "const \\w+ = \\d" }, { cwd: p.dir });
    assert.equal(hit.output, "src/a.ts:1:const one = 1;\nsrc/a.ts:2:const Two = 2;");
    assert.equal((await runTool("grep", { pattern: "two", ignore_case: true, path: "src" }, { cwd: p.dir })).output, "src/a.ts:2:const Two = 2;");
    assert.equal((await runTool("grep", { pattern: "zzz" }, { cwd: p.dir })).output, "No matches.");
    assert.match((await runTool("grep", { pattern: "(" }, { cwd: p.dir })).output, /not a valid regular expression/);
    assert.equal((await runTool("grep", { pattern: "secret", path: "link" }, { cwd: p.dir })).ok, false, "a link out of the project is not searched");
  } finally {
    p.done();
  }
});

test("write_file writes inside the project, makes folders, and refuses outside, .git and oversized content", async () => {
  const p = project();
  try {
    const made = await runTool("write_file", { path: "notes/new.txt", content: "hello" }, { cwd: p.dir });
    assert.equal(made.ok, true);
    assert.equal(readFileSync(join(p.dir, "notes/new.txt"), "utf8"), "hello");
    for (const path of ["link/hacked.txt", "../hacked.txt", ".git/config"]) {
      const result = await runTool("write_file", { path, content: "x" }, { cwd: p.dir });
      assert.equal(result.ok, false, path);
    }
    assert.equal(existsSync(join(p.outside, "hacked.txt")), false);
    assert.match((await runTool("write_file", { path: "big.txt", content: "x".repeat(300_000) }, { cwd: p.dir })).output, /too big/);
    assert.equal((await runTool("write_file", { path: "n.txt", content: 5 as any }, { cwd: p.dir })).ok, false);
  } finally {
    p.done();
  }
});

test("bash runs in the project folder and reports failures and silence", async () => {
  const p = project();
  try {
    const ok = await runTool("bash", { command: "pwd && echo hi" }, { cwd: p.dir });
    assert.equal(ok.ok, true);
    assert.match(ok.output, /hi/);
    const failed = await runTool("bash", { command: "echo oops; exit 3" }, { cwd: p.dir });
    assert.equal(failed.ok, false);
    assert.match(failed.output, /oops[^]*exit code 3/);
    assert.equal((await runTool("bash", { command: "true" }, { cwd: p.dir })).output, "(no output)");
    assert.equal((await runTool("bash", { command: "" }, { cwd: p.dir })).ok, false);
  } finally {
    p.done();
  }
});

test("unknown tools and odd arguments come back as readable text, never as an exception", async () => {
  const result = await runTool("rm_rf", {}, { cwd: tmpdir() });
  assert.equal(result.ok, false);
  assert.match(result.output, /read_file, grep, bash, write_file/);
  assert.deepEqual(toArgs('{"a":1}'), { a: 1 });
  assert.deepEqual(toArgs("not json"), {});
  assert.deepEqual(toArgs(null), {});
  assert.deepEqual(toArgs([1]), {});
});

test("plan mode offers only the read-only tools, and the card names calls the way Claude Code does", () => {
  assert.deepEqual(toolDefinitions(true).map((t) => t.function.name), ["read_file", "grep"]);
  assert.deepEqual(toolDefinitions(false).map((t) => t.function.name), TOOLS.map((t) => t.name));
  assert.deepEqual(describeCall("bash", { command: "npm   test\n" }), { tool: "Bash", summary: "npm test", input: { command: "npm   test\n" } });
  assert.equal(describeCall("write_file", { path: "a.txt", content: "x" }).tool, "Write");
  assert.equal(describeCall("grep", { pattern: "x", path: "src" }).summary, "x in src");
});
