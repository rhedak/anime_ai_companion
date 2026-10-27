import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEVICE_DAYS, PhoneDevices, deviceName, describeDevice } from "../src/phone-devices.ts";
import { CODE_SECONDS, Pairing } from "../src/phone-pairing.ts";

const DAY = 86_400_000;

async function inFolder(run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "phones-"));
  try {
    await run(join(dir, "data/phone-devices.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a phone's credential works, only its hash is kept, and the file is private", async () => {
  await inFolder(async (path) => {
    const devices = new PhoneDevices(path);
    const { device, credential } = await devices.add("Chrome on Android");
    assert.match(credential, /^[A-Za-z0-9_-]{43}$/);
    const text = await readFile(path, "utf8");
    assert.ok(!text.includes(credential), "the credential itself is not in the file");
    assert.ok(text.includes(device.hash));
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(devices.check(credential)?.id, device.id);
    assert.equal(devices.check(credential + "x"), null);
    assert.equal(devices.check(undefined), null);
    assert.equal(devices.check(""), null);
    // a new run reads it back
    const again = new PhoneDevices(path);
    await again.load();
    assert.equal(again.check(credential)?.name, "Chrome on Android");
    await again.flush();
  });
});

test("a device is good for 90 days from its last use, and an unused one expires by itself", async () => {
  await inFolder(async (path) => {
    let now = 1_000_000_000_000;
    const devices = new PhoneDevices(path, () => now);
    const { credential } = await devices.add("Phone");
    now += 80 * DAY;
    assert.ok(devices.check(credential), "day 80: still good, and the 90 days start again");
    now += 80 * DAY; // 160 days after pairing, 80 after the last use
    assert.ok(devices.check(credential), "renewed by use");
    now += (DEVICE_DAYS + 1) * DAY;
    assert.equal(devices.check(credential), null, "unused for more than 90 days");
    assert.deepEqual(devices.list(), []);
    await devices.flush();
  });
});

test("revoking by number, by all, and a damaged file", async () => {
  await inFolder(async (path) => {
    const devices = new PhoneDevices(path);
    const a = await devices.add("A");
    const b = await devices.add("B");
    const c = await devices.add("C");
    assert.deepEqual((await devices.revoke(2)).map((d) => d.name), ["B"]);
    assert.equal(devices.check(b.credential), null);
    assert.ok(devices.check(a.credential));
    assert.deepEqual(await devices.revoke(9), [], "no such number");
    assert.equal((await devices.revoke("all")).length, 2);
    assert.equal(devices.check(c.credential), null);
    await writeFile(path, "{not json", { mode: 0o600 });
    const damaged = new PhoneDevices(path);
    await damaged.load();
    assert.deepEqual(damaged.list(), [], "a damaged file is an empty list");
  });
});

test("a phone's name comes from its browser", () => {
  assert.equal(deviceName("Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"), "Chrome on Android");
  assert.equal(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari on iOS");
  assert.equal(deviceName(undefined), "A phone");
});

test("a pairing code works once, expires, and only the newest counts", () => {
  let now = 1_000_000;
  const pairing = new Pairing(() => now);
  const first = pairing.newCode();
  const second = pairing.newCode();
  assert.equal(pairing.start(first.code, "10.0.0.2", "A").ok, false, "an older code stops working");
  const ok = pairing.start(second.code, "10.0.0.2", "Phone");
  assert.equal(ok.ok, true);
  assert.equal(pairing.start(second.code, "10.0.0.2", "Phone").ok, false, "a code is used up by the first phone");
  const third = pairing.newCode();
  now += (CODE_SECONDS + 1) * 1000;
  assert.equal(pairing.start(third.code, "10.0.0.3", "Late").ok, false, "a code expires");
});

test("the request waits for the computer, shows four digits, and answers once", () => {
  let now = 1_000_000;
  const pairing = new Pairing(() => now);
  const started = pairing.start(pairing.newCode().code, "10.0.0.2", "Chrome on Android");
  assert.ok(started.ok);
  const request = (started as { ok: true; request: { id: string; code: string; state: string } }).request;
  assert.match(request.code, /^\d{4}$/);
  assert.equal(pairing.waiting().length, 1);
  assert.equal(pairing.answer(request.id, true)?.state, "allowed");
  assert.equal(pairing.answer(request.id, false), null, "answered already");
  assert.equal(pairing.waiting().length, 0);
  const second = pairing.start(pairing.newCode().code, "10.0.0.2", "Other");
  assert.ok(second.ok);
  now += (CODE_SECONDS + 1) * 1000;
  assert.equal(pairing.get((second as { ok: true; request: { id: string } }).request.id)?.state, "expired");
});

test("wrong codes from one address are turned away after five, and only three requests wait at once", () => {
  let now = 1_000_000;
  const pairing = new Pairing(() => now);
  pairing.newCode();
  for (let i = 0; i < 5; i++) assert.equal((pairing.start("wrong-code-xx", "10.0.0.9", "X") as { status: number }).status, 400);
  const blocked = pairing.start(pairing.newCode().code, "10.0.0.9", "X");
  assert.equal(blocked.ok, false);
  assert.equal((blocked as { status: number }).status, 429, "even the right code, from that address, for a minute");
  assert.equal(pairing.start(pairing.newCode().code, "10.0.0.10", "Y").ok, true, "another address is not affected");
  now += 61_000;
  for (let i = 0; i < 2; i++) assert.ok(pairing.start(pairing.newCode().code, `10.0.1.${i}`, "Z").ok);
  assert.equal(pairing.start(pairing.newCode().code, "10.0.2.1", "Q").ok, false, "three are waiting: the fourth is turned away");
});

test("an Always is kept on the device for Accept edits and Auto only, survives a restart, and goes with the device", async () => {
  await inFolder(async (path) => {
    const devices = new PhoneDevices(path);
    const { device } = await devices.add("Chrome on Android");
    assert.equal(devices.allows(device.id, "acceptEdits"), false);
    await devices.grant(device.id, "acceptEdits");
    await devices.grant(device.id, "everything"); // never remembered
    assert.equal(devices.allows(device.id, "acceptEdits"), true);
    assert.equal(devices.allows(device.id, "everything"), false);
    await devices.flush();
    const again = new PhoneDevices(path);
    await again.load();
    assert.equal(again.allows(device.id, "acceptEdits"), true);
    assert.equal(again.allows(device.id, "auto"), false);
    assert.match(describeDevice(again.list()[0], 1), /may switch on Accept edits without asking/);
    await again.revoke("all");
    assert.equal(again.allows(device.id, "acceptEdits"), false);
    await again.flush();
  });
});
