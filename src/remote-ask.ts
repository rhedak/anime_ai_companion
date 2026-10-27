import { randomBytes } from "node:crypto";

/**
 * A phone asks for something only the person at the computer may allow (turning on Accept edits, Auto or Run everything, say): docs/phone-security-plan.md, layer 1b. The
 * request becomes a card on a page on this computer; an answer there does it, once, as if it had been typed on the computer. A closed phone or two minutes without an
 * answer end it. For Accept edits and Auto the card also offers "Always for this phone", which the caller remembers on the device (`src/phone-devices.ts`); the rest asks every time.
 */
export const ASK_SECONDS = 120;
/** At most this many questions wait at once, so a phone cannot bury the computer's page in cards. */
const MAX_WAITING = 3;

export interface RemoteAsk {
  id: string;
  /** The phone's name as `/phone devices` shows it. */
  device: string;
  /** What it asks for, in a few words ("turn on Accept edits"). */
  label: string;
  expiresAt: number;
  /** The card offers "Always for this phone" (only for modes that may be remembered). */
  always: boolean;
}

interface Pending extends RemoteAsk {
  owner: object;
  apply(): void | Promise<void>;
  tell(text: string): void;
  remember?: () => void | Promise<void>;
  timer: ReturnType<typeof setTimeout>;
}

export function createRemoteAsks(o: { computerOnline(): boolean; notify(message: unknown): void; seconds?: number }) {
  const waiting = new Map<string, Pending>();
  const ttl = (o.seconds ?? ASK_SECONDS) * 1000;
  const card = ({ id, device, label, expiresAt, always }: RemoteAsk) => ({ type: "remote-ask", id, device, label, expiresAt, always });

  function finish(p: Pending): void {
    clearTimeout(p.timer);
    waiting.delete(p.id);
    o.notify({ type: "remote-ask-done", id: p.id });
  }

  return {
    /** Raises the question. Returns what to tell the phone when it cannot be asked (nobody is at the computer, or too many are waiting). */
    ask(owner: object, device: string, label: string, apply: () => void | Promise<void>, tell: (text: string) => void, remember?: () => void | Promise<void>): { ok: true } | { ok: false; reason: string } {
      if (!o.computerOnline()) return { ok: false, reason: "Not possible now: open the companion on the computer, and ask again, to let this through." };
      if ([...waiting.values()].some((p) => p.owner === owner && p.label === label)) return { ok: false, reason: "That is already waiting for an answer on the computer." };
      if (waiting.size >= MAX_WAITING) return { ok: false, reason: "Other questions are waiting on the computer. Answer them there first." };
      const id = randomBytes(12).toString("base64url");
      const timer = setTimeout(() => {
        const p = waiting.get(id);
        if (!p) return;
        finish(p);
        p.tell(`The computer did not answer in time, so ${label} did not happen.`);
      }, ttl);
      timer.unref();
      const pending: Pending = { id, device, label, expiresAt: Date.now() + ttl, always: Boolean(remember), owner, apply, tell, remember, timer };
      waiting.set(id, pending);
      o.notify(card(pending));
      return { ok: true };
    },

    /** The computer's answer. Null when the question is gone (expired, answered, the phone left). */
    async answer(id: string, allow: boolean | "always"): Promise<RemoteAsk | null> {
      const p = waiting.get(id);
      if (!p) return null;
      finish(p);
      if (!allow) p.tell(`The computer said no: ${p.label} did not happen.`);
      else {
        await p.apply();
        if (allow === "always" && p.remember) {
          await p.remember();
          p.tell(`Allowed on the computer: ${p.label}. This phone will not be asked about it again (/phone revoke removes that).`);
        } else p.tell(`Allowed on the computer: ${p.label}.`);
      }
      return p;
    },

    /** The questions still waiting, for a page that opens after the phone asked. */
    waiting: (): ReturnType<typeof card>[] => [...waiting.values()].map(card),

    /** The phone that asked is gone: its questions go with it. */
    drop(owner: object): void {
      for (const p of [...waiting.values()]) if (p.owner === owner) finish(p);
    },
  };
}

export type RemoteAsks = ReturnType<typeof createRemoteAsks>;
