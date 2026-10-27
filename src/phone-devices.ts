/**
 * The phones that were allowed on the computer, one record each (docs/phone-security-plan.md, layer 1a). A phone that was let in by a yes on the computer gets its own random
 * credential (its cookie); the file keeps only the SHA-256 of it, so reading `data/phone-devices.json` gives nobody a way in. A device is good for 90 days and the time
 * starts again every time it is used; an unused one expires by itself. `/phone devices` lists them and `/phone revoke` removes them.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEVICE_DAYS = 90;
const DAY = 86_400_000;
/** A device's use renews its time, but the file is not rewritten for every request: at most once an hour per run. */
const SAVE_EVERY = 3_600_000;

export interface PhoneDevice {
  id: string;
  name: string;
  /** SHA-256 (hex) of the credential, which only the phone has. */
  hash: string;
  created: number;
  lastSeen: number;
  expires: number;
  /** Modes this phone may switch on without a card each time (`REMEMBERABLE`), because the person said "always" on the computer. */
  allow?: string[];
}

/** The two modes a yes can be remembered for. Run everything and `/memory auto` always ask. */
export const REMEMBERABLE = ["acceptEdits", "auto"] as const;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export class PhoneDevices {
  private devices: PhoneDevice[] = [];
  private lastSaved = 0;
  private saving: Promise<void> = Promise.resolve();

  private readonly path: string;
  private readonly now: () => number;

  constructor(path: string, now: () => number = Date.now) {
    this.path = path;
    this.now = now;
  }

  /** Reads the file; a missing or damaged one is an empty list, and expired devices are dropped. */
  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as { devices?: unknown };
      const list = Array.isArray(parsed.devices) ? parsed.devices : [];
      this.devices = list.filter((d): d is PhoneDevice => {
        const x = d as Partial<PhoneDevice>;
        return typeof x?.id === "string" && typeof x.name === "string" && /^[0-9a-f]{64}$/.test(String(x.hash)) && Number.isFinite(x.created) && Number.isFinite(x.lastSeen) && Number.isFinite(x.expires);
      }).map((d) => {
        const allow = Array.isArray(d.allow) ? d.allow.filter((m) => (REMEMBERABLE as readonly string[]).includes(m)) : [];
        return allow.length ? { ...d, allow } : { ...d, allow: undefined };
      });
    } catch {
      this.devices = [];
    }
    this.devices = this.devices.filter((d) => d.expires > this.now());
  }

  /** The devices that can still come in, oldest first. */
  list(): PhoneDevice[] {
    const now = this.now();
    this.devices = this.devices.filter((d) => d.expires > now);
    return [...this.devices];
  }

  /** The device this credential belongs to, with its time renewed, or null. The comparison is on the hashes and takes the same time for every device. */
  check(credential: string | undefined): PhoneDevice | null {
    if (!credential || credential.length > 200) return null;
    const hash = Buffer.from(sha256(credential), "hex");
    const now = this.now();
    let found: PhoneDevice | null = null;
    for (const d of this.devices) {
      if (timingSafeEqual(hash, Buffer.from(d.hash, "hex")) && d.expires > now) found = d;
    }
    if (!found) return null;
    found.lastSeen = now;
    found.expires = now + DEVICE_DAYS * DAY;
    if (now - this.lastSaved > SAVE_EVERY) void this.save().catch(() => {});
    return found;
  }

  /** Whether this phone was told "always" for the mode. */
  allows(id: string | undefined, mode: string): boolean {
    return this.list().some((d) => d.id === id && d.allow?.includes(mode));
  }

  /** Remembers a yes for the mode on this phone (revoking the phone forgets it). */
  async grant(id: string, mode: string): Promise<void> {
    const d = this.list().find((x) => x.id === id);
    if (!d || !(REMEMBERABLE as readonly string[]).includes(mode) || d.allow?.includes(mode)) return;
    d.allow = [...(d.allow ?? []), mode];
    await this.save();
  }

  /** Lets a new phone in: a fresh credential (returned once, never kept) and its record. */
  async add(name: string): Promise<{ device: PhoneDevice; credential: string }> {
    const credential = randomBytes(32).toString("base64url");
    const now = this.now();
    const device: PhoneDevice = { id: randomUUID(), name: name.slice(0, 80) || "A phone", hash: sha256(credential), created: now, lastSeen: now, expires: now + DEVICE_DAYS * DAY };
    this.devices.push(device);
    await this.save();
    return { device, credential };
  }

  /** Removes devices: `all`, or the number `/phone devices` shows (1 is the first), or the start of an id. Returns what was removed. */
  async revoke(which: "all" | number | string): Promise<PhoneDevice[]> {
    const list = this.list();
    const gone = which === "all" ? list : typeof which === "number" ? list.slice(which - 1, which) : list.filter((d) => d.id.startsWith(which));
    if (!gone.length) return [];
    this.devices = this.devices.filter((d) => !gone.includes(d));
    await this.save();
    return gone;
  }

  /** Resolves when the writes started so far are done (a test removes the folder after it). */
  flush(): Promise<void> {
    return this.saving;
  }

  /** The file is private (owner only) and replaced whole, so a crash never leaves half of it. */
  private save(): Promise<void> {
    this.lastSaved = this.now();
    const write = async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.tmp`;
      await writeFile(temp, JSON.stringify({ devices: this.devices }, null, 2) + "\n", { mode: 0o600 });
      await chmod(temp, 0o600);
      await rename(temp, this.path);
    };
    this.saving = this.saving.then(write, write);
    return this.saving;
  }
}

/** A readable line for `/phone devices`. */
export function describeDevice(d: PhoneDevice, index: number, now = Date.now()): string {
  const days = (ms: number) => Math.max(0, Math.round(ms / DAY));
  const seen = now - d.lastSeen < 120_000 ? "now" : `${days(now - d.lastSeen)} days ago`;
  const allowed = d.allow?.length ? `; may switch on ${d.allow.map((m) => (m === "acceptEdits" ? "Accept edits" : "Auto")).join(" and ")} without asking` : "";
  return `${index}. ${d.name}: last used ${seen}, good for ${days(d.expires - now)} more days${allowed}`;
}

/** The phone's name for the list, from the browser's description ("Chrome on Android"). */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "";
  const browser = /Edg\//i.test(ua) ? "Edge" : /SamsungBrowser/i.test(ua) ? "Samsung Internet" : /Firefox\//i.test(ua) ? "Firefox" : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : "";
  return browser && os ? `${browser} on ${os}` : browser || os || "A phone";
}
