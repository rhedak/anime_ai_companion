---
name: record-app-demo
description: Record a video of the running companion app (for a post, a README or a bug report) without touching the owner's screen, with a scripted stand-in brain so the take is repeatable. Use when the owner asks to record the app, make a clip or video of an animation, outfit change or activity.
---

# Recording the app

Do **not** use `screencapture` or a screen recorder on the owner's display: it shows their own windows (browser tabs, chats). Render the app's page in a **hidden, offscreen Electron window** and encode the frames with ffmpeg. `scripts/capture.cjs` does this: it loads a URL, types messages key by key at set times, and writes an H.264 file at 30 fps (1280 × 800 window, scaled to 1600 wide).

## Steps

1. **A throwaway server, never the owner's data.** Make a scratch folder with `data/`, `ws/`, `bin/`, `cfg/`. Put the packs the take needs into `data/frames/<pack>/` (copy from `../anime_ai_companion-packs/packs-src/`), and `data/settings.json` = `{"provider":"claude","framePack":"<start pack>"}`. For a character with outfits, install all the outfits an activity switches between (`activity: swimming = swimsuit` makes her change into the swimsuit pack, so it must be on disk), and start in the outfit you want the viewer to see first.
2. **A stand-in `claude`** in `bin/` so no real model runs and the words are scripted. Build it from the test helper's `STAND_IN` (`test/helpers/server.ts`: the template literal between `const STAND_IN = \`` and `\`;`), evaluate the template, and replace its last `else` branch (the "echo" branch) by a streamed reply: `delta("[emotion:happy] ")`, then words every 150 ms, then `result()`. Put the tags where the action should happen (`[activity swimming]`, `[activity dancing]`, `[outfit gown]`). Pick the reply from the typed text with a regex on `text` **after stripping the system note the app puts in front** (`/^\(system note, not from the user:[\s\S]*?\)\n\n/`; the note itself mentions every activity). Write it with the escapes right (a Python `replace` of the doubled backslashes is the usual fix) and test the regex in `node -e`.
3. **Start the server** (not the desktop app):
   `PORT=3801 ANAICO_DATA=$S/data ANAICO_WORKSPACE=$S/ws PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" STANDIN_LOG=$S/standin.log CLAUDE_CONFIG_DIR=$S/cfg COMPANION_NO_NUDGE=1 COMPANION_PACK_INDEX=off COMPANION_PROVIDER=claude node src/server.ts` in the background, `curl` it. Delete `data/transcript.json` between takes (a new take must start with an empty chat).
4. **Record**, from `app/` (Electron lives there): `CAP_OUT=$S/take.mp4 CAP_SECONDS=62 CAP_SEQUENCE='[{"at":3.5,"text":"let'"'"'s go swimming"},{"at":30,"text":"let'"'"'s go dancing"}]' ./node_modules/.bin/electron --user-data-dir=$S/capdata $S/capture.cjs`. The script closes the "Want a different look?" hint first. Allow a timeout of a few minutes for the tool call.
5. **Check it**: `ffmpeg -ss T -i take.mp4 -frames:v 1 x.png` at six to twelve moments, tile them with PIL and read the sheet: the outfit changes, the loop is moving (different poses in later stills), the stop button reads "End swimming" or "End dancing". The video is shorter than `CAP_SECONDS` by the start-up wait; do not ask for a still past the end.
6. **Hand over**: copy to the scratchpad with a plain name and `SendUserFile` (`display: attach`). Say what is scripted (the replies) and what is real (the app, the packs, the animations), that the footer reads `claude-stand-in` (crop it), and that an unpublished pack cannot be downloaded by viewers yet.
7. **Clean up**: kill the server on its port (`lsof -tiTCP:3801 -sTCP:LISTEN`); never touch the owner's dev app on 3738 or the installed app on 3737.

## Notes

- Typed characters go through `sendInputEvent({type:"char"})`; Enter through keyDown/keyUp. The page's input is `#input`.
- The pack avatar loop runs at about 3 frames a second; the talking set replaces it while she speaks and a speaking reply keeps her mouth moving.
- X takes up to 512 MB and 140 s; the output is about 15 MB per minute.
