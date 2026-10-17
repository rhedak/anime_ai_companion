import assert from "node:assert/strict";
import { test } from "node:test";
import { ScriptedProvider } from "../src/providers/scripted.ts";
import type { ProviderEvent } from "../src/providers/types.ts";

const make = () => new ScriptedProvider({ presets: () => ["risa", "linnea"], pack: () => false });

function turn(provider: ScriptedProvider, text: string): Promise<string> {
  return new Promise((resolve) => {
    let said = "";
    provider.send(text, (event: ProviderEvent) => {
      if (event.type === "delta") said += event.text;
      if (event.type === "done") resolve(said);
    });
  });
}

test("it answers from the script with the tags a model would write, and says it is not a model when asked to chat", async () => {
  const provider = make();
  assert.equal(provider.canUseTools, false);
  assert.equal(provider.busy, false);
  assert.match(await turn(provider, "blue eyes please"), /^\[emotion:happy\] Okay! Blue eyes\. \[avatar eye_color=#[0-9a-f]{6}\]/);
  const chat = await turn(provider, "tell me a joke");
  assert.match(chat, /no language model connected/);
  assert.match(chat, /opencode/);
  assert.equal(provider.busy, false);
});

test("the note the server puts in front of a message is not read as part of it", async () => {
  const said = await turn(make(), "(system note, not from the user: you opened this conversation by saying: \"hi\")\n\nbecome linnea");
  assert.match(said, /Okay! Linnea's look\. \[avatar base=linnea\]/);
});

test('"that colour" can mean the one she named a moment ago', async () => {
  const provider = make();
  await turn(provider, "make your hair mint green");
  assert.match(await turn(provider, "and the eyes in that colour"), /\[avatar eye_color=#/);
});

test("stopping ends the turn with what was said so far, and the next message works", async () => {
  const provider = make();
  let events: ProviderEvent[] = [];
  const ended = new Promise<void>((resolve) =>
    provider.send("what can you do", (e) => {
      events.push(e);
      if (e.type === "done") resolve();
    }),
  );
  assert.equal(provider.busy, true);
  assert.equal(provider.interrupt(), true);
  await ended;
  assert.equal(events.at(-1)?.type, "done");
  assert.equal(provider.busy, false);
  assert.equal(provider.interrupt(), false);
  assert.match(await turn(provider, "wave"), /\[gesture:wave\]/);
});
