import assert from "node:assert/strict";
import { test } from "node:test";
import { ROOM_DEFAULTS, roomBlurb, roomNote, sceneByArg, sceneList, startPlay } from "../src/scenes.ts";

test("the spare key still starts from its name, and counts are refused", () => {
  const started = startPlay("the spare key");
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.scene.id, "key");
  assert.match(started.note, /The spare key/);
  assert.match(started.note, /\[play end\]/);
  const counted = startPlay("spare 1");
  assert.equal(counted.ok, false);
  if (counted.ok) return;
  assert.match(counted.text, /does not take counts/);
});

test("a locked room freezes an improvised plan and starts over on a trap", () => {
  const started = startPlay("room");
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.blurb, roomBlurb(ROOM_DEFAULTS));
  assert.match(started.note, /told in five scenes/);
  assert.match(started.note, /one correct choice/);
  assert.match(started.note, /three red herrings/);
  assert.match(started.note, /one trap/);
  assert.match(started.note, /short story about you and the user/);
  assert.match(started.note, /five objects/);
  assert.match(started.note, /one thread/);
  assert.match(started.note, /own sentence/);
  assert.match(started.note, /\[play plan/);
  assert.match(started.note, /that story is frozen/);
  assert.match(started.note, /starts over at step one/);
  assert.match(started.note, /asks you to choose/);
  assert.match(started.note, /explain the thread/);
  assert.match(started.note, /gives up/);
  assert.match(started.note, /\[play end\]/);
  assert.doesNotMatch(started.note, /flowerpot|newspaper|spare key/);
});

test("room counts accept a short list or names, and reject anything else", () => {
  const positional = startPlay("escape 4 1 2 1");
  const named = startPlay("the locked room steps=4 hints=1 misses=2 traps=1");
  assert.equal(positional.ok && named.ok, true);
  if (!positional.ok || !named.ok) return;
  assert.equal(positional.note, named.note);
  assert.match(positional.note, /four steps|four scenes/);
  assert.match(positional.note, /four objects/);
  assert.match(positional.note, /two red herrings/);
  assert.match(positional.blurb, /^Four steps\. Each has one hint, two red herrings and one trap/);
  assert.equal(roomNote({ steps: 4, hints: 1, herrings: 2, traps: 1 }), positional.note);

  const refused = (arg: string) => {
    const result = startPlay(arg);
    assert.equal(result.ok, false, arg);
    if (result.ok) throw new Error(arg);
    return result.text;
  };
  assert.match(refused("room 9"), /Steps must be from 1 to 8/);
  assert.match(refused("room 5 0"), /Hints must be from 1 to 3/);
  assert.match(refused("room steps=5 steps=4"), /Steps was given twice/);
  assert.match(refused("room colour=1"), /Unknown count "colour"/);
  assert.match(refused("room five"), /Give the counts/);
  assert.match(refused("dungeon"), new RegExp(sceneList().replace(/[()]/g, "\\$&")));
  assert.equal(sceneByArg("locked room 4"), sceneByArg("room"));
});
