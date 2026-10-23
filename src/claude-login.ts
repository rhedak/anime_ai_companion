import { spawnCli } from "./spawn-cli.ts";

/** Words `claude` uses when its sign-in is missing or has run out. */
const AUTH_FAILURE = /failed to authenticate|oauth|not logged in|please run \/login|invalid api key|authentication[_ ]error|\b401\b|token (has )?expired/i;

export function isAuthFailure(text: string): boolean {
  return AUTH_FAILURE.test(text);
}

/** What the page shows instead of the raw message when Claude Code is not signed in. */
export function describeAuthError(text: string): string {
  if (!isAuthFailure(text)) return text;
  return (
    "Claude Code is not signed in (its login has expired or is missing). Type /claude-login here to sign in again: " +
    "it opens your browser for Anthropic's own sign-in page. Or run `claude auth login` in a terminal. " +
    `Then send your message again. (Claude said: ${text.trim().slice(0, 200)})`
  );
}

export interface AuthStatus {
  loggedIn: boolean;
  method?: string;
}

/** Reads the output of `claude auth status` (JSON); null when it is not understood. */
export function parseAuthStatus(out: string | null): AuthStatus | null {
  if (!out) return null;
  try {
    const j = JSON.parse(out);
    if (typeof j?.loggedIn !== "boolean") return null;
    return { loggedIn: j.loggedIn, method: typeof j.authMethod === "string" ? j.authMethod : undefined };
  } catch {
    return null;
  }
}

/** Asks `claude auth status`. It only looks; nothing is changed. */
export function claudeAuthStatus(program = "claude", timeoutMs = 15000): Promise<AuthStatus | null> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (v: AuthStatus | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const child = spawnCli(program, ["auth", "status"], { stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill();
      done(null);
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => done(null));
    child.on("close", () => done(parseAuthStatus(out)));
  });
}

export function firstUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? null;
}

export function describeStatus(s: AuthStatus | null): string {
  if (!s) return "Claude Code: could not tell whether you are signed in (`claude auth status` gave no answer)";
  return s.loggedIn ? `Claude Code: signed in${s.method ? ` (${s.method})` : ""}` : "Claude Code: not signed in (type /claude-login)";
}

/**
 * Runs the user's own `claude auth login`: it opens the browser itself, and the app only relays the link it prints
 * (for when no browser opened) and then asks `claude auth status`. No credential passes through here.
 */
export function runClaudeLogin(say: (text: string) => void, program = "claude", timeoutMs = 5 * 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    let seenUrl = false;
    let buf = "";
    let settled = false;
    const finish = async (note?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (note) say(note);
      const status = await claudeAuthStatus(program);
      say(describeStatus(status));
      resolve(!!status?.loggedIn);
    };
    const child = spawnCli(program, ["auth", "login"], { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill();
      void finish("The sign-in took too long and was stopped. Type /claude-login to try again.");
    }, timeoutMs);
    const onData = (d: Buffer) => {
      buf += d.toString();
      const url = !seenUrl ? firstUrl(buf) : null;
      if (url) {
        seenUrl = true;
        say(`Claude Code opened your browser to sign in. If nothing opened, open this link yourself: ${url}`);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", () => void finish("`claude` could not be started. Is Claude Code installed and on the PATH? (`/doctor` says.)"));
    child.on("close", () => void finish());
  });
}
