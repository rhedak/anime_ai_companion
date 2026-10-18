import assert from "node:assert/strict";
import { test } from "node:test";
import { createDictation, dictationProblem, dictationVendor, joinDictation } from "../public/dictation.js";

/** A stand-in for the browser's SpeechRecognition that tells the test what the page asked of it. */
function fakeEnv(options: { secure?: boolean; stored?: string | null } = {}) {
  const made: any[] = [];
  class Recognition {
    lang = "";
    interimResults = false;
    continuous = true;
    started = false;
    stopped = false;
    onresult: any;
    onerror: any;
    onend: any;
    constructor() {
      made.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.stopped = true;
      this.onend?.();
    }
  }
  const storage = new Map<string, string>();
  if (options.stored) storage.set("dictation-ok", options.stored);
  return {
    made,
    storage,
    env: { SpeechRecognition: Recognition, isSecureContext: options.secure ?? true, localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } },
  };
}
const result = (text: string, isFinal: boolean) => ({ transcript: text, isFinal });
const event = (...parts: { transcript: string; isFinal: boolean }[]) => ({ results: parts.map((p) => Object.assign([{ transcript: p.transcript }], { isFinal: p.isFinal })) });

test("it is offered only where the browser can do it, and only on a secure page", () => {
  const log = () => {};
  const base = { onText: log, onState: log, onProblem: log };
  assert.equal(createDictation({ ...base, env: fakeEnv().env as any }).supported, true);
  assert.equal(createDictation({ ...base, env: fakeEnv({ secure: false }).env as any }).supported, false, "a phone on plain http");
  assert.equal(createDictation({ ...base, env: {} as any }).supported, false, "Firefox");
  const shell = createDictation({ ...base, env: { ...fakeEnv().env, navigator: { userAgent: "Mozilla/5.0 Chrome/140 Electron/44.9.0 Safari/537.36" } } as any });
  assert.equal(shell.supported, false, "the desktop shell has no speech service");
  assert.equal(shell.needsBrowser, true, "but it shows the button and sends her to the browser");
  assert.equal(createDictation({ ...base, env: fakeEnv().env as any }).needsBrowser, false);
});

test("listening starts with the page's language and shows words as they come, final or not", () => {
  const { env, made } = fakeEnv();
  const heard: [string, boolean][] = [];
  const states: boolean[] = [];
  const dictation = createDictation({ onText: (t, f) => heard.push([t, f]), onState: (s) => states.push(s), onProblem: () => {}, language: () => "ja-JP", env: env as any });
  dictation.toggle();
  assert.equal(made[0].lang, "ja-JP");
  assert.equal(made[0].interimResults, true);
  assert.equal(made[0].continuous, false, "one phrase at a time, never an open microphone");
  assert.equal(dictation.listening, true);
  made[0].onresult(event(result("hello", false)));
  made[0].onresult(event(result("hello there", true)));
  assert.deepEqual(heard, [["hello", false], ["hello there", true]]);
  made[0].onend();
  assert.equal(dictation.listening, false);
  assert.deepEqual(states, [true, false]);
});

test("toggling while listening stops it, and a failed start is reported", () => {
  const { env, made } = fakeEnv();
  const problems: string[] = [];
  const dictation = createDictation({ onText: () => {}, onState: () => {}, onProblem: (m: string) => problems.push(m), env: env as any });
  dictation.toggle();
  dictation.toggle();
  assert.equal(made[0].stopped, true);
  assert.equal(dictation.listening, false);
  made.length = 0;
  (env.SpeechRecognition.prototype as any).start = () => {
    throw new Error("already started");
  };
  dictation.toggle();
  assert.equal(dictation.listening, false);
  assert.match(problems[0], /Could not start the microphone: already started/);
});

test("errors are explained, and the ones that need no words stay quiet", () => {
  assert.match(dictationProblem("not-allowed")!, /blocked/);
  assert.match(dictationProblem("network")!, /internet/);
  assert.equal(dictationProblem("aborted"), null);
  assert.equal(dictationProblem("something-new"), null);
  const { env, made } = fakeEnv();
  const problems: string[] = [];
  const dictation = createDictation({ onText: () => {}, onState: () => {}, onProblem: (m: string) => problems.push(m), env: env as any });
  dictation.start();
  made[0].onerror({ error: "audio-capture" });
  made[0].onerror({ error: "aborted" });
  assert.deepEqual(problems, ["No microphone was found."]);
});

test("agreement is remembered in this browser, and starts out as not given", () => {
  const fresh = fakeEnv();
  const first = createDictation({ onText: () => {}, onState: () => {}, onProblem: () => {}, env: fresh.env as any });
  assert.equal(first.consented, false);
  first.consent();
  assert.equal(first.consented, true);
  assert.equal(fresh.storage.get("dictation-ok"), "yes");
  const later = createDictation({ onText: () => {}, onState: () => {}, onProblem: () => {}, env: fakeEnv({ stored: "yes" }).env as any });
  assert.equal(later.consented, true);
});

test("what was said goes after what was typed, and the vendor named is the one that gets the audio", () => {
  assert.equal(joinDictation("", "hello"), "hello");
  assert.equal(joinDictation("Hi", " there "), "Hi there");
  assert.equal(joinDictation("Hi ", "there"), "Hi there");
  assert.equal(joinDictation("keep", "  "), "keep");
  assert.equal(dictationVendor("Mozilla/5.0 Chrome/120 Safari/537.36"), "Google");
  assert.equal(dictationVendor("Mozilla/5.0 Chrome/120 Safari/537.36 Edg/120"), "Microsoft");
  assert.equal(dictationVendor("Mozilla/5.0 Version/17 Safari/605.1.15"), "Apple");
  assert.equal(dictationVendor(""), "the browser's maker");
});
