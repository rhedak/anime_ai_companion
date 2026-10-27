# Plan: a safer phone, and more of what Remote Control can do

Status: layers 1a and 1b (a phone that asks, `src/remote-ask.ts`, the `remote-ask` card, `remoteGate`; Run everything moved from allowed to askable) are built on `dev`; layer 1a (pairing, per-device credentials, `/phone devices`, `/phone revoke`, 90 days renewed on use, the old token only with `--lan`) is built on `dev` (`src/phone-*.ts`, `public/pair.*`, `test/phone-devices.test.ts`, the pairing `describe` of `test/server.test.ts`); 1b, layer 2 and layer 3 are not. Written 2026-10-27. It changes rules written in `AGENTS.md` ("Safety": the phone's limits, `remoteBlockedMode`, `remoteBlocked`), so each layer waits for the owner's go. Goes with `docs/android-plan.md` (layer 2 is the Android app).

## Why

Claude's Remote Control lets a phone choose Manual, Accept edits, Plan and Auto (not Bypass) and answer permission prompts, trusting an enrolled device, TLS, and the user's account. Our phone can choose Manual, Plan and (for Cursor and opencode) Run everything, but not Accept edits or Auto, because our boundary is weaker: one shared secret in a link, over plain `http` on the local network (`src/lan.ts`). Today:

- one token for every device, saved in `data/lan-token` across restarts, shown in the links and QR code;
- the cookie holds that token itself (`sessionCookie`, a year), so a leaked cookie or screenshot is a password;
- nothing is encrypted: someone on the same Wi-Fi sees the cookie and can take over the session.

So the work is to make the boundary stronger first, then loosen what a phone may do in step with it. No account is needed anywhere.

## Layer 1: pairing, and a phone that asks

**1a. One-time pairing, per-device credentials (no new crypto, still `http`).**
- `/phone` (and `--lan`) show a pairing link with a single-use code `?e=<code>` that expires in two minutes. The long-lived shared token goes away.
- Opening it asks for a yes **on the computer**: a card on the local page, "A phone (Chrome on Android) wants to connect. Code 4821: Allow / Deny", and the phone shows the same four digits, so the person can tell it is theirs. On Allow the phone gets its own random credential (32 bytes) as the cookie.
- `data/phone-devices.json` (mode 0600) keeps, per device, the SHA-256 of its credential (never the credential), a name from the User-Agent, created and last-seen times and an optional expiry (default 90 days, renewed on use). `/phone devices` lists them, `/phone revoke <n|all>` removes them, `/phone off` still turns it all off. Failed pairing attempts are rate-limited, and each is logged (`[phone]`).
- The `Host` and `Origin` checks stay as they are.
- What it does not do: it is still `http`, so someone on the network can read the cookie. That is layer 2's job, and the docs say so.

**1b. A phone asks, the computer answers.** A request from a phone that is refused today is raised as a card on the computer instead: "Galaxy A54 asks to turn on Accept edits: Allow this session / Deny". Only a socket on this computer can answer; it expires in two minutes; with no local page open the phone is told "not possible now, open the app on the computer". A plain Allow is memory only, so every start is back to Ask. (Changed 2026-10-27 at the owner's request: for Accept edits and Auto the card also offers "Always for this phone", kept on the device record, ended by `/phone revoke`; Run everything and `/memory auto` stay one-time.)
- A paired phone may *ask* for: Accept edits, Auto (Claude), Run everything (Cursor, opencode: **this tightens today's rule**, which lets a phone choose it), and `/memory auto`.
- Not askable from a browser phone, only from the Android app of layer 2: `/setup on`, `/skills on`, `/chrome on` (they load the user's hooks, skills or Chrome, i.e. code).
- Never from a phone, as now: `!commands`, `/restart`, the folder dialog, importing or resetting a card, installing a brain, persona and note edits. Remote Control does not offer them either.
- The new pieces: a `remote-ask` message type to local sockets, an `ask-answer` back, the grant held beside `permissionMode`, and `remoteBlocked` / `remoteBlockedMode` consulting the grant.

## Layer 2: the Android app as the strong tier

Needs the Capacitor shell (`docs/android-plan.md`). A browser on the phone cannot do this on a local network: `crypto.subtle` (so any browser-held key) is missing on plain `http`, and WebAuthn needs a host name and HTTPS.
- **TLS with a pinned certificate.** At the first `/phone` the server makes a self-signed ECDSA P-256 certificate (`data/phone-tls/`, owner-only) and a small private CA for client certificates, and listens on a second port with `https`. The pairing QR code carries `anaico://pair?host=…&port=…&fp=<sha256 of the certificate>&e=<code>`. The app trusts that fingerprint only (trust on first use, as `known_hosts` does).
- **A key in the phone.** The app generates its key in the Android Keystore (never exported), sends the public key at pairing, and receives a client certificate signed by the private CA. The server runs `requestCert` and matches the certificate's fingerprint against `phone-devices.json`: the same registry, a stronger credential, revocable in the same way. No password, no account.
- **What it gets.** Encryption and mutual identity on the local network, so the layer 1b grants are safe to extend to this tier: `/setup`, `/skills`, `/chrome` become askable from it, and a standing "this phone may use Accept edits" setting becomes possible (off at every start, answered on the computer).
- The browser phone stays on the `http` tier of layer 1.
- New dependency: an X.509 library for the certificates (`@peculiar/x509`, which runs on Node's WebCrypto), or no dependency by shelling out to `openssl` where it exists; Windows has no `openssl`, so the library is the likely choice. It goes in `package.json` like `ws`.
- **Spike first, on the A54:** a WebView must (1) accept only the pinned fingerprint (`onReceivedSslError`), (2) present the Keystore client certificate (`onReceivedClientCertRequest`), and (3) do both for the **WebSocket** handshake, not only for page loads. If (3) fails in a WebView, the fall-back is a native OkHttp socket in the plugin that the page's socket talks to. Nothing below is committed to until this works.

## Layer 3: for people who already have a tunnel

Done 2026-10-27 (the "Away from home" section of `site/pages/phone.md`). Document, not build: `ssh -L 3737:127.0.0.1:3737 computer` (Termux, ConnectBot), Tailscale, and WireGuard. Tell them plainly what a tunnel to loopback means: the server sees the computer itself, so the tunnel gets **every** right of a local page, `!commands` included; use it only for a tunnel you own. Tailscale's `serve` gives HTTPS with a real certificate and `*.ts.net` name, which would also let a browser phone use WebCrypto later; not planned now.

Not planned: an SSH server inside the app (it needs the system's sshd or a large dependency, and widens what is exposed), WebAuthn, and our own encrypted channel over `http` (the page's own code would still arrive unprotected).

## Rules in `AGENTS.md` that change

- "Safety" first bullet: the phone's tier list replaces the single token; `lan-token` is gone, `phone-devices.json` and `phone-tls/` are named; "off at every start" and "a phone cannot turn it on or off" stay.
- "Such a socket may not run `!command`, turn on Auto or Accept edits, turn on `/setup` and `/chrome`…": becomes "may ask, the computer answers" with the lists above; Run everything moves from allowed to askable.
- The desktop shell and the page keep `remoteSockets` as the one test for "from the network"; the strong tier is a property of the device, not a new socket kind.

## Tests

- Unit (`test/lan.test.ts` and new): a pairing code works once and expires; a credential is stored hashed and checked in constant time; revoke and expiry; rate limit; the registry file mode.
- Server (`test/server.test.ts`, remote sockets as in the existing phone tests): a phone's request raises a card on the local socket only; allow grants for the session and a restart clears it; no local socket gives "not possible now"; a denied or expired card changes nothing; a phone can still not run `!command`; Run everything is askable, not directly allowed.
- Layer 2: Node `https` with generated certificates against a client that has and one that lacks a certificate; the fingerprint pin; revoke closes the socket. The Android checks are by hand on the A54.

## Order, and what each costs

1. **1a** (small to medium): replaces the token, the biggest weakness for the least change. Ships alone as a minor release.
2. **1b** (medium): the ask card and the grant. Ships with 1a or just after.
3. **The Android shell** (`android-plan.md`, phase 1) and the **layer 2 spike**.
4. **Layer 2** proper, if the spike works, then `/setup` and friends for the strong tier.
5. **Layer 3** docs at any time.

## Decisions (owner, 2026-10-27)

- **The legacy shared token stays for one release** behind `--lan`, restricted exactly as today, and marked in `/phone devices` as legacy with a warning at start and in `/phone`. It ends in the release after layer 1a ships.
- **A headless server needs the app open** to answer the pairing and ask cards. With no local page connected, a phone is told "open the app on the computer to allow this"; there is no terminal path.
- **A device's access lasts 90 days, renewed on every use**, so a phone used at least every three months never has to pair again; an unused one expires by itself.
