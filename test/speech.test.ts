import assert from "node:assert/strict";
import { test } from "node:test";
import { RATES, cleanRate, createVoice, describeVoices, speechText, takeSentences } from "../public/speech.js";

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

test("describeVoices puts the page language first and marks online voices", () => {
  const voices = [
    { name: "Anna", lang: "de-DE", voiceURI: "anna", localService: true },
    { name: "Zoe", lang: "en-GB", voiceURI: "zoe", localService: true },
    { name: "Google US English", lang: "en-US", voiceURI: "g", localService: false },
  ];
  const list = describeVoices(voices, "en-US");
  assert.deepEqual(list.map((v) => v.uri), ["g", "zoe", "anna"]);
  assert.equal(list[0].label, "Google US English (en-US) · online");
  assert.equal(list[0].local, false);
  assert.equal(list[1].label, "Zoe (en-GB)");
  assert.equal(list[1].local, true);
});

test("cleanRate keeps sane speeds and falls back otherwise", () => {
  assert.equal(cleanRate("1.2"), 1.2);
  assert.equal(cleanRate(null), 1.05);
  assert.equal(cleanRate("fast"), 1.05);
  assert.equal(cleanRate(9), 1.05);
  assert.ok(RATES.every((r) => cleanRate(r) === r));
});

test("the chosen voice and speed reach the utterance and survive a reload", () => {
  const store = new Map<string, string>();
  const spoken: { text: string; rate: number; voice?: { voiceURI: string }; lang?: string }[] = [];
  const g = globalThis as Record<string, unknown>;
  const voices = [{ name: "Zoe", lang: "en-GB", voiceURI: "zoe", localService: true }];
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  g.speechSynthesis = {
    speaking: true,
    pending: false,
    getVoices: () => voices,
    speak: (u: { text: string; rate: number; voice?: { voiceURI: string }; lang?: string }) => spoken.push(u),
    cancel() {},
  };
  g.SpeechSynthesisUtterance = class {
    text: string;
    rate = 1;
    constructor(text: string) {
      this.text = text;
    }
  };
  try {
    const voice = createVoice(() => {});
    voice.setEnabled(true);
    voice.setVoice("zoe");
    voice.setRate(1.4);
    voice.speak("Hello there.");
    assert.equal(spoken[0].rate, 1.4);
    assert.equal(spoken[0].voice?.voiceURI, "zoe");
    assert.equal(spoken[0].lang, "en-GB");
    assert.deepEqual(voice.voices("en").map((v) => v.uri), ["zoe"]);

    const again = createVoice(() => {});
    assert.equal(again.voiceURI, "zoe");
    assert.equal(again.rate, 1.4);

    again.setVoice("gone"); // a voice the browser no longer has: the default is used
    again.setEnabled(true);
    again.speak("Still works.");
    assert.equal(spoken[1].voice, undefined);
  } finally {
    delete g.localStorage;
    delete g.speechSynthesis;
    delete g.SpeechSynthesisUtterance;
  }
});
