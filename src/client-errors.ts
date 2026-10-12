/**
 * Problems the page reports about itself (`public/errors.js`), written to the server's own log so they can be
 * read from the computer even when they happened on a phone. The page is not trusted: everything is cut to a
 * length, made one line, and the number per minute is capped, so a broken page cannot flood the log.
 */
export const MAX_PER_MINUTE = 30;

const oneLine = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ⏎ ").trim().slice(0, max) : "";

/** The log line for a `client-error` message, or null if it says nothing. */
export function formatClientError(msg: Record<string, unknown>, from: "this computer" | "a phone"): string | null {
  const message = oneLine(msg.message, 300);
  if (!message) return null;
  const source = oneLine(msg.source, 20) || "page";
  const where = oneLine(msg.where, 60);
  const count = Number.isFinite(msg.count) && Number(msg.count) > 1 ? ` (x${Math.min(Number(msg.count), 99999)})` : "";
  const stack = oneLine(msg.stack, 1500);
  return `[page on ${from}] ${source}: ${message}${where ? ` at ${where}` : ""}${count}${stack ? `\n  ${stack}` : ""}`;
}

/** Allows `limit` calls in any minute. */
export function perMinute(limit = MAX_PER_MINUTE, now: () => number = Date.now): () => boolean {
  const times: number[] = [];
  return () => {
    const t = now();
    while (times.length && t - times[0] >= 60_000) times.shift();
    if (times.length >= limit) return false;
    times.push(t);
    return true;
  };
}
