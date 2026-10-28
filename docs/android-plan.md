# Plan: the Android app

Status: planned, nothing built. Written 2026-10-28 as the detailed plan; it replaces the draft of 2026-10-27. The phone's security tiers are in `docs/phone-security-plan.md`: this app is that document's **layer 2** (the strong tier), and phase 1 below is also where the app first uses the pairing that layer 1a already has. Each phase ends with a list of checkboxes; tick them in this file as they are done, and move a finished phase's open questions into the decisions section.

## 1. Goal, and what it is not

An installable Android app for the companion, with two ways to get a brain:

1. **With the computer** (phone mode): the app opens the computer's own page, so chat, approval cards, stop, and **work mode** all work exactly as they do from a phone browser, with the computer doing the work. This is the entry that matters; everything else is secondary.
2. **On its own** (the on-device entry): chat only, the character drawn on the phone by the browser demo that ships inside the app. The brain is an Ollama server the user already runs: on the phone itself (Termux), or on the computer over the home Wi-Fi. No work mode, no tools, no approval cards.

Out of scope for now: a model inside the app (LiteRT, MediaPipe, llama.cpp as a plugin), opencode or Claude Code on the phone (command-line programs Android does not run for us), Google Play, push notifications, iOS, a tablet layout beyond what the page already does.

## 2. Where things stand (checked 2026-10-28)

- **The phone page works in a browser on the A54**, from `--lan` and from `/phone`, after pairing (layer 1a). It has **not yet been run inside a WebView**. The earlier note that it "runs in a WebView as it is" was based on the browser test and is not a result.
- **Pairing and the ask card are built** (`src/phone-pairing.ts`, `src/phone-devices.ts`, `src/remote-ask.ts`). The app's connect screen uses that pairing, not the old shared token, which only `--lan` still carries for one more release.
- **The cookie** is `HttpOnly; SameSite=Strict; Path=/`, per phone, 90 days from last use, no `Secure` (plain `http` on the local network). A WebView keeps cookies in its own store, so the pairing survives an app restart as long as the store is kept.
- **The host check** (`hostHeaderAllowed`, `src/lan.ts`) accepts IP literals, `localhost` and `.local` names. The origin check on the WebSocket compares against the page's own origin, so the app must load the computer's page from the computer's address, not from a bundled `https://localhost` page.
- **The on-device entry has its parts**: `demo/` is the whole app with no server (`local-socket.js`, `render-bridge.js` with the creator's compiled TypeScript, the built-in reader in `public/script.js`); `demo/ollama.js` already chats with an Ollama at a settable `url` (`/api/chat`, streamed); `demo/remote-packs.js` fetches packs by URL; `demo/model-dialog.js` has the model chooser.
- **The toolchain on this Mac is not ready.** `/usr/bin/java` is the macOS stub with no runtime, and there is no Android SDK, no `adb` and no Gradle. Phase 0 installs them, with the owner's go.
- **Security rules that the app must not weaken** are in `AGENTS.md` ("Safety"): the server decides what a phone may do, so the app is a thin client and adds no rights.

## 3. Decisions (recommendation first; the owner decides the ones marked *)

**D1. Shell: Capacitor.** Layer 2 needs native code anyway (the Keystore key, the pinned certificate, the client certificate), and Capacitor gives a WebView, a plugin system and the Android build. A PWA on the existing page is a smaller first step (a manifest, a service worker) but cannot pin a certificate, keep a key, or ship the demo offline the same way. *Alternative: a PWA first, Capacitor later.* Owner's call (open question 1).

**D2. Where the project lives: `android/` as its own npm project**, with its own `package.json` and lockfile, the same way `app/` (the Electron desktop shell) is. The root `package.json` gets no Capacitor dependency, so `npm install`, `check.sh` and the lockfile test do not change for people who do not build the app.

**D3. What the WebView loads.** Two origins, never mixed:
- *Computer entry:* the shell opens a small connect screen from its own assets, then **navigates the WebView to `http://<computer>:<port>/`** (or `https://` once layer 2 exists). The page is then the computer's page with its own origin, so the existing `Host` and `Origin` checks work unchanged.
- *On-device entry:* the staged demo from `android/www/` (built from `demo/stage.mjs`), origin `https://localhost` in Capacitor's default setup. Its Ollama calls are the only network calls it makes.

**D4. Network rules.** Android blocks cleartext by default. Phase 1 allows cleartext in a network security config **only** for the private ranges the app can check itself (10/8, 172.16/12, 192.168/16, 100.64/10 for Tailscale, `.local`, `localhost`). The app refuses any other host before it loads anything. If Android's config cannot name address ranges (only host names), the app allows cleartext for all and does the range check in code (spike S1 decides). `android:usesCleartextTraffic` stays off globally.

**D5. Client certificate mechanism (layer 2).** The riskiest piece. Two candidates, decided by spike S4:
- (a) the WebView's own client-certificate callback (`onReceivedClientCertRequest`) with a key the WebView can use. Keys in the Android Keystore are not normally handed to the WebView this way; a certificate installed in the system KeyChain is, but that means a user dialog and a certificate the user can see in settings.
- (b) **a native proxy**: the app's native layer opens the WebSocket and the page requests itself through a loopback address inside the app, and the native side makes the TLS connection with OkHttp, presenting the Keystore key. More code, but the key never leaves the Keystore and the WebView never sees the certificate. The server must then accept the loopback proxy's origin; that is a server change to plan for (see section 6).

**D6. On-device Ollama.** The page on `https://localhost` calling `http://<lan>:11434` is mixed content and blocked; `http://localhost:11434` (Termux) is allowed as a potentially trustworthy origin. Either the page calls Ollama directly with `OLLAMA_ORIGINS=https://localhost` set on the Ollama side, or the native layer makes the calls (`CapacitorHttp`), which needs streaming checked (spike S5). Recommendation: direct calls, with the origin documented.

**D7. Distribution.** An APK attached to the GitHub release like the desktop installers, signed with a debug or a release key and **said plainly** as unsigned for the store. Google Play is a later decision (a developer account, a privacy policy, signing keys, and review of an app that can drive a computer). Sideloading needs "install unknown apps" on the phone; the Download page explains it as it does for the desktop.

**D8. Minimum Android.** Android 8 (API 26) or newer, which keeps a current WebView, WebSocket and the Keystore's EC keys. *Owner's call* if an older phone matters (open question 4).

## 4. Spikes on the A54 (each a pass/fail before the phase that needs it)

- [ ] **S1. Cleartext to a private address.** A WebView loads `http://192.168.x.x:3737/` with a network security config that names the private ranges. Pass: loads, WebSocket connects. If ranges cannot be named, record the fallback in D4.
- [ ] **S2. The computer's page in a WebView.** Pairing with `?e=<code>` in the WebView, the four digits, the card on the computer, the cookie kept after closing and reopening the app, the WebSocket handshake with the `Origin` check. Pass: a chat and an approval card from the app, after a restart.
- [ ] **S3. Pinned certificate on the WebSocket** (layer 2 prerequisite). A scratch HTTPS server with a self-signed certificate; the WebView accepts only its fingerprint (`onReceivedSslError`) for the page **and** the WebSocket. Pass: both connect with the right fingerprint and refuse a wrong one. A failure here sends the WebSocket through D5(b).
- [ ] **S4. Client certificate with a Keystore key** (layer 2). Try D5(a) first: can the WebView's callback use a Keystore key? If not, prototype D5(b) with OkHttp against the scratch server, requiring a client certificate. Pass: the server sees a certificate whose fingerprint matches the one generated on the phone, and a client without one is refused.
- [ ] **S5. Ollama from the on-device page.** Termux Ollama and the computer's Ollama, `OLLAMA_ORIGINS=https://localhost`; streaming `/api/chat` shows text as it arrives (not all at the end). Pass: streamed chat with the built-in drawing.
- [ ] **S6. Pack storage.** A downloaded pack survives an app restart; check whether a cleared WebView cache drops it, and if so move it to the app's file storage (`Capacitor Filesystem`). Pass: the pack is still there after a restart.
- [ ] **S7. Voice.** `speech.js` in the WebView: check whether the recognition exists at all. Expected: absent, so the microphone button is hidden there (it is already hidden by the same check on phones without it).

## 5. Phases, with todo lists

### Phase 0: toolchain and project skeleton (small)

Needs the owner's go to install software on this Mac.
- [x] Install a JDK 21 (`brew install openjdk@21`) and point `JAVA_HOME` at it; `java -version` must answer. (2026-10-28: OpenJDK 21.0.13 at `/opt/homebrew/opt/openjdk@21`.)
- [x] Install the Android SDK command-line tools, accept the licences, install platform 35, build-tools 35.0.0 and platform-tools. (2026-10-28: `brew install --cask android-commandlinetools`; the SDK root is `/opt/homebrew/share/android-commandlinetools`, platform-tools 37.0.1, adb 1.0.41. Not Android Studio.)
- [x] Turn on developer options and wireless debugging on the A54; paired and connected on 2026-10-28 (SM-A5460, Android 16, SDK 36, 1080×2340).
- [x] Create `android/` as a Capacitor project (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, pinned 8.5.3), `minSdk 26`, target and compile SDK 36, app id `io.github.rhedak.anaico`, its own `package.json` and lockfile (D2). A placeholder `www/` stands in until phase 1.
- [ ] Until phase 4, `check.sh` and the release workflow must not touch `android/`.
- [x] A debug APK builds with `./gradlew assembleDebug` and installs on the A54, and launches showing the placeholder page (2026-10-28).

**Done when:** the empty app installs and starts on the A54, and `android/` builds from a clean clone with the documented commands.

### Phase 1: the computer entry (small to medium)

- [x] Connect screen (native assets, not the computer's page): a field for the address, "Scan the QR code" and "Use a saved computer". (2026-10-28, `android/www/`.)
- [~] Scan the QR code `/phone` shows (`@capacitor-mlkit/barcode-scanning` 8.2.1, the Google code-scanner module, no camera permission of ours). The host check runs before loading. Code is written; not yet tried with a real scan.
- [x] Load the link in the WebView; the four digits show on the phone; the computer's card answers. After Allow the WebView holds the phone's own cookie (the 1a credential), with `HttpOnly` kept. (2026-10-28: pairing 2597 on the A54 against a scratch server on 3800.)
- [x] Save the computer's address (not the code, not the cookie) in `EncryptedSharedPreferences`; the next start offers "Connect to <address>" and reloads the page with the cookie already there. (Checked after an app relaunch.)
- [x] Back button: in the chat goes back in the page's own history if any, otherwise shows the connect screen. Needed the AndroidX back dispatcher: overriding `onBackPressed` was never called. (Checked on the A54.)
- [~] Navigation lock: `AnaicoWebViewClient` keeps the WebView on the computer's host; other links go to the phone's browser (Capacitor's default). WebView file, content and popup settings are off. Not yet tested: a link to another site on the computer's page, and debugging off in release.
- [x] `android:allowBackup="false"` so the cookie store is not copied to a cloud backup. `android:usesCleartextTraffic="true"` is set in the manifest (Capacitor 8 writes no cleartext setting; the network security config cannot name address ranges, so the address check in code is the limit; S1 decided this).
- [x] "Forget this computer" clears the saved address and the cookies for it. Revoking the phone from the computer stays `/phone revoke`. (Checked on the A54.)
- [ ] Server: nothing new for phase 1, except a test that a pairing made from the WebView's user agent is listed by `/phone devices` with a readable name.
- [ ] Test on the A54: chat, an approval card, a work-mode edit from the app; then close the app, reopen it, and continue.

**Done when:** S1, S2 pass, and the A54 test above passes after a restart of the app and of the computer's server (the cookie is then refused for a revoked phone, and the app says so and offers to pair again).

### Phase 2: the on-device entry (small to medium)

- [ ] `android/www/` built from `node demo/stage.mjs` (copied at build time, not committed: a `npm run stage` step in `android/`).
- [ ] A first screen choice: "Use it with my computer" or "Use it on this phone". The second one opens the staged demo.
- [ ] The Ollama address field (default `http://localhost:11434`, with the note that Termux runs it there and a computer's address needs `OLLAMA_ORIGINS`), and the model chooser from `demo/model-dialog.js`.
- [ ] Packs: downloaded to app storage (S6), the same checked install as the desktop (sha256 from the index).
- [ ] Without Ollama reachable, the built-in script answers (as the demo does); the page says that it is a script.
- [ ] Hide the microphone (S7), and say on the entry screen that it is chat only with no tools.
- [ ] Confirm the demo's stand-in server answers everything the page needs with no server (`test/browser-demo.test.ts` already covers it; add a check that the staged folder is what `android/www/` contains).

**Done when:** S5 passes; on the A54 with Ollama on the home Wi-Fi she chats and animates with her pack; with no network the script still answers.

### Phase 3: the strong tier, layer 2 (medium to large; only after S3 and S4 pass)

Server side (in `src/`, with tests in `test/server.test.ts` and `test/phone-devices.test.ts`):
- [ ] Make the server's TLS certificate and a small private CA on the first `/phone` (`data/phone-tls/`, owner-only, as `docs/phone-security-plan.md` describes). Dependency: an X.509 library (`@peculiar/x509`, on Node's WebCrypto) or `openssl` where present; decide at the start of this phase, since it goes in `package.json` like `ws`.
- [ ] A second listener on `https` (a second port) that requests a client certificate; the plain `http` listener stays for browsers.
- [ ] The QR code carries `anaico://pair?host=…&port=…&fp=<sha256 of the server certificate>&e=<code>` for the app; the browser link is unchanged.
- [ ] Pairing takes the app's public key (from the Keystore) and returns a client certificate signed by the private CA; the server stores its fingerprint on the device record in `phone-devices.json` (no key material).
- [ ] The server matches the presented certificate to a device record (`requestCert` path), and a revoked device's socket is closed at once.
- [ ] Tests: a client with a certificate is accepted, one without is refused, a wrong fingerprint is refused by the client, revoke closes the socket, and a strong device may ask for `/setup on`, `/skills on`, `/chrome on` (askable only from this tier, as `docs/phone-security-plan.md` says).

App side:
- [ ] Generate the key in the Android Keystore (EC P-256, never exported, no user authentication required).
- [ ] Pinned fingerprint (`onReceivedSslError` accepts only that certificate) for the page and the WebSocket (S3).
- [ ] Client certificate: D5(a) or D5(b), whichever S4 passed; the app never logs or shows the key.
- [ ] Forget and re-pair: a new key pair, the old device record revoked by the server on the next connect.

**Done when:** on the A54 a strong-tier phone connects over `https`, a plain-browser phone to the same server still gets the layer 1 rules, a revoked phone is cut off at once, and a wrong fingerprint is refused by the app.

### Phase 4: distribution and documentation (small)

- [ ] `.github/workflows/release.yml`: a job that builds the debug or release APK (JDK 21, the Android SDK, `./gradlew assembleRelease` with the project's signing, or debug-signed and said so) and attaches `Anime.AI.Companion-X.Y.Z.apk` plus its line in `SHA256SUMS`.
- [ ] `site/build.mjs` and the Download page: the APK row, the "install unknown apps" note, and what unsigned means.
- [ ] `site/pages/phone.md` gets an "Android app" section (the connect screen, the on-device entry, what the app does and does not add).
- [ ] `AGENTS.md`: one paragraph on `android/` (its own project, the two entries, the WebView rules).
- [ ] `.claude/skills/release-companion`: the APK is one more installer to check in step 3 of the release.
- [ ] The release notes say which phone was tested, which were not, and that the APK is not on a store.

**Done when:** a release with the APK shows it on the Download page with a checksum, and the site's Android section is live after the Pages run.

### Phase 5: polish (later, optional)

- [ ] Notification when a reply finishes while the app is in the background (the WebView's `Notification`, or a native one from the page's message).
- [ ] Finding the computer by its `.local` name, not only by address.
- [ ] Icon, splash screen and a status-bar colour from the theme.

## 6. Server changes the app needs (all in the computer's code)

- The `https` listener, the private CA and the device fingerprint (phase 3). None of it is needed for the computer entry.
- If D5(b) is chosen, the app's native proxy connects to the TLS listener, never the plain one, so the server sees a network connection with a client certificate and applies the strong tier's rules. A connection on the plain listener must never be treated as local because it came through a proxy. The server must not trust a request just because its `Origin` is the app's.
- `/phone` shows the `anaico://` link next to the browser links (phase 3).
- Nothing else. The app does not get its own commands, and the server does not learn that a client is an app, beyond the device record.

## 7. Testing

- **Node, in CI:** `test/` covers the server side (pairing, the device record, the TLS listener's rules, revoke), the demo staging, and the link format the app parses (`anaico://pair?…`).
- **Android, in CI:** `./gradlew testDebugUnitTest assembleDebug` for the link parser, the private-range check and the navigation lock. No emulator in CI at first.
- **Manual on the A54:** a script per phase, the checklist above, done before each release that changes the app. Results go in the release notes ("Tested", as now).
- No test may start a real Claude, Cursor or opencode, and none may need an Ollama model: the on-device entry is tested against the fake Ollama server the existing tests use.

## 8. Security requirements (the app's own)

- The app sends nothing by itself: no analytics, no crash reporting that leaves the phone, no update check beyond the one the desktop has (off until the user says yes).
- Credentials: the phone's own cookie (1a) and, from phase 3, the Keystore key only. Nothing in logs, nothing in a URL the app keeps, nothing in the backup (`allowBackup=false`).
- The WebView only ever shows the computer's host (or the demo); other links leave to the phone's browser.
- The on-device entry says what it is (chat only, no tools) and that the model's words are the model's.
- The app adds no permissions beyond `INTERNET`, camera (scan only, asked when used), and `ACCESS_NETWORK_STATE`.

## 9. Risks

- **The WebView may not accept a client certificate from a Keystore key (S4).** Mitigation: D5(b), at the cost of a native proxy and more code.
- **Cleartext ranges may not be nameable (S1).** Mitigation: a range check in code.
- **Background kills the WebSocket.** The page reconnects on its own; check that a message typed while away is not lost (the queue is on the server; the page must show it after reconnecting).
- **The demo is large (about 0.7 MB compiled renderer plus the page) on a low-end phone.** Check the draw time on the A54 and an older device before phase 2 is called done.
- **Two releases to keep in step** (the computer app and the APK). The APK's version is the same as the desktop's, and the phone page's protocol must not change without both.

## 10. Open questions for the owner

1. Capacitor now, or a PWA first (smaller, and no store-style packaging)?
2. An APK on GitHub Releases only (sideloading), or Google Play later (developer account, privacy policy, signing keys, review of an app that can drive a computer)?
3. Is the on-device entry worth building before the computer entry has been used on the A54 for a while? (Recommendation: yes, after phase 1 has run for a week.)
4. Minimum Android: API 26 (Android 8), or older phones matter?
5. Is it acceptable that the Android app's computer entry is the only one that can do work mode, and the on-device one stays chat only?
6. Layer 2 (phase 3): go after the S3 and S4 spikes, or only if the computer entry is used away from home?
