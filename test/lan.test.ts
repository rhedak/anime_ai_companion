import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cookieValue, gateRequest, hostHeaderAllowed, isLoopbackAddress, lanHosts, loadToken, newToken, phoneLinks, saveToken, socketAllowed, tokenMatches } from "../src/lan.ts";

const token = newToken();
const cookie = `other=1; anaico=${token}`;

test("only this machine counts as loopback", () => {
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(isLoopbackAddress(a), true);
  for (const a of ["192.168.1.20", "::ffff:192.168.1.20", "10.0.0.2", undefined]) assert.equal(isLoopbackAddress(a), false);
});

test("tokens are long, unique, and compared exactly", () => {
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(token, newToken());
  assert.equal(tokenMatches(token, token), true);
  assert.equal(tokenMatches(token.slice(0, -1), token), false);
  assert.equal(tokenMatches(token + "x", token), false);
  assert.equal(tokenMatches(undefined, token), false);
  assert.equal(tokenMatches("", token), false);
});

test("the token file is created private, reused, and replaced on request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lan-"));
  try {
    const path = join(dir, "data/lan-token");
    const first = await loadToken(path);
    assert.equal(await loadToken(path), first);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const second = await saveToken(path, newToken());
    assert.notEqual(second, first);
    assert.equal(await loadToken(path), second);
    await writeFile(path, "short\n", { mode: 0o644 });
    const repaired = await loadToken(path); // a damaged file is replaced, never trusted
    assert.match(repaired, /^[A-Za-z0-9_-]{32}$/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cookies are read by exact name", () => {
  assert.equal(cookieValue("a=1; anaico=xyz; b=2", "anaico"), "xyz");
  assert.equal(cookieValue("notanaico=xyz", "anaico"), undefined);
  assert.equal(cookieValue(undefined, "anaico"), undefined);
});

test("only addresses of the local network are accepted as the Host", () => {
  for (const h of ["192.168.1.20:3737", "10.0.0.5", "localhost:3737", "henriks-macbook.local:3737", "[fe80::1]:3737"]) {
    assert.equal(hostHeaderAllowed(h, "other"), true, h);
  }
  assert.equal(hostHeaderAllowed("My-Mac", "my-mac"), true); // its own name, as set on the machine
  for (const h of ["evil.example.com", "evil.example.com:3737", "192.168.1.20.evil.com", "", undefined]) {
    assert.equal(hostHeaderAllowed(h, "my-mac"), false, String(h));
  }
});

test("a network request needs the token, and the link signs a phone in", () => {
  const host = "192.168.1.20:3737";
  assert.deepEqual(gateRequest({ url: "/", headers: { host, cookie } }, token), { action: "allow" });
  assert.equal(gateRequest({ url: "/", headers: { host } }, token).action, "refuse");
  assert.equal(gateRequest({ url: "/", headers: { host, cookie: "anaico=wrong" } }, token).action, "refuse");
  assert.deepEqual(gateRequest({ url: `/?t=${token}`, headers: { host } }, token), { action: "sign-in", location: "/" });
  // the link's own token wins over a stale cookie, and other query parameters survive
  assert.deepEqual(gateRequest({ url: `/x?a=1&t=${token}`, headers: { host, cookie: "anaico=old" } }, token), { action: "sign-in", location: "/x?a=1" });
  const wrong = gateRequest({ url: "/?t=nope", headers: { host, cookie } }, token);
  assert.equal(wrong.action, "refuse");
  assert.equal(wrong.action === "refuse" && wrong.status, 401);
  const rebound = gateRequest({ url: `/?t=${token}`, headers: { host: "evil.example.com", cookie } }, token);
  assert.equal(rebound.action === "refuse" && rebound.status, 421);
});

test("a network WebSocket needs the cookie and a page from the same address", () => {
  const host = "192.168.1.20:3737";
  const ok = { host, origin: `http://${host}`, cookie };
  assert.equal(socketAllowed({ headers: ok }, token), true);
  assert.equal(socketAllowed({ headers: { ...ok, cookie: undefined } }, token), false);
  assert.equal(socketAllowed({ headers: { ...ok, cookie: "anaico=wrong" } }, token), false);
  assert.equal(socketAllowed({ headers: { ...ok, origin: "http://evil.example.com" } }, token), false);
  assert.equal(socketAllowed({ headers: { ...ok, origin: undefined } }, token), false);
  assert.equal(socketAllowed({ headers: { ...ok, host: "evil.example.com", origin: "http://evil.example.com" } }, token), false);
});

test("the phone links name this machine by its Bonjour name and by address", () => {
  const hosts = lanHosts(
    {
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true } as never],
      en0: [
        { address: "192.168.1.20", family: "IPv4", internal: false } as never,
        { address: "fe80::1", family: "IPv6", internal: false } as never,
        { address: "169.254.3.4", family: "IPv4", internal: false } as never,
      ],
    },
    "henriks-macbook",
  );
  assert.deepEqual(hosts, ["henriks-macbook.local", "192.168.1.20"]);
  assert.deepEqual(phoneLinks(3737, "T", hosts), ["http://henriks-macbook.local:3737/?t=T", "http://192.168.1.20:3737/?t=T"]);
});
