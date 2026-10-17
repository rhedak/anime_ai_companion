import { winSkip } from "./helpers/platform.ts";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { ClaudeCodeProvider } from "../src/providers/claude-code.ts";
import type { SessionConfig } from "../src/providers/types.ts";
import { countSkills, reachedForUnloadedSkill, skillsNotice } from "../src/skills.ts";

test("countSkills counts folders that hold a SKILL.md, and tolerates a missing folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "anaico-skills-"));
  try {
    for (const name of ["a", "b"]) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, "SKILL.md"), "---\nname: x\n---\n");
    }
    mkdirSync(join(dir, "empty"));
    writeFileSync(join(dir, "loose.md"), "not a skill");
    assert.equal(await countSkills(dir), 2);
    assert.equal(await countSkills(join(dir, "nope")), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the notice names what stays off and what turns on what", () => {
  assert.equal(skillsNotice({ project: 0, user: 0 }, { skills: false, setup: false }), null);
  assert.equal(skillsNotice({ project: 2, user: 3 }, { skills: false, setup: true }), null, "the whole setup already loads them");
  const project = skillsNotice({ project: 1, user: 0 }, { skills: false, setup: false })!;
  assert.match(project, /1 skill of its own/);
  assert.match(project, /\/setup on/);
  const user = skillsNotice({ project: 0, user: 2 }, { skills: false, setup: false })!;
  assert.match(user, /2 skills in ~\/\.claude\/skills/);
  assert.match(user, /\/skills on/);
  assert.equal(skillsNotice({ project: 0, user: 2 }, { skills: true, setup: false }), null, "already on");
});

test("reaching for a skill: a failed Skill call, or reading one of the user's SKILL.md files", () => {
  const dir = `${sep}home${sep}me${sep}.claude${sep}skills`;
  const tool = (name: string, summary: string, status: string) => ({ name, summary, status });
  assert.equal(reachedForUnloadedSkill(tool("Skill", "pinecone", "error"), dir), true);
  assert.equal(reachedForUnloadedSkill(tool("Skill", "pinecone", "done"), dir), false);
  assert.equal(reachedForUnloadedSkill(tool("Read", `${dir}${sep}pinecone${sep}SKILL.md`, "running"), dir), true);
  assert.equal(reachedForUnloadedSkill(tool("Read", `${dir}${sep}pinecone${sep}SKILL.md`, "done"), dir), false, "once, when it starts");
  assert.equal(reachedForUnloadedSkill(tool("Read", `${sep}proj${sep}.claude${sep}skills${sep}x${sep}SKILL.md`, "running"), dir), false, "a folder's skill is not fixed by this");
  assert.equal(reachedForUnloadedSkill(tool("Read", `${dir}${sep}pinecone${sep}notes.md`, "running"), dir), false);
});

/** Starts the provider against a stand-in `claude` that only writes down how it was started. */
function argvOf(config: Partial<SessionConfig>): string[] {
  const dir = mkdtempSync(join(tmpdir(), "anaico-argv-"));
  const log = join(dir, "argv.json");
  const script = join(dir, "claude");
  writeFileSync(script, `#!${process.execPath}\nrequire("fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\nsetInterval(() => {}, 1000);\n`);
  chmodSync(script, 0o755);
  const saved = process.env.PATH;
  process.env.PATH = dir; // only the stand-in: a real claude cannot start here
  const claude = new ClaudeCodeProvider({
    config: { mode: "work", cwd: dir, model: "haiku", allowedTools: [], permissionMode: "manual", claudeSetup: false, claudeSkills: false, effort: null, ...config },
    chatCwd: dir,
    persona: () => "persona",
  });
  try {
    claude.send("hi", () => {});
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      try {
        return JSON.parse(readFileSync(log, "utf8"));
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    throw new Error("the stand-in claude never started");
  } finally {
    claude.close();
    process.env.PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

const sources = (args: string[]) => args[args.indexOf("--setting-sources") + 1];

test("skills on: the user's settings source loads, with hooks switched off, and the project's does not", { skip: winSkip }, () => {
  const args = argvOf({ claudeSkills: true });
  assert.equal(sources(args), "user");
  assert.equal(args[args.indexOf("--settings") + 1], '{"disableAllHooks":true}');
  assert.ok(args.includes("--strict-mcp-config"));
});

test("skills off, or chat mode, or the whole setup: nothing new is loaded", { skip: winSkip }, () => {
  assert.equal(sources(argvOf({})), "");
  assert.ok(!argvOf({}).includes("--settings"));
  assert.equal(sources(argvOf({ mode: "chat", claudeSkills: true })), "");
  const setup = argvOf({ claudeSetup: true, claudeSkills: true });
  assert.ok(!setup.includes("--setting-sources"), "the whole setup keeps its own behaviour");
  assert.ok(!setup.includes("--settings"));
});
