import assert from "node:assert/strict";
import { test } from "node:test";
import { createRemoteAsks } from "../src/remote-ask.ts";

function setup(over: { online?: boolean; seconds?: number } = {}) {
  const sent: any[] = [];
  const asks = createRemoteAsks({ computerOnline: () => over.online ?? true, notify: (m) => sent.push(m), seconds: over.seconds });
  const phone = {};
  const told: string[] = [];
  return { asks, sent, phone, told, tell: (t: string) => told.push(t) };
}

test("a question becomes a card for the computer, and Allow does it once and tells the phone", async () => {
  const { asks, sent, phone, told, tell } = setup();
  let done = 0;
  assert.deepEqual(asks.ask(phone, "Chrome on Android", "turn on Accept edits", () => void done++, tell), { ok: true });
  const card = sent.find((m) => m.type === "remote-ask");
  assert.equal(card.device, "Chrome on Android");
  assert.equal(card.label, "turn on Accept edits");
  assert.equal(done, 0, "nothing happens before the yes");
  assert.ok(await asks.answer(card.id, true));
  assert.equal(done, 1);
  assert.deepEqual(told, ["Allowed on the computer: turn on Accept edits."]);
  assert.equal(await asks.answer(card.id, true), null, "an answered question is gone: it cannot be allowed twice");
  assert.equal(done, 1);
  assert.ok(sent.some((m) => m.type === "remote-ask-done" && m.id === card.id));
});

test("Deny does nothing, and the phone is told", async () => {
  const { asks, sent, phone, told, tell } = setup();
  let done = 0;
  asks.ask(phone, "Phone", "turn on Auto", () => void done++, tell);
  await asks.answer(sent[0].id, false);
  assert.equal(done, 0);
  assert.match(told[0], /said no: turn on Auto did not happen/);
});

test("with no page open on the computer there is nothing to ask, and a flood of questions is held to three", () => {
  const closed = setup({ online: false });
  const refused = closed.asks.ask(closed.phone, "Phone", "turn on Auto", () => {}, closed.tell);
  assert.equal(refused.ok, false);
  assert.match((refused as { reason: string }).reason, /open the companion on the computer/);
  assert.equal(closed.sent.length, 0);
  const { asks, tell } = setup();
  const owner = {};
  assert.equal(asks.ask(owner, "P", "one", () => {}, tell).ok, true);
  assert.equal(asks.ask(owner, "P", "one", () => {}, tell).ok, false, "the same question from the same phone is already waiting");
  assert.equal(asks.ask(owner, "P", "two", () => {}, tell).ok, true);
  assert.equal(asks.ask(owner, "P", "three", () => {}, tell).ok, true);
  assert.equal(asks.ask(owner, "P", "four", () => {}, tell).ok, false, "only three wait at once");
});

test("a question runs out, and goes with the phone that asked", async () => {
  const { asks, sent, phone, told, tell } = setup({ seconds: 0.05 });
  let done = 0;
  asks.ask(phone, "Phone", "turn on Auto", () => void done++, tell);
  await new Promise((r) => setTimeout(r, 150));
  assert.match(told[0], /did not answer in time/);
  assert.equal(asks.waiting().length, 0);
  assert.equal(await asks.answer(sent[0].id, true), null);
  assert.equal(done, 0);
  const other = setup();
  other.asks.ask(other.phone, "Phone", "turn on Auto", () => void done++, other.tell);
  other.asks.drop(other.phone);
  assert.equal(other.asks.waiting().length, 0);
  assert.ok(other.sent.some((m) => m.type === "remote-ask-done"));
});
