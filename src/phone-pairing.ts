/**
 * Letting a new phone in (docs/phone-security-plan.md, layer 1a): the link `/phone` shows carries a code that works once and expires in two minutes. A phone that
 * opens it starts a request, and nothing happens until the person at the computer allows it on a card that shows the same four digits as the phone does. All in memory:
 * a restart ends every code and every waiting request.
 */
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_SECONDS = 120;
/** At most this many requests wait for an answer at once, so a flood of attempts cannot bury the card. */
const MAX_WAITING = 3;
/** Wrong codes from one address: after this many in a minute, that address is turned away for the rest of it. */
const MAX_WRONG = 5;
const MINUTE = 60_000;

export type PairState = "waiting" | "allowed" | "denied" | "expired";

export interface PairRequest {
  id: string;
  name: string;
  /** The four digits both screens show. */
  code: string;
  expiresAt: number;
  state: PairState;
  /** The credential was handed to the phone (once). */
  delivered: boolean;
}

export type StartResult = { ok: true; request: PairRequest } | { ok: false; status: 400 | 429; reason: string };

export class Pairing {
  private code: { value: string; expiresAt: number } | null = null;
  private requests = new Map<string, PairRequest>();
  private wrong = new Map<string, { count: number; since: number }>();

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** A new code for the next phone; an earlier one that was not used stops working. */
  newCode(): { code: string; expiresAt: number } {
    this.code = { value: randomBytes(9).toString("base64url"), expiresAt: this.now() + CODE_SECONDS * 1000 };
    return { code: this.code.value, expiresAt: this.code.expiresAt };
  }

  /** The phone opened the link: the code is used up, and a request waits for the computer's answer. */
  start(code: unknown, address: string, name: string): StartResult {
    const now = this.now();
    const tries = this.wrong.get(address);
    if (tries && now - tries.since < MINUTE && tries.count >= MAX_WRONG) return { ok: false, status: 429, reason: "Too many tries. Wait a minute." };
    const current = this.code;
    const good = Boolean(current && typeof code === "string" && current.expiresAt > now && code.length === current.value.length && timingSafeEqual(Buffer.from(code), Buffer.from(current.value)));
    if (!good) {
      const fresh = tries && now - tries.since < MINUTE ? tries : { count: 0, since: now };
      fresh.count++;
      this.wrong.set(address, fresh);
      return { ok: false, status: 400, reason: "That link is not valid any more. Type /phone on the computer for a new one." };
    }
    this.code = null; // one phone per code
    this.expire();
    if (this.waiting().length >= MAX_WAITING) return { ok: false, status: 429, reason: "Other phones are waiting to be allowed. Answer them on the computer first." };
    const request: PairRequest = { id: randomBytes(16).toString("base64url"), name: name.slice(0, 80) || "A phone", code: String(randomInt(0, 10000)).padStart(4, "0"), expiresAt: now + CODE_SECONDS * 1000, state: "waiting", delivered: false };
    this.requests.set(request.id, request);
    return { ok: true, request };
  }

  /** Waiting requests whose time is over become expired; very old ones are forgotten. */
  private expire(): void {
    const now = this.now();
    for (const [id, r] of this.requests) {
      if (r.state === "waiting" && r.expiresAt <= now) r.state = "expired";
      if (r.expiresAt + 5 * MINUTE < now) this.requests.delete(id);
    }
    for (const [address, tries] of this.wrong) if (now - tries.since >= MINUTE) this.wrong.delete(address);
  }

  /** The requests the computer still has to answer. */
  waiting(): PairRequest[] {
    this.expire();
    return [...this.requests.values()].filter((r) => r.state === "waiting");
  }

  get(id: unknown): PairRequest | null {
    this.expire();
    return typeof id === "string" ? (this.requests.get(id) ?? null) : null;
  }

  /** The computer's answer. Null when the request is gone, expired or answered already. */
  answer(id: string, allow: boolean): PairRequest | null {
    const request = this.get(id);
    if (!request || request.state !== "waiting") return null;
    request.state = allow ? "allowed" : "denied";
    return request;
  }
}
