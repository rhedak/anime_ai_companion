import assert from "node:assert/strict";
import { test } from "node:test";
import { formatClientError, perMinute } from "../src/client-errors.ts";
import { createErrorReporter, installErrorReporting, whereFrom } from "../public/errors.js";

function harness() {
  let clock = 0;
  const waiting: (() => void)[] = [];
  const shown: { line: string; count: number; details: string; where: string }[] = [];
  const sent: { count: number; message: string }[] = [];
  const reporter = createErrorReporter<{ id: number }>({
    now: () => clock,
    later: (fn) => void waiting.push(fn),
    show: (info, handle) => {
      shown.push(info);
      return handle ?? { id: shown.length };
    },
    send: (report) => void sent.push(report),
  });
  return { reporter, shown, sent, waiting, tick: (ms: number) => void (clock += ms) };
}

const failure = (message: string) => {
  const error = new Error(message);
  error.stack = `TypeError: ${message}\n    at showSvg (http://127.0.0.1:3737/avatar.js:56:24)\n    at tick (http://127.0.0.1:3737/avatar.js:91:25)`;
  return error;
};

test("an error is shown with where it happened, and the server is told", () => {
  const { reporter, shown, sent } = harness();
  reporter.report("avatar", failure("Cannot read properties of undefined"));
  assert.equal(shown.length, 1);
  assert.equal(shown[0].line, "avatar: Cannot read properties of undefined");
  assert.equal(shown[0].where, "avatar.js:56");
  assert.match(shown[0].details, /at tick/);
  assert.equal(sent.length, 1);
});

test("the same error repeating is one line that counts, not a flood", () => {
  const { reporter, shown, sent, tick } = harness();
  for (let i = 0; i < 600; i++) {
    reporter.report("avatar", failure("boom")); // sixty a second, for ten seconds
    tick(16);
  }
  assert.equal(reporter.distinct, 1);
  assert.ok(shown.length < 30, `the line was redrawn ${shown.length} times`);
  assert.ok((shown.at(-1)?.count ?? 0) > 500);
  assert.deepEqual(sent.map((r) => r.count), [1, 10, 100]); // told about it now and then, not every time
});

test("a burst that has stopped leaves its line showing the last count", () => {
  const { reporter, shown, waiting, tick } = harness();
  for (let i = 0; i < 50; i++) {
    reporter.report("page", failure("again"));
    tick(5);
  }
  const before = shown.at(-1)?.count ?? 0;
  assert.ok(before < 50, "the burst was not drawn every time");
  assert.equal(waiting.length, 1, "one catch-up is queued, not one per repeat");
  tick(1000);
  waiting.shift()?.();
  assert.equal(shown.at(-1)?.count, 50);
});

test("a different error is its own line, and there is a limit to how many", () => {
  const { reporter, shown } = harness();
  reporter.report("page", new Error("a"));
  reporter.report("page", new Error("b"));
  assert.equal(reporter.distinct, 2);
  for (let i = 0; i < 40; i++) reporter.report("page", new Error(`other ${i}`));
  assert.equal(reporter.distinct, 12);
  assert.ok(shown.length <= 12);
});

test("things that are not Errors are reported too", () => {
  const { reporter, shown } = harness();
  reporter.report("promise", "just a string");
  reporter.report("promise", undefined);
  assert.equal(shown[0].line, "promise: just a string");
  assert.equal(shown[1].line, "promise: unknown error");
});

test("the page's own uncaught errors and rejections are picked up", () => {
  const { reporter, shown } = harness();
  const listeners: Record<string, (e: unknown) => void> = {};
  installErrorReporting({ addEventListener: (type, fn) => void (listeners[type] = fn) }, reporter);
  listeners.error({ error: failure("thrown"), message: "thrown" });
  listeners.error({ message: "a script error with no object" });
  listeners.unhandledrejection({ reason: new Error("rejected") });
  assert.deepEqual(shown.map((s) => s.line), ["page: thrown", "page: a script error with no object", "promise: rejected"]);
});

test("whereFrom reads Chrome's and Firefox's stacks", () => {
  assert.equal(whereFrom("Error: x\n    at f (http://h/avatar.js:91:25)"), "avatar.js:91");
  assert.equal(whereFrom("f@http://h/app.js:7:3\ng@http://h/app.js:9:1"), "app.js:7");
  assert.equal(whereFrom(""), "");
  assert.equal(whereFrom(undefined), "");
});

test("the server writes one tidy line per report, cut to size, and says where it came from", () => {
  const line = formatClientError({ source: "avatar", message: "boom", where: "avatar.js:91", count: 10, stack: "a\nb\n" + "x".repeat(5000) }, "a phone");
  assert.ok(line);
  assert.match(line, /^\[page on a phone\] avatar: boom at avatar\.js:91 \(x10\)\n  a ⏎ b ⏎ x+$/);
  assert.ok(line.length < 1700);
  assert.equal(formatClientError({ message: "" }, "this computer"), null);
  assert.equal(formatClientError({ message: 5 }, "this computer"), null);
  // nothing in it can start a second log line
  const sneaky = formatClientError({ message: "ok\n[page on this computer] fake", source: "x\ny" }, "a phone");
  assert.ok(sneaky && !sneaky.includes("\n  ") && sneaky.split("\n").length === 1);
});

test("the server logs at most thirty a minute", () => {
  let now = 0;
  const allowed = perMinute(30, () => now);
  assert.equal(Array.from({ length: 50 }, () => allowed()).filter(Boolean).length, 30);
  now = 61_000;
  assert.equal(allowed(), true);
});
