import { sessionCookie, type DeviceCheck } from "./lan.ts";
import { DEVICE_DAYS, PhoneDevices, deviceName, type PhoneDevice } from "./phone-devices.ts";
import { Pairing, type PairRequest, type StartResult } from "./phone-pairing.ts";

/** What the web side needs of the phone service (src/http-routes.ts): the three pairing routes and the check of a phone's cookie. */
export interface PhoneHttp {
  isDevice: DeviceCheck;
  start(code: unknown, address: string, userAgent: string | undefined): StartResult;
  status(id: unknown): Promise<{ state: string; setCookie?: string }>;
}

/**
 * Phones that were allowed on the computer: the registry (`src/phone-devices.ts`) and the pairing (`src/phone-pairing.ts`) together. `notify` reaches the pages on this
 * computer only (never a phone): it is how the card "A phone wants to connect" gets to the person who can answer it.
 */
export function createPhoneService(o: { devicesPath: string; notify(message: unknown): void; now?: () => number }) {
  const devices = new PhoneDevices(o.devicesPath, o.now);
  const pairing = new Pairing(o.now);
  const card = (r: PairRequest) => ({ type: "phone-pair", id: r.id, name: r.name, code: r.code, expiresAt: r.expiresAt });

  return {
    devices,
    pairing,
    load: () => devices.load(),
    /** The credential in this cookie belongs to a phone that was allowed (its time is renewed). */
    isDevice: ((cookie) => devices.check(cookie) !== null) as DeviceCheck,
    deviceId: (cookie: string | undefined): string | null => devices.check(cookie)?.id ?? null,
    newCode: () => pairing.newCode(),

    start(code: unknown, address: string, userAgent: string | undefined): StartResult {
      const result = pairing.start(code, address, deviceName(userAgent));
      if (result.ok) o.notify(card(result.request));
      return result;
    },

    /** What the waiting phone asks every second or so; the credential comes with the first answer after the yes, once. */
    async status(id: unknown): Promise<{ state: string; setCookie?: string }> {
      const request = pairing.get(id);
      if (!request) return { state: "expired" };
      if (request.state === "allowed" && !request.delivered) {
        request.delivered = true; // before the await: a second poll cannot get a second credential
        const { credential } = await devices.add(request.name);
        return { state: "allowed", setCookie: sessionCookie(credential, DEVICE_DAYS) };
      }
      return { state: request.state };
    },

    /** The computer's answer to a card. */
    answer(id: string, allow: boolean): PairRequest | null {
      const request = pairing.answer(id, allow);
      if (request) o.notify({ type: "phone-pair-done", id, state: request.state });
      return request;
    },

    /** The cards still waiting, for a page that connects after the phone did. */
    waitingCards: () => pairing.waiting().map(card),

    list: (): PhoneDevice[] => devices.list(),
  };
}

export type PhoneService = ReturnType<typeof createPhoneService>;
