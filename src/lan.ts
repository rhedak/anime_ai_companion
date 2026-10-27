/**
 * Opt-in access from another device on the local network (`--lan`), e.g. a phone.
 *
 * The server can run commands, so the network is never trusted: every request that does not come from
 * this machine must carry a secret token, as a cookie the first visit to `/?t=<token>` sets. The pure
 * parts live here so they can be tested without a server.
 */
import qrcode from "qrcode-generator";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname, networkInterfaces } from "node:os";

export const cookieName = "anaico";

/** A connection from this very machine (the browser the user started it with), as opposed to the network. */
export function isLoopbackAddress(addr: string | undefined): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** The saved token, or a new one written with owner-only permissions. */
export async function loadToken(path: string): Promise<string> {
  const saved = (await readFile(path, "utf8").catch(() => "")).trim();
  if (/^[A-Za-z0-9_-]{32}$/.test(saved)) return saved;
  return saveToken(path, newToken());
}

export async function saveToken(path: string, token: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, token + "\n", { mode: 0o600 });
  await chmod(path, 0o600); // writeFile keeps the mode of a file that already existed
  return token;
}

export function tokenMatches(candidate: unknown, token: string): boolean {
  if (typeof candidate !== "string" || !token) return false; // no token set (the old shared link is off) matches nothing, not even an empty one
  const a = Buffer.from(candidate);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** The `Set-Cookie` that keeps a device signed in (the days a phone's credential lasts, renewed on use). No `Secure`: the page is plain http on the local network. */
export function sessionCookie(value: string, days = 365): string {
  return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${days * 86400}`;
}

/** Whether a cookie value is the credential of a phone that was allowed on the computer (`PhoneDevices.check`). */
export type DeviceCheck = (cookie: string | undefined) => boolean;

/**
 * Whether a `Host` header names something on the local network: an IP address, `localhost`, or a `.local`
 * (Bonjour) name. A page on another domain that was rebound to this machine's address is turned away here,
 * and again by the cookie, which only the real address ever receives.
 */
export function hostHeaderAllowed(header: string | undefined, ownName = hostname()): boolean {
  if (!header) return false;
  const name = header.replace(/:\d{1,5}$/, "").toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || /^\[[0-9a-f:.]+\]$/.test(name)) return true;
  return name === "localhost" || name.endsWith(".local") || name === ownName.toLowerCase();
}

export type Gate =
  | { action: "allow" }
  | { action: "sign-in"; location: string } // right token in the link: set the cookie, then show the page without it
  | { action: "refuse"; status: 400 | 401 | 421; text: string };

/** What to do with a request that came over the network (not from this machine). */
export function gateRequest(
  req: { url?: string; headers: { host?: string; cookie?: string } },
  token: string,
  ownName?: string,
  isDevice?: DeviceCheck,
): Gate {
  if (!hostHeaderAllowed(req.headers.host, ownName)) return { action: "refuse", status: 421, text: "Unknown host." };
  const url = new URL(req.url ?? "/", "http://localhost");
  const offered = url.searchParams.get("t");
  if (offered !== null) {
    if (!tokenMatches(offered, token)) return { action: "refuse", status: 401, text: "That link is not valid any more. Ask for /phone again on the computer." };
    url.searchParams.delete("t");
    return { action: "sign-in", location: url.pathname + url.search };
  }
  const cookie = cookieValue(req.headers.cookie, cookieName);
  if (isDevice?.(cookie) || tokenMatches(cookie, token)) return { action: "allow" };
  return { action: "refuse", status: 401, text: "Open the phone link from the companion on the computer (type /phone in its chat)." };
}

/** A WebSocket from the network is let in only with the cookie, and from a page served by this very address. */
export function socketAllowed(
  req: { headers: { host?: string; origin?: string; cookie?: string } },
  token: string,
  ownName?: string,
  isDevice?: DeviceCheck,
): boolean {
  const { host, origin, cookie } = req.headers;
  const value = cookieValue(cookie, cookieName);
  return hostHeaderAllowed(host, ownName) && origin === `http://${host}` && (Boolean(isDevice?.(value)) || tokenMatches(value, token));
}

/**
 * IPv4 addresses other devices can reach this machine on, then its Bonjour name (stable across DHCP changes,
 * but Android does not always resolve it). The Wi-Fi and Ethernet ports (`en0`...) come first: VPN tunnels
 * (`utun`) have addresses a phone on the same network cannot use, so the first link is the one to try.
 */
export function lanHosts(interfaces = networkInterfaces(), ownName = hostname()): string[] {
  const physical: string[] = [];
  const other: string[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal || i.address.startsWith("169.254.")) continue;
      (/^(en|eth|wlan|wl)\d/.test(name) ? physical : other).push(i.address);
    }
  }
  return [...physical, ...other, ownName.endsWith(".local") ? ownName : `${ownName}.local`];
}

/** The old shared link (`--lan` only, for one more release). */
export function phoneLinks(port: number, token: string, hosts = lanHosts()): string[] {
  return hosts.map((h) => `http://${h}:${port}/?t=${token}`);
}

/** The pairing link: its code works once and expires in two minutes, and the computer has to allow the phone it was opened on. */
export function pairLinks(port: number, code: string, hosts = lanHosts()): string[] {
  return hosts.map((h) => `http://${h}:${port}/pair?e=${code}`);
}

/** A QR code as rows of "1" (dark) and "0", for the page to draw; scanning it opens the link. */
export function qrRows(text: string): string[] {
  const qr = qrcode(0, "M"); // the smallest version that fits, with moderate error correction
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (qr.isDark(r, c) ? "1" : "0")).join(""));
}
