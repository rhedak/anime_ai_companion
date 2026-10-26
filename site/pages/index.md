---
description: A face for your coding agent. A free, open-source anime character that fronts Claude Code, Cursor, opencode or Ollama on your own computer, asks before every command, plays tennis and dances, and can be drawn in new outfits that you make yourself.
wide: true
---

<div class="hero">
<div class="hero-copy">

# Anime AI Companion

<p class="lead"><b>A face for your coding agent.</b> A free, open-source anime character on <b>your own computer</b>, in front of Claude Code, Cursor, opencode or a local model. She asks before every command and answers from your phone. Drawn by code, she redraws herself on request; in picture packs she dances and plays tennis. And you can have new outfits made for her.</p>

<div class="btns">
<a class="btn primary" href="download.html">Download</a>
<a class="btn" href="demo/">Try the demo in your browser</a>
<a class="btn" href="https://www.youtube.com/shorts/E_4PIfWC-5U">Watch the trailer</a>
</div>
<p class="fine">Windows, macOS and Linux · MIT licence · no account, no telemetry, nothing hosted</p>

</div>
<div class="stage"><video src="assets/hero-activities.mp4" aria-label="Franzi dancing, Risa playing tennis and Risa splashing water at you: three activities of picture packs, animated" width="900" height="342" autoplay muted loop playsinline></video><p class="fine">Picture packs (pictures made with AI): Franzi dances, Risa plays tennis and splashes water at you.</p></div>
</div>

<div class="cards">
<div class="card"><span class="tag">Safe</span>

### She asks first

In work mode she reads, edits and runs commands in your project folder, and **every command and file change waits for you**, with the exact text or diff on a card. Your phone can answer the cards.

[Work mode](work-mode.html)

</div>
<div class="card"><span class="tag">Alive</span>

### She looks two ways

**Drawn by code**, she redraws her hair, eyes and clothes the moment you ask. **In picture packs**, she has polished art and **activities**: she dances, swims, cooks, reads and plays tennis with you.

[Two ways to look](#drawn-by-code-or-picture-packs)

</div>
<div class="card"><span class="tag">New</span>

### You dress her

Describe an outfit and the **pack studio** draws her a whole new set of pictures, with the image model you choose: one on your computer, an API key, or a website you already use.

[Make her an outfit](pack-studio.html)

</div>
</div>

## Drawn by code, or picture packs

<div class="split redraw">
<div>

**Drawn by code** is the character you meet first, and the default. She is a vector drawing made by code (the [anime-character-creator](https://github.com/rhedak/anime-character-creator)): hair, eyes, glasses, hats, a coat or a skirt are all parameters. She is not as polished as a picture pack, but **she can change anything, in an instant**: ask for "mint green hair" or "glasses and a witch hat" and she is redrawn on the spot, still blinking and talking, with every change reversible. The picture on the right is the app's own drawing, answered by its built-in script: no model was needed to change her.

**Picture packs** replace the drawing with sets of pictures made with AI, by someone else or by you: seven expressions with blinks and mouths, poses, and optional activities (below). The art is polished, but a pack is one outfit: it cannot change its hair or clothes, so another outfit is another pack. [Her looks](looks.html) · [Picture packs](picture-packs.html)

</div>
<div class="shot"><video src="assets/redraw.mp4" aria-label="The drawn Risa changes her hair to mint green, puts on glasses and a witch hat, changes her eyes and tips, and cuts her hair short, each time when asked" width="480" height="598" autoplay muted loop playsinline></video></div>
</div>

## She does things with you

In a picture pack that has one, an **activity** is something she does for a while instead of just talking. Ask her to play tennis and her picture turns into the loop below: the ball comes at you, she hits it back. Dancing, cooking, reading and swimming work the same way. The drawn character has none: they are pictures.

<div class="reel">
<figure><video src="assets/activity-tennis.mp4" aria-label="Risa hits a tennis ball toward you" width="300" height="342" autoplay muted loop playsinline></video><figcaption>Risa plays tennis</figcaption></figure>
<figure><video src="assets/activity-dancing.mp4" aria-label="Franzi dances in a dirndl" width="300" height="342" autoplay muted loop playsinline></video><figcaption>Franzi dances</figcaption></figure>
<figure><video src="assets/activity-swimming.mp4" aria-label="Risa splashes water toward you" width="300" height="342" autoplay muted loop playsinline></video><figcaption>Risa splashes</figcaption></figure>
<figure><video src="assets/activity-cooking.mp4" aria-label="Franzi cooks in a frying pan" width="300" height="342" autoplay muted loop playsinline></video><figcaption>Franzi cooks</figcaption></figure>
</div>

<p class="fine">Risa and Franzi are original characters, and their pictures were made with AI (MIT licence, details in each pack). Packs of other characters are downloads on request, never in this repository.</p>

## Make her a new outfit

The **pack studio** turns *"a dark green hooded coat over a white knitted sweater"* into a complete picture pack (a new outfit for a character, not a change to the drawn one): seven expressions with blinks and talking mouths, waves and cheers, all cut out and ready to wear. You pick the image maker, and a card says what it will use before anything is drawn.

<div class="split studio">
<div>

| Image maker | What it costs you |
| --- | --- |
| **A model on your computer** (a loopback server you run, such as FLUX.2 klein) | Nothing but time and about 22 GB of memory |
| **An API** (xAI, Google Gemini, OpenAI) with your own key | Paid per picture: the price is counted live and a limit per pack stops it |
| **A website you are signed in to** (Grok Imagine, Gemini, ChatGPT), driven through Claude in Chrome | No per-picture bill: it uses your Claude allowance and the site's. Slower; free accounts run out |

Every picture is checked (the face area, the background, the size of a pose) and tried up to three times, and you look at the whole pack before anything is written. In chat she can suggest an outfit, and you press the buttons: **she never starts it**. It is off at every start and a phone cannot turn it on.

<div class="btns"><a class="btn primary" href="pack-studio.html">How the studio works</a></div>

</div>
<div class="shot"><img src="assets/studio.png" alt="The pack studio panel: the image maker, the source pack, the outfit in words, and the finished set of pictures to review" width="532" height="952" loading="lazy"></div>
</div>

<div class="split">
<div>

### One character, many outfits

Risa's dress, casual and school outfits, and the green coat and the tennis outfit, which were drawn with the studio and published as packs. A pack is just a folder of pictures, so anything you make is yours to wear, keep or share.

[Picture packs](picture-packs.html)

</div>
<div class="shot"><video src="assets/wardrobe.mp4" aria-label="Risa in five outfits, one after the other" width="300" height="342" autoplay muted loop playsinline></video></div>
</div>

## A coding agent you can watch

![Work mode: she asks before an edit, and the card shows the diff](assets/work.png)

- **Approvals you can read.** Every command and file change waits for you, with the exact text. Looser modes are opt-in and come back to "ask" at every start.
- **Your brain, your login.** Claude Code, Cursor, opencode or a local Ollama model, on your own computer with the account you already have. [Brains](brains.html)
- **Carry on from your phone.** One flag lets your phone join the session over your own network and answer the cards. [From your phone](phone.html)
- **She redraws herself.** "Blue hair and glasses, please," while she is the drawn character. Save looks, switch to any of 19 built-in characters, or import a character card. [Her looks](looks.html)

## Start in a minute

**Easiest:** [download the app](download.html) (Windows, macOS, Linux) and open it, or [try the demo](demo/) first: a live Risa in your browser, nothing to install and nothing sent anywhere. From source you need Node.js 22.18 or newer and one brain (for example a signed-in `claude`):

```bash
git clone --branch v0.6.0 https://github.com/rhedak/anime-character-creator.git
git clone https://github.com/rhedak/anime_ai_companion.git
cd anime_ai_companion
npm install
npm start          # then open http://127.0.0.1:3737
```

Then try: *"Hi! Could you change your hair to mint green and put on a black witch hat?"* The full steps, and what to do when something does not start, are in [Getting started](getting-started.html).

## Private by design

Everything runs on your machine. The only thing that leaves it is the conversation your own brain sends to its provider (for Claude Code, to Anthropic; nothing at all with Ollama). The server listens on `127.0.0.1` only unless you ask for phone access, and work mode never skips an approval. [Safety and privacy](safety.html)
