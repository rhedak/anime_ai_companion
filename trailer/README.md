# The trailer

Scripts that record the promo video from a real run of the app, so any scene can be taken again.

```bash
node trailer/make.mjs miku    # Miku (hook), then Risa: trailer/out/trailer-miku-draft.mp4
node trailer/make.mjs risa    # Risa only, the backup:   trailer/out/trailer-risa-draft.mp4
node trailer/compose.mjs      # the tightened cuts (per-scene speeds): trailer/out/trailer-{miku,risa}-cut.mp4
ONLY=06-phone node trailer/make.mjs miku   # record just one scene again, then run compose.mjs
```

What it does: copies the app into `trailer/.stage/` with its own empty `data/`, a demo project in `/tmp/my-site`, and
the server on port 3801 (never your own data or port). It opens a phone-sized headless Chrome (360 × 640 at 3×, so
1080 × 1920), drives the page like a person (typing, taps with a ripple, a dragged divider), talks to a real model
(`opencode` free tier by default) and records Chrome's screencast, one clip per scene, into `trailer/out/`. The
wait for a first word is left out of a clip; the words on screen are the model's own. Where a take depends on the
model doing something (changing her look), the scene is taken again until it did.

It needs `ffmpeg`, Google Chrome, and `opencode` signed in. Captions are burned in by `overlay.js`; the credits on the
end card are in `make.mjs`. Music is not included: add a royalty-free track in your editor and put its licence on the
end card. `trailer/out/` and `trailer/.stage/` are git-ignored.

The /phone scene never shows this computer's real addresses or its name: the page is handed placeholder links and a QR
code for a made-up address (`__fakePhone` in `make.mjs` and `overlay.js`). Before publishing, scan the finished video
for anything personal (the checks used: `tesseract` over frames at 3 per second, searching for names and addresses).
