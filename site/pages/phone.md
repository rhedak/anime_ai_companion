---
description: Carry on a session from your phone over your own network, with a QR code and a secret token.
---

# From your phone

`anaico --lan` (or `npm start -- --lan`) also lets other devices on your network in, so you can carry on a session
from your phone while the computer does the work. In the desktop app, type `/phone` and answer **Turn on**. It is **off
at every start**: you ask for it each time, like a looser permission mode.

![The chat on a phone](assets/phone.png)

## Connect

1. **Start with `--lan`, or type `/phone` and answer Turn on** (your system may ask once to allow incoming
   connections). It shows a few links ending in `?t=<token>`, one per way the phone can reach the
   computer: the Wi-Fi address first, then other addresses such as Tailscale, then its `.local` name, with a
   **QR code** for the first one. Type `/phone` again to see them again.
2. **Open the link on the phone**, on the same Wi-Fi or on your private network. The first visit signs the phone
   in (a cookie) and removes the token from the address.
3. **`/phone new`** makes a new token and signs every phone out. **`/phone off`** turns phone access off again.

## What a phone can do

Chat, answer the approval cards, stop her, switch between chat and work in the saved folder, and change her look.

What it cannot do, because these run without a card or reach into the computer: `!commands`, the loose permission
modes (Auto, Accept edits, Run everything), `/setup on`, `/skills on`, importing or resetting a character card, opening
her notes file, and picking another project folder. Those are done on the computer itself. Typing while she answers
(the queue) works from a phone; the microphone button does not, because browsers only allow a microphone on `localhost`
or HTTPS.

## Talking to her from a phone

Use the microphone key on your phone's keyboard to dictate into the message box. A built-in mic button is not
included (see [Voice](chatting.html#voice) for why), but her voice works on the phone: turn **Voice** on and pick one
of the phone's own voices.

## The layout on a phone

On a narrow screen she is above the chat, with a bar between them to drag up or down (double-tap resets it). The
button in the chat's header puts her **behind** the chat instead: the chat takes the whole screen and she shows
faintly through it. Dragging the bar on past the smallest she gets does the same. The menus (brain, model,
permissions) open as a sheet from the bottom that scrolls when the list is long.

![She shows through the chat, behind it](assets/phone-behind.png)

## Away from home

The token is a password, and the connection is plain `http`, so use it only on a network you trust (not café
Wi-Fi), and not through a tunnel you do not control. For use away from home, put the computer and the phone on a
private network such as Tailscale and use the computer's address there; `--lan` lists it among the links. The token
is saved in `data/lan-token`, readable only by you.

## If the page does not load

- `ERR_ADDRESS_UNREACHABLE` means the network is in the way, not the app. Turn off a VPN on the phone.
- Look for "client isolation" or "AP isolation" in the router's Wi-Fi settings. It lets Wi-Fi devices reach the
  router but not each other.
- macOS asks once whether `node` may accept incoming connections: allow it.
- On the phone's plain-`http` page the browser withholds the clipboard, so the copy buttons do nothing there.
