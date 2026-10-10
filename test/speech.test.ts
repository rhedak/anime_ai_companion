import assert from "node:assert/strict";
import { test } from "node:test";
import { speechText, takeSentences } from "../public/speech.js";

test("takeSentences waits for whitespace after the punctuation", () => {
  assert.deepEqual(takeSentences("Hello there! How are"), { ready: "Hello there! ", rest: "How are" });
  assert.deepEqual(takeSentences("Hello there!"), { ready: "", rest: "Hello there!" });
  assert.deepEqual(takeSentences("Pi is 3.14 roughly. Next"), { ready: "Pi is 3.14 roughly. ", rest: "Next" });
  assert.deepEqual(takeSentences("Wow... really? Yes. ok"), { ready: "Wow... really? Yes. ", rest: "ok" });
  assert.deepEqual(takeSentences('She said "hi." Then left'), { ready: 'She said "hi." ', rest: "Then left" });
  assert.deepEqual(takeSentences(""), { ready: "", rest: "" });
});

test("speechText drops markdown, code and links", () => {
  assert.equal(speechText("Use `npm test` now"), "Use npm test now");
  assert.equal(speechText("**Bold** and _it_"), "Bold and it");
  assert.equal(speechText("See https://example.com/x?y=1 ok"), "See link ok");
  assert.equal(speechText("Great job 😸✨ really"), "Great job really");
  assert.equal(speechText("Run:\n```sh\nrm -rf /\n```\ndone"), "Run: (code) done");
});
