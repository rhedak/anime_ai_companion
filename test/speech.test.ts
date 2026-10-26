import assert from "node:assert/strict";
import { test } from "node:test";
import { RATES, stoppedEarly, cleanRate, createVoice, describeVoices, sampleText, speechText, takeSentences } from "../public/speech.js";

test("takeSentences waits for whitespace after the punctuation", () => {
  assert.deepEqual(takeSentences("Hello there! How are"), { ready: "Hello there! ", rest: "How are" });
  assert.deepEqual(takeSentences("Hello there!"), { ready: "", rest: "Hello there!" });
  assert.deepEqual(takeSentences("Pi is 3.14 roughly. Next"), { ready: "Pi is 3.14 roughly. ", rest: "Next" });
  assert.deepEqual(takeSentences("Wow... really? Yes. ok"), { ready: "Wow... really? Yes. ", rest: "ok" });
  assert.deepEqual(takeSentences('She said "hi." Then left'), { ready: 'She said "hi." ', rest: "Then left" });
  assert.deepEqual(takeSentences(""), { ready: "", rest: "" });
});

test("takeSentences splits Japanese at 。！？ without needing a space", () => {
  assert.deepEqual(takeSentences("こんにちは。元気？"), { ready: "こんにちは。元気？", rest: "" });
  assert.deepEqual(takeSentences("こんにちは。げん"), { ready: "こんにちは。", rest: "げん" });
  assert.deepEqual(takeSentences("「やった！」と言った。つぎ"), { ready: "「やった！」と言った。", rest: "つぎ" });
});

test("speechText drops markdown, code and links", () => {
  assert.equal(speechText("Use `npm test` now"), "Use npm test now");
  assert.equal(speechText("**Bold** and _it_"), "Bold and it");
  assert.equal(speechText("See https://example.com/x?y=1 ok"), "See link ok");
  assert.equal(speechText("Great job 😸✨ really"), "Great job really");
  assert.equal(speechText("Run:\n```sh\nrm -rf /\n```\ndone"), "Run: (a code block) done");
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

test("the sample sentence is in the voice's language", () => {
  assert.match(sampleText("ja-JP"), /こんにちは/);
  assert.match(sampleText("de_DE"), /Hallo/);
  assert.equal(sampleText("xx-YY"), "Hi! This is how I sound.");
});

test("a saved voice the browser no longer has is reported once, and a failing engine is reported", () => {
  const g = globalThis as Record<string, unknown>;
  const spoken: { onerror?: (e: { error: string }) => void }[] = [];
  g.localStorage = { getItem: (k: string) => (k === "voice-uri" ? "gone" : k === "voice" ? "on" : null), setItem() {} };
  g.speechSynthesis = { speaking: true, pending: false, getVoices: () => [], speak: (u: (typeof spoken)[number]) => spoken.push(u), cancel() {} };
  g.SpeechSynthesisUtterance = class {};
  try {
    const problems: string[] = [];
    const voice = createVoice(() => {}, (m) => problems.push(m));
    voice.speak("One.");
    voice.speak("Two.");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /"gone" is not available/);
    spoken[0].onerror?.({ error: "canceled" }); // being stopped is not a problem
    spoken[0].onerror?.({ error: "synthesis-failed" });
    spoken[1].onerror?.({ error: "synthesis-failed" }); // reported once
    assert.equal(problems.length, 2);
    assert.match(problems[1], /synthesis-failed/);
  } finally {
    delete g.localStorage;
    delete g.speechSynthesis;
    delete g.SpeechSynthesisUtterance;
  }
});

test("watchVoices reports the list now and again once voices arrive without any event", async () => {
  const g = globalThis as Record<string, unknown>;
  let voices: unknown[] = [];
  g.localStorage = { getItem: () => null, setItem() {} };
  g.speechSynthesis = { speaking: false, pending: false, getVoices: () => voices, speak() {}, cancel() {} };
  g.SpeechSynthesisUtterance = class {};
  try {
    const voice = createVoice(() => {});
    let calls = 0;
    voice.watchVoices(() => calls++);
    assert.equal(calls, 1);
    voices = [{ name: "Kyoko", lang: "ja-JP", voiceURI: "k", localService: true }];
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(calls, 2);
  } finally {
    delete g.localStorage;
    delete g.speechSynthesis;
    delete g.SpeechSynthesisUtterance;
  }
});

test("speak waits a moment after cancel, and a later cancel drops what was waiting", async () => {
  const g = globalThis as Record<string, unknown>;
  const spoken: string[] = [];
  let speaking = false;
  g.localStorage = { getItem: () => null, setItem() {} };
  g.speechSynthesis = {
    get speaking() {
      return speaking;
    },
    pending: false,
    getVoices: () => [],
    speak: (u: { text: string }) => spoken.push(u.text),
    cancel() {},
  };
  g.SpeechSynthesisUtterance = class {
    text: string;
    constructor(t: string) {
      this.text = t;
    }
  };
  try {
    const voice = createVoice(() => {});
    voice.setEnabled(true);
    voice.cancel();
    voice.speak("First.");
    assert.deepEqual(spoken, [], "not at once: Chrome drops a speak() right after cancel()");
    await new Promise((r) => setTimeout(r, 250));
    assert.deepEqual(spoken, ["First."]);
    voice.cancel();
    voice.speak("Second.");
    voice.cancel(); // overtakes the one that is waiting
    await new Promise((r) => setTimeout(r, 250));
    assert.deepEqual(spoken, ["First."]);
  } finally {
    delete g.localStorage;
    delete g.speechSynthesis;
    delete g.SpeechSynthesisUtterance;
  }
});

test("a voice that ends at once is remembered as not working, and the sentence is said again without it", async () => {
  const g = globalThis as Record<string, unknown>;
  type U = { text: string; voice?: { voiceURI: string }; lang?: string; onstart?: () => void; onend?: () => void };
  const store = new Map<string, string>();
  const spoken: U[] = [];
  const voices = [{ name: "Kyoko", lang: "ja-JP", voiceURI: "Kyoko", localService: true }];
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  g.speechSynthesis = {
    speaking: true,
    pending: false,
    getVoices: () => voices,
    speak: (u: U) => {
      spoken.push(u);
      u.onstart?.();
      setTimeout(() => u.onend?.(), u.voice ? 5 : 400); // the broken voice ends at once; the default one takes a while
    },
    cancel() {},
  };
  g.SpeechSynthesisUtterance = class {
    text: string;
    constructor(t: string) {
      this.text = t;
    }
  };
  try {
    const problems: string[] = [];
    let changed = 0;
    const voice = createVoice(() => {}, (m) => problems.push(m), () => changed++);
    voice.setEnabled(true);
    voice.setVoice("Kyoko");
    voice.speak("テスト成功です！日本語もばっちり届いていますよ。");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(spoken.length, 2);
    assert.equal(spoken[0].voice?.voiceURI, "Kyoko");
    assert.equal(spoken[1].voice, undefined, "the retry leaves the voice to the browser");
    assert.equal(spoken[1].lang, "ja-JP");
    assert.equal(spoken[1].text, spoken[0].text);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Kyoko.*does not work/);
    assert.equal(changed, 1);
    assert.match(voice.voices("ja")[0].label, /did not work here/);

    voice.speak("もう一度。そして、もう一つ。"); // later sentences skip the voice that does not work
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(spoken[2].voice, undefined);

    voice.setVoice("Kyoko"); // choosing it again gives it another try
    assert.doesNotMatch(voice.voices("ja")[0].label, /did not work here/);
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    delete g.localStorage;
    delete g.speechSynthesis;
    delete g.SpeechSynthesisUtterance;
  }
});

test("stoppedEarly spots a voice that says the first word and stops, and not one that finishes", () => {
  const sample = "こんにちは! 私の声はこんな感じです。";
  assert.equal(stoppedEarly(sample, 7, 2), true); // Kyoko in Chrome: boundaries at 0 and 7, then silence
  assert.equal(stoppedEarly(sample, 16, 8), false); // a voice that got to the end
  assert.equal(stoppedEarly("Supercalifragilisticexpialidocious.", 0, 1), false); // one long word is not a truncation
  assert.equal(stoppedEarly("Hello there, this is how I sound today.", 33, 8), false);
  assert.equal(stoppedEarly(sample, 0, 0), false); // an online voice that reports no boundaries cannot be judged
  assert.equal(stoppedEarly("短い", 0, 1), false);
});
