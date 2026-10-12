/**
 * Problems in the page, made visible. A script error used to show up only in a browser console that nobody
 * has open (least of all on a phone), and the page would carry on half dead. Every one that reaches here is
 * shown in the chat as a line she cannot hide (tap it for the details), counted when it repeats, and sent to
 * the server, which writes it to its own log, so it can be read from the computer too.
 */
const MAX_DISTINCT = 12; // different problems shown; the rest are only counted
const SHOW_EVERY_MS = 1000; // a problem that repeats updates its line at most this often
const REPEATS_SENT = new Set([1, 10, 100, 1000]); // occurrences worth telling the server about

/** `avatar.js:91` from the first frame of a stack, in either browser's format, or "". */
export function whereFrom(stack) {
  const m = /([\w.-]+\.(?:js|mjs|ts)):(\d+)(?::\d+)?/.exec(String(stack ?? ""));
  return m ? `${m[1]}:${m[2]}` : "";
}

/**
 * @param show   `(info, handle) => handle`: show or update a problem's line. `info` has `line`, `where`,
 *               `details` and `count`; the handle it returns comes back the next time for that problem.
 * @param send   `(report) => void`: tell the server.
 */
export function createErrorReporter({ show, send, now = () => Date.now(), later = setTimeout }) {
  const seen = new Map();
  return {
    report(source, error) {
      const message = String(error?.message ?? error ?? "unknown error").slice(0, 300);
      const stack = String(error?.stack ?? "").slice(0, 1500);
      const where = whereFrom(stack);
      const key = `${source}|${message}|${where}`;
      let entry = seen.get(key);
      if (!entry) {
        if (seen.size >= MAX_DISTINCT) return;
        entry = { count: 0, handle: null, shownAt: -Infinity };
        seen.set(key, entry);
      }
      entry.count++;
      const draw = () => {
        entry.shownAt = now();
        entry.handle = show({ line: `${source}: ${message}`, where, details: stack, count: entry.count }, entry.handle);
      };
      if (entry.count <= 3 || now() - entry.shownAt >= SHOW_EVERY_MS) draw();
      else if (!entry.waiting) {
        // not redrawn for every repeat, but the line must end up with the last count
        entry.waiting = true;
        later(() => {
          entry.waiting = false;
          draw();
        }, SHOW_EVERY_MS);
      }
      if (REPEATS_SENT.has(entry.count)) send({ source, message, where, stack, count: entry.count });
    },
    get distinct() {
      return seen.size;
    },
  };
}

/** Send the page's own uncaught errors and unhandled promise rejections to `reporter`. */
export function installErrorReporting(target, reporter) {
  target.addEventListener("error", (e) => reporter.report("page", e.error ?? e.message));
  target.addEventListener("unhandledrejection", (e) => reporter.report("promise", e.reason));
}
