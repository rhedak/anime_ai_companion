import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPersonaService } from "../src/persona-service.ts";
import type { PersonaChoice } from "../src/persona.ts";

function make(options: { mode?: "chat" | "work" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "persona-service-"));
  const file = join(dir, "persona.md");
  const sent: any[] = [];
  const said: string[] = [];
  const notes: string[] = [];
  const opened: string[] = [];
  const state = { mode: options.mode ?? "chat" };
  const choice: PersonaChoice = { tier: "default", text: "Who she is by default.\n\nExpression protocol (important):\n- tags" };
  const service = createPersonaService({
    file,
    mode: () => state.mode,
    broadcast: (m) => void sent.push(m),
    openFile: (p) => void opened.push(p),
    remoteRefusal: () => "only on the computer",
    pushNote: (t) => void notes.push(t),
    current: () => ({ choice, characterName: "" }),
  });
  const say = (t: string) => void said.push(t);
  const propose = (text = "You are a calm night-shift librarian who whispers.") => {
    service.makeApplier()(`Sure. [persona ${text}] Do you like it?`);
    return sent.filter((m) => m.type === "persona-offer").at(-1);
  };
  return { service, file, sent, said, notes, opened, state, say, propose, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a phone cannot say yes: the proposal stays waiting and nothing is written; the computer can", () => {
  const t = make();
  try {
    const offer = t.propose();
    t.service.answer(offer.id, "keep", t.say, true);
    assert.deepEqual(t.said, ["only on the computer"]);
    assert.equal(existsSync(t.file), false);
    assert.equal(t.service.pending().length, 1, "still waiting");
    t.service.answer(offer.id, "keep", t.say, false);
    assert.equal(readFileSync(t.file, "utf8"), "You are a calm night-shift librarian who whispers.\n");
    assert.equal(t.service.pending().length, 0);
    assert.match(t.notes.at(-1)!, /kept your new persona[^]*night-shift librarian/);
  } finally {
    t.done();
  }
});

test("a phone may say no, but not reset or edit; only one proposal waits at a time, a declined one is not offered again, and an old file is kept as .bak", () => {
  const t = make();
  try {
    const first = t.propose();
    assert.equal(t.propose("A second proposal that is long enough to count.")?.id, first.id, "nothing new while one waits");
    t.service.answer(first.id, "skip", t.say, true);
    assert.equal(t.service.pending().length, 0);
    assert.equal(t.propose()?.id, first.id, "the same text again is not offered (the last offer is still the first)");
    assert.equal(t.sent.filter((m) => m.type === "persona-offer").length, 1);
    writeFileSync(t.file, "OLD\n");
    t.service.command("reset", t.say, true);
    t.service.command("edit", t.say, true);
    assert.deepEqual(t.said, ["only on the computer", "only on the computer"]);
    assert.equal(readFileSync(t.file, "utf8"), "OLD\n");
    const next = t.propose("A different proposal, long enough to count too.");
    t.service.answer(next.id, "keep", t.say, false);
    assert.equal(readFileSync(`${t.file}.bak`, "utf8"), "OLD\n");
  } finally {
    t.done();
  }
});

test("in work mode no card is made, and the how-to is told once per conversation in chat mode", () => {
  const t = make({ mode: "work" });
  try {
    t.service.makeApplier()("[persona A new personality that is long enough to count.]");
    assert.equal(t.sent.some((m) => m.type === "persona-offer"), false);
    assert.match(t.sent.at(-1).text, /chat mode only/);
    assert.equal(t.service.note(), null, "nothing is said about the tag in work mode");
    t.state.mode = "chat";
    assert.match(t.service.note()!, /\[persona <the complete new description/);
    assert.equal(t.service.note(), null, "once");
    t.service.forgetTold();
    assert.match(t.service.note()!, /\[persona <the complete new description/, "a new conversation is told again");
  } finally {
    t.done();
  }
});

test("/persona edit starts a file from the voice part she uses now (never the protocol) and opens it", () => {
  const t = make();
  try {
    t.service.command("edit", t.say, false);
    assert.equal(readFileSync(t.file, "utf8"), "Who she is by default.\n");
    assert.deepEqual(t.opened, [t.file]);
  } finally {
    t.done();
  }
});
