# Plan: an Android app

Status: a plan, nothing built. Written 2026-10-27, after the owner tried the browser demo and a phone-mode link on a Samsung Galaxy A54 and both worked well.

## Goal and scope

An installable Android app of the companion with two ways to get a brain:

1. **With a computer** (the phone mode we have: `--lan` or `/phone`, a token link, `src/lan.ts`): chat, approval cards, and **work mode**, which only exists here because the computer does the work.
2. **On its own**: chat only, the character drawn on the phone. The brain is an Ollama-compatible server the user already runs: on the same Wi-Fi (their computer's Ollama), or on the phone itself (Ollama or llama.cpp in Termux). No work mode, no tools, as the browser demo today.

Out of scope for now: a model inside the app (LiteRT, MediaPipe, llama.cpp as a plugin), opencode on the phone (a command-line program Android does not run), Google Play, push notifications, iOS.

## What we already have

- The page is plain HTML and JS over a WebSocket: it runs in an Android WebView as it is (the owner's A54 test of the phone link).
- The browser demo (`demo/`) is the whole app with no server: `local-socket.js` answers the page, `render-bridge.js` draws her with the creator's compiled TypeScript (0.7 MB), `public/script.js` is the built-in reader, and `demo/ollama.js` already chats with an Ollama at a configurable `url` (chat only, streams `/api/chat`). So "on its own" is the demo plus a settable address and the packs, not new code in the drawing or the brain.
- Phone mode's safety rules (`remoteSockets`: no `!command`, no Auto or Accept edits, no `/setup`, `/skills`, `/chrome`, no card import) are enforced by the server, so a thin client cannot lift them.

## The design: one app, one connect screen

A Capacitor shell (a WebView plus a small native layer) with two entries behind a first screen:

- **Connect to my computer**: the user pastes or scans (QR) the link `/phone` shows. The app keeps the host and the token (Android's encrypted preferences), opens `http://<host>:<port>/` in the WebView with the cookie set, and offers the saved computer next time. This is the existing phone page; the app adds an icon, full screen, a saved connection and a way back to the connect screen.
- **Use it on this phone**: the staged demo (`node demo/stage.mjs`, shipped as the app's own assets, so it works offline) with a settings field for the Ollama address (default `http://localhost:11434`, for a Termux Ollama; or `http://192.168.x.x:11434` for the computer's).

Why Capacitor and not a home-screen page: an installed page already works, but only the shell can keep the connection in encrypted storage, allow plain `http` to a home network without telling the user to change browser flags, scan the QR code, and ship the demo as offline assets. If none of those matter to the owner, a PWA manifest on the existing page is the smaller first step (it needs a manifest and a service worker, nothing native).

## Things to settle before building (each is a small test on the A54)

1. **Plain http to a LAN address.** Android blocks cleartext by default. The usual answer is a network-security config; whether it can name private ranges (not just host names) is to be checked, otherwise the app allows cleartext and itself refuses a non-private host (10/8, 172.16/12, 192.168/16, `.local`, Tailscale 100.64/10) before it loads anything.
2. **Cookie and WebSocket from a WebView** to a LAN origin: the server checks `Host` and `Origin` (`src/server.ts`), so the app must load the page from the computer's own origin, not from a bundled file calling out.
3. **Ollama from the on-device entry.** A WebView page on `https://localhost` calling `http://<lan>:11434` is blocked as mixed content and needs `OLLAMA_ORIGINS`. The shell's native HTTP plugin avoids both. Check streaming works through it (`/api/chat` is NDJSON).
4. **Packs.** Downloaded packs go in the app's storage (they are tens of MB): the demo's `remote-packs.js` fetches by URL and keeps them in the page's cache; confirm it survives the WebView being cleared, or move it to the shell's file storage.
5. **Voice** (the browser's speech recognition) in a WebView: probably absent. Hide the microphone button there.

## Phases and what "done" means

1. **Shell and connect** (small). Capacitor project in `android/`, the connect screen, QR scan, saved connection, the computer entry working against a real `--lan` server on the A54. Done: chat, an approval card and a work-mode edit from the phone, after closing and reopening the app. A GitHub Actions job builds an APK (unsigned or debug-signed, said plainly) attached to the release like the desktop installers.
2. **On its own** (small to medium). The staged demo as assets, the Ollama address field, the model chooser from `demo/model-dialog.js`, packs on the phone. Done: with Ollama on the same Wi-Fi, she chats and animates with her pack, and with no network the built-in script still answers.
3. **Polish.** Notifications when a reply finishes in the background, finding the computer by name, a proper icon and splash, the docs page.

The missing-tag fallback (`src/intent.ts`) does not exist on the on-device entry, since the demo's stand-in server does not run the turn service. Add it there only if small models turn out to skip tags often.

The phone side of the connection (pairing, a key kept in the Android Keystore, a pinned TLS certificate, and what a paired phone may ask the computer for) is in `docs/phone-security-plan.md`; phase 1 here ships the connect screen with the existing token, and moves to that pairing when it exists.

## Safety and wording

- The app sends nothing anywhere by itself. The token is stored only in the app's private storage, never logged, never put in a URL that is kept (the first visit removes it from the address, as for a browser).
- The on-device entry says what it is: chat only, no tools, the model is the user's own and so is what it says.
- The docs say what the unsigned APK means (sideloading, "install unknown apps", a warning) the way the Download page does for the desktop installers, and that there is no store release yet.
- `site/pages/phone.md` gets an Android section; `AGENTS.md` gets one paragraph on `android/`.

## Open questions for the owner

- Capacitor now, or a PWA first?
- An APK on GitHub Releases only (sideload), or Google Play later (a developer account, a privacy policy, signing keys, and a review of an app that can control a computer)?
- Is the on-device entry worth it before the computer entry is used on the A54 for a while?
