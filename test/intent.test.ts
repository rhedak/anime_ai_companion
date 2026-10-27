import assert from "node:assert/strict";
import { test } from "node:test";
import { lookRequest, refuses, wantedActivity, wantsActivityEnd } from "../src/intent.ts";

const PRESETS = ["risa", "franzi", "linnea"];
const KNOWN = ["tennis", "swimming", "dancing", "cooking", "reading"];

test("a clear invitation or order names the activity it asks for", () => {
  for (const [text, name] of [
    ["let's play tennis", "tennis"],
    ["Let's go swimming!", "swimming"],
    ["can we dance together?", "dancing"],
    ["ok, can we do some cooking", "cooking"],
    ["play tennis with me", "tennis"],
    ["go swim", "swimming"],
    ["dance for me", "dancing"],
    ["Hey, please start dancing", "dancing"],
    ["how about reading a bit", "reading"],
    ["I want to go swimming", "swimming"],
  ] as const) assert.equal(wantedActivity(text, [...KNOWN]), name, text);
});

test("talk about an activity, the past, a question or a refusal is not a request", () => {
  for (const text of [
    "I played tennis yesterday",
    "swimming is fun",
    "do you like dancing?",
    "what is the best cooking oil",
    "I don't want to go swimming",
    "no more tennis, stop",
    "tennis",
    "I went swimming last week and it was cold",
    "/frames risa-tennis",
    "can you tell me about reading habits",
  ]) assert.equal(wantedActivity(text, [...KNOWN]), null, text);
  assert.equal(wantedActivity("let's play chess", [...KNOWN]), null, "an activity she does not have");
});

test("stop ends the activity that is on, and only while one is", () => {
  assert.equal(wantsActivityEnd("stop", "tennis"), true);
  assert.equal(wantsActivityEnd("ok, that's enough", "tennis"), true);
  assert.equal(wantsActivityEnd("let's stop swimming", "swimming"), true);
  assert.equal(wantsActivityEnd("stop", null), false);
  assert.equal(wantsActivityEnd("please stop being so loud while we play tennis and keep going", "tennis"), false);
  assert.equal(wantsActivityEnd("I can't stop smiling", "tennis"), false);
});

test("a look request the built-in reader understands gives its tags; remarks, questions and commands give none", () => {
  assert.deepEqual(lookRequest("make your hair mint green", PRESETS), [{ hair_color: "#8fe3b4" }]);
  assert.deepEqual(lookRequest("Could you put on a witch hat and glasses?", PRESETS), [{ hat_color: "#2a1a4a", glasses: "true" }]);
  assert.deepEqual(lookRequest("become Linnea", PRESETS), [{ base: "linnea" }]);
  assert.deepEqual(lookRequest("your blue eyes are lovely", PRESETS), []);
  assert.deepEqual(lookRequest("do you like pink hair?", PRESETS), []);
  assert.deepEqual(lookRequest("what colour is your hair", PRESETS), []);
  assert.deepEqual(lookRequest("/avatar hair_color=#fff", PRESETS), []);
  assert.deepEqual(lookRequest("hello there", PRESETS), []);
});

test("her own refusal is respected", () => {
  assert.equal(refuses("Sorry, I can't do that right now."), true);
  assert.equal(refuses("Not now, I'm busy."), true);
  assert.equal(refuses("Yes! Tennis sounds so fun!"), false);
});
