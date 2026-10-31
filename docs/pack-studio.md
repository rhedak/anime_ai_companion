# Pack studio: redraw packs, make new ones and new activities from inside the app

Status: **milestones 0 to 3 built** (2026-10-24): `/studio`, the question, four base pictures, the whole pack, review and install, resume, and the brain's help with the words. Milestones 4 and later are still design. This file is the plan to iterate on; each milestone ends at something the owner
can try in the running app. It keeps every rule in `AGENTS.md` ("Safety"). What the image models can and cannot do, and the numbers
behind that, are in [`pack-image-models.md`](pack-image-models.md); how to make a pack by hand is in [`frame-packs.md`](frame-packs.md).

## What it is

The user asks the app to make **a picture pack of their own on their computer**: a new outfit for a character they have (a redraw of an
existing pack in another look), a new pack from a description, or a new activity loop for an outfit. The result is an ordinary folder in
`data/frames/<name>/`, which `/frames <name>` already understands. Nothing published is ever overwritten, and nothing leaves the
machine unless the user picked an image service that is not local.

It is **not**: a way to make packs for the shared repository (those still go through the packs repository and its review), a content
filter, or an agent that is free to run commands. The drawn avatar and everything that exists today stay as they are.

## What we learned making the Risa (casual) pack, and what that means here

| Lesson | Consequence for the design |
| --- | --- |
| The model makes pictures, but what made the pack usable was **fixed code around it**: paste back only the face box, matting for the cut-out, seam and clipping checks, retries by seed. | The brain never edits pixels. A **job runner** does, with the checks built in. |
| A hard colour key left fragments; closed-form alpha matting (`tools/pack-crop/`) fixed it. | The cut-out is part of the runner and **ships in the app**: it is TypeScript (a known-background matting that needs no solver), measured against the Python matting (`tools/pack-crop/`) on the Risa pictures. |
| One picture took four batches over four prompts; another needed a different base. | Every step has a retry budget (3 seeds, then flag), and the user reviews a contact sheet. **Drafts, not promises.** |
| A person must look at hands, eyes and edges at zoom. | The review step is part of the feature, not optional. The user is the final judge, always. |
| The 4-step FLUX.2 klein 4B needs about 22 GB of GPU memory and 12 s a picture (Apple M5 Max, 128 GB). Nothing else was measured. | Many users cannot run it. A web image service must be a first-class second backend, and the doc says what was and was not measured. |
| The lively loop came from a video model reached through a browser. | Activities come last, and the browser route (somebody's login) is **not** part of the app. |

## Parts

```
page (Looks → Packs… → "Make a pack")  ──ws──►  server (src/studio-service.ts)
                                                   │  spawn, one job at a time, killable
                                                   ▼
                              job runner (src/studio/, a worker thread)  ──►  image backend
                                  steps, checks, cut-out, contact sheet        (local server or web API)
```

1. **Image backend** (the part that draws). A small interface, `generate` (text to picture) and `edit` (picture + prompt to picture), with
   a seed, a size and a model name. Two kinds, chosen in settings:
   - **local**: a loopback HTTP server that the user runs. We keep a reference one in the repository (`python/pack_studio/server.py`,
     diffusers, FLUX.2 klein 4B at a pinned revision, the settings in `pack-image-models.md`); it is **not bundled** (weights of about
     22 GB and a Python environment cannot be). Anything that speaks the same tiny protocol works (ComfyUI behind an adapter, Ollama if
     and when it serves image editing: not checked). One model in memory at a time.
   - **web**: an adapter per service (an API key from the environment, `COMPANION_IMAGE_KEY`; never saved by the app, never in settings,
     never in the chat, never sent to the brain). Which services: open question 3.
2. **Job runner** (the part that makes a pack). TypeScript in `src/studio/`, **bundled with the app** and run in a worker thread (as the
   drawing is), so cancelling is `terminate()` and nothing extra is installed. It takes a **job file** (below) and a backend address, writes to a
   staging folder `data/studio/<job>/`, and reports progress as events. It owns the pipeline: base picture,
   face edits with paste-back, blinks and mouths, poses, cut-out, checks, contact sheet, retries within the budget. It is resumable (every
   picture is a file; a job that stopped continues from the files).
3. **Studio service** (`src/studio-service.ts`, same shape as `persona-service.ts`): the opt-in, the approval card, starting and stopping
   the runner, relaying progress, and installing the result. **The app still needs no Python**; only the user's own image backend does.
4. **The brain** (optional). Helps with words: turns "a winter coat, dark green" into the prompt for the outfit, writes `look.txt`,
   reads the runner's text report ("`thinking-talk3`: seam 22, check") and says what to retry. It has **no file or command tools** for
   this. Its skills are plain markdown the app hands it as a note for its next message (as with the persona, not in the cached system
   prompt): the lessons of `.claude/skills/pack-image-models/SKILL.md`, rewritten for the model that reads them.

**Why the UI comes first and the brain second.** A 3B local model may not write tags reliably (`AGENTS.md` says so for the emotion tags).
So the whole flow works from a plain form with no brain at all, using our tested prompt templates, and the brain only improves the words
and reads the report. A better brain gives better prompts and better retries; a poor one still produces a draft.

## The job file

One JSON document the service writes after the user has approved. The runner validates it and refuses anything unknown.

| Field | Meaning |
| --- | --- |
| `kind` | `redraw` (new outfit from an existing pack), `new` (from a description), `activity` (a loop for an existing pack) |
| `name` | The folder to write, `data/frames/<name>`: a valid pack name (`isPackName`), not an existing folder unless `replace` is set |
| `source` | For `redraw` and `activity`: the pack whose pictures are the reference (its `neutral` is the base) |
| `character` | The `character:` id for `look.txt`, so outfit switching and activities find it |
| `outfit` | The user's own words (untrusted text, length-capped), and the `look.txt` text the brain or the user wrote |
| `frames` | What to make: `core` (7 emotions with blink and three mouths, wave, cheer), or a subset, or `activity: <name>` |
| `backend` | `{ kind, url, model, revision }`, recorded in the result's `NOTICE.md` |
| `budget` | Retries per picture (default 3), a time limit, a size limit |
| `seeds` | Stored, so a run can be repeated |

The result adds `NOTICE.md` (made on this computer with this model; the model's terms apply; no claim of copyright beyond what the
user holds), `credit.txt` and a `STUDIO.json` with the job and every seed, so a picture can be regenerated by seed alone.

## The steps (what `redraw` does)

1. **Base.** Edit the source pack's `neutral` with the outfit prompt, four seeds. **The user picks one** (or asks for four more). Nothing
   else runs before this: it is the cheapest place to fail and the one every other picture depends on.
2. **Faces.** For each emotion, an edit of the base, only a box around the face pasted back (feathered), then blink and three mouths from
   that picture. Checks per picture: changes at the box edge, changes outside it, the seam score (`tools/pack-crop/build_pack.py`).
3. **Poses.** Whole-picture edits (a raised arm leaves the face box), the other arm named in the prompt, skin-pixel count for the lowered
   hand, retry by seed within the budget.
4. **Cut-out.** Generated on a flat colour, matted with `tools/pack-crop/`, one alpha per pose, faint-strand floor away from solid edges.
5. **Review.** A contact sheet in the page on a dark and a white backdrop, zoomable, every picture with its check line. Per picture:
   keep, or regenerate with the next seed. Pictures a check flagged and the budget could not fix are marked, and the user decides.
6. **Install.** The folder is written to `data/frames/<name>` (a rename from staging, like `pack-install.ts`), never over an existing
   folder: a name that exists gets a suffix, or the user chooses **replace**, which first moves the old folder to
   `data/frames/<name>.bak` (one level; a pack the installer put there carries `.pack-install.json` and is never replaced, only
   duplicated, so the update offer for it keeps working).

`new` swaps step 1 for a text-to-image base (more seeds, a character description, the user approves the base the same way) and adds the
rule that the character must be adult in the prompt template (as in `make-activity-pack`). `activity` is below.

## Activities

- **v1: image loops of 3 to 4 pictures**, a few poses edited from the neutral (swimming, cooking, reading with a book in hand), the
  last leading back to the first, played at 3 a second like the shipped ones. Checks: identity against the neutral, face unchanged.
- **Later: a long loop from a video model** through a web API that offers one (not a browser session, not a login of the user's).
  The key picture on a flat colour, the video, frames at 12 a second, the same matting (`build_loop.py`). Open question 4.
- The talking set (`activity-<name>-talk-N`) can come from the same face-patch step as the stills.

## Safety and responsibility

These follow `AGENTS.md` ("Safety") and the position in `pack-image-models.md` ("Safety and responsibility").

- **Off at every start**, enabled by a command or a switch (`/studio on`), **refused from a phone**, and refused while a conversation turn
  is running. `COMPANION_NO_STUDIO=1` removes it.
- **One approval card per job**, before anything runs: what will be made, the backend and model, a time and disk estimate, where it will
  be written, and **the notice that the user is responsible for what they generate and which image model they use.** The app adds no
  content filter and no refusal of its own, and does not tune anything toward explicit output; shipped packs stay SFW. A web backend's
  card also names the host that will see the pictures and prompts.
- **The brain has no new powers.** It can propose words; it cannot start a job, choose a path, spawn a program or read the key. The job
  file is written by the service, from the form the user confirmed, and the runner is started with a fixed command and no shell.
- **Untrusted text everywhere.** The user's description and the brain's words end up in a prompt and in `look.txt` (and `look.txt` ends
  up in her system prompt): strip markup and our own tags, cap lengths, show the final text on the card, as for a character card.
- **Paths.** The runner writes only under `data/studio/<job>/` and the final rename; names pass `isPackName`; no path comes from the
  brain or the model.
- **Local first.** The reference backend binds `127.0.0.1` only and refuses other `Host` and `Origin` headers like the server does. It
  downloads weights only after the user says yes to a question that names the host (Hugging Face), the size and the licence, with a
  pinned revision and `local_files_only=True` afterwards (the loader rules in `pack-image-models.md`).
- **Cost and time.** A job states its estimate up front, can be **cancelled** at any moment (the runner is killed; the files stay for
  resuming), and never runs two backends at once. A web backend has a spending cap set in the job (picture count, not money: prices
  change) and the card says so.
- **Memory.** A local brain model and the image model compete for memory. The card says so; the runner warns when free memory is below
  the model's measured need and does not start.

## Tests

- A **fake backend** (a few lines of Node or Python, deterministic pictures from the seed) so the runner, the service, the cards, the
  cancel and the install are tested in CI with no GPU, no model and no network, like the fake `claude` and fake Ollama.
- The Python runner's pure parts (paste-back, seam score, matting, the contact sheet) get small synthetic-picture tests runnable with
  `uv run` and added to `check.sh` only when `uv` is present (`check.sh` already fails on skipped tests, so they are either run or not listed).
- A **manual in-app checklist** per milestone (below) with the real model, kept in this file; real-model runs are never in CI.

## The paid web backends (xAI Grok Imagine, Google Gemini, OpenAI)

`/studio backend xai` (or `gemini`) points the studio at a paid image service instead of a model on this computer (`paidBackend` in `src/studio/backend.ts`, one adapter per service: where it is, how a request looks, how the picture and the cost are read; a third, OpenAI, is built the same way). xAI first (the
endpoint and payload follow the `imagine` package's grok client: `POST https://api.x.ai/v1/images/edits`, the picture as a data URI, `b64_json`
back, `grok-imagine-image-2.0` at `1k`, the cost in `usage.cost_in_usd_ticks`). It is the one web service there is an adapter for, and it **costs money per picture**.

- **Gemini** (`gemini-3.1-flash-image` at `1K`, `COMPANION_GEMINI_MODEL` names another): `POST …/v1beta/models/<model>:generateContent` with the picture as an `inline_data` part, `x-goog-api-key`, the key from `GEMINI_API_KEY` (or `GOOGLE_API_KEY`, as in `imagine`). The answer carries no price, only token counts, so the cost is worked out from them with the published per-million-token prices kept in `GEMINI_PRICES` (checked against ai.google.dev/gemini-api/docs/pricing; update them when the prices change). A model that is not in that table is not metered, and the job stops after its first picture. Measured: 1 picture, about 6.8 cents.
- **OpenAI** (`gpt-image-2.5-sunburst`, `COMPANION_OPENAI_MODEL` names another; `OPENAI_API_KEY`): `POST …/v1/images/edits` as a form with the picture as a file, `quality: high` (what `imagine` uses for reference-guided work), and `size` set to the size of the picture sent (any size with sides in multiples of 16 is allowed, so nothing is stretched). The answer has token counts in `usage`, no price: the cost is worked out with the published per-million-token prices in `OPENAI_PRICES`. OpenAI may ask for an organisation verification before a GPT Image model can be used; its own error says so and is shown as it is.
- **The key** is `XAI_API_KEY`, `GEMINI_API_KEY` or `OPENAI_API_KEY`, whichever service is chosen, in the environment the app is started from (for example `~/.zshrc`; a daemon started without that file has no key
  and the studio says so). The app never writes it anywhere (not settings, not `data/`, not a job file, not the transcript), never sends it to the
  page or the brain, reads it at the moment of each call, puts it in one header to `api.x.ai`, and takes it out of every error text. The address
  `https://api.x.ai` is fixed; `COMPANION_XAI_BASE` (loopback http only) exists for tests.
- **Warnings.** `/studio on` and the approval card (*Draw 4 pictures (paid)*, framed) say that it is paid per picture, retries and *Draw again* included,
  that the source pictures and the words are sent to `api.x.ai`, what the limit is, and that keeping the key safe and paying the bill is the user's responsibility.
- **The limit.** Every paid call is counted from the service's own cost field and a pack may cost `studioBudgetUsd` in all (default $5; `/studio budget <dollars>`, 0.5 to 200). The call
  that would start past it is refused (so a pack can end one picture over), and the count is kept in `spend.json` in the job's folder, so a job carried on after a restart continues counting.
  A service answer without a cost stops the job after that picture (the limit cannot be kept blind). A busy service (429 or 503) is asked again twice; a failed call is not billed.
- **Before the pick** the page shows what the four pictures cost and, from that, what the rest would cost (if each passes first time, and if each needs three tries); picking is the yes to that.
  The panel shows "Paid so far: $x of your $y limit" while it draws.
- **No seed:** the service takes none, so a redraw is a new draw, as with the local backend in practice. Pictures that come back in another shape are resized to the job's size.
- Not built yet: pasting a key for one session (memory only), the service's price list, a second web service.

## The browser backends (grok.com/imagine and gemini.google.com through Claude in Chrome)

Drawing through the Grok Imagine website, with the user's own signed-in browser, instead of paying per picture through an API. Built (`src/studio/chrome-backend.ts`, `/studio backend grok-web`); the owner approved the design below on 2026-10-25. Measured once by hand: 11 browser calls and about a minute for one edit, about 10 000 tokens, the picture came back faithful as a 1312 x 1504 JPEG and the generation itself took under 10 seconds.

- **How:** a fourth kind of backend. `edit()` starts its own short-lived `claude -p --chrome` process (not the chat brain: forty pictures would fill the conversation) with one fixed task: upload this PNG, send this prompt, wait for the result, download it into the job's folder, say where it is. The cut-out, checks, retries, review and install are unchanged. Claude Code is the only brain that can drive Chrome reliably, so the studio needs `claude` installed and signed in whatever the chat brain is, and the extension signed into the same account with `grok.com` allowed.
- **Approvals (decided):** one approval card for the whole pack, instead of a card per browser action (about 15 to 25 actions a picture would be a thousand clicks). The studio's own process gets the Claude in Chrome tools pre-allowed, for that job only; nothing else (no shell, no file edit outside the job's folder) and no other site. This is the one deliberate exception to "each browser action comes through the approval card" in `AGENTS.md`, and it is written there with the code that adds it.
- **What the card says (decided):** it is not paid per picture but it is not free: it uses Claude (the plan's allowance, tokens for every screenshot and step) **and** the image site's own allowance; it is slow (minutes a picture, an hour or more for a pack); it drives the user's real browser on the user's real account; automating a consumer site may be against its terms and could put that account at risk (the user's responsibility); **the user stays at the computer while it runs** (it can be stopped at any moment, and a site that asks for a login, a captcha or a payment is not handled: the job stops and says so).
- **Limits:** at most 200 pictures asked for in one run and 8 minutes for one; the job stops on the first thing it cannot do rather than guessing (the agent answers `FAILED: …` and the studio shows it). Off at every start, refused from a phone.
- **What runs:** for each picture `claude -p --chrome --model sonnet` (`COMPANION_BROWSER_MODEL`) in `data/studio/<job>/web/`, the task on stdin (`recipe`: new tab, Image mode, upload the file, type the prompt between markers, Enter, wait, Post actions, Download, close the tab, answer `DONE <post id>`), with `--tools Read` and `--allowedTools mcp__claude-in-chrome__*,Read(<job>/web/**)` (the extension reads the file it uploads through the session's file permission, and with no built-in tool at all it refuses even the working folder; any other read is refused, there is nobody to ask), `--strict-mcp-config` and `--setting-sources ""` (nothing of the user's own setup). The app picks up `grok-image-<post id>.*` from the downloads folder (`~/Downloads`, or `COMPANION_BROWSER_DOWNLOADS`), keeps a copy as `web/out-N`, and removes its own download from the folder. The Chrome extension's own per-site permission for `grok.com` still applies.
- **Sites:** `grok-web` (Grok Imagine) and `gemini-web` (Google Gemini, "Create image" with the picture uploaded; free accounts work, with the free allowance of the account: a "limit reached" answer stops the job with Gemini's words). One site is one entry in `SITES` in `chrome-backend.ts`: where to go, the steps, and the name its downloads get (`grok-image-<post id>.*`, `Gemini_Generated_Image_*.jpeg`). By hand, Gemini took about 20 seconds a picture and gave the outfit well, but it added tights and boots below the skirt (the source is cut at the thigh), which the lower-body check may flag. ChatGPT (`chatgpt-web`, free account worked by hand: about 20 seconds a picture, the picture upload through the hidden "Attach photos" input, the download button in the viewer that opens when the picture is clicked; the file is named after a title ChatGPT makes up, so the pick-up takes any new picture in the downloads folder since the start) is the third. **Measured on the free account:** the sixth image of a day was refused ("You're out of images … wait for more tomorrow"), the agent reported those words and the job stopped with the base picture kept: a free ChatGPT account cannot carry a pack of about 40 pictures, only a base picture or a few.
- **Measured, to fix when it matters:** a picture comes back as a JPEG at about 1.5 times the working size; Grok opens on Video mode every time (the recipe switches it); the layout changes with the window size, so the agent reads the page instead of clicking fixed places.

## Tried and dropped: a script-driven Chrome for the website makers (2026-10-31)

The question: can the website makers work with brains other than Claude (Cursor, opencode, Ollama), which cannot drive Chrome? A spike drove the sites with a script instead of an agent: this app starts the user's Chrome with a profile folder of its own (Chrome 136 and later refuse a debugging port on the default profile, and copying a signed-in profile is not possible: the cookies are encrypted with the keychain), talks to it over the DevTools Protocol with Node's own WebSocket (no dependency), and does the fixed steps (open the site, attach the picture, type the prompt, wait, read the finished picture through the page). The code was written, run and **removed again**; it is not in the repository. What was found:

- **It can work, once.** A first ChatGPT run did everything end to end in a clean profile: file input, prompt, send, wait, the finished picture read by the page (`fetch` of the page's own image, a `blob:` address). The page structure, if it is needed again: ChatGPT puts the answer in `[data-testid="generated-image-gallery"] img` with `alt="Generated image N"`, and shows the uploaded picture as `alt="User attachment"` (taking "any big new picture" returns the upload, which was the first bug); the file input is `form input[type=file][aria-label="Attach photos"]`; the composer is `form [contenteditable][role=textbox]`; a signed-in page has `button[aria-label="Open profile menu"]`. Grok Imagine: the prompt box is a ProseMirror editor (`.ProseMirror[contenteditable=true]`), the mode is `button[role=radio][aria-label=Image]` (`aria-checked`), the one file input is `form input[type=file][name=files]`, the post page is `/imagine/post/<id>` and the finished picture is the `img` whose `src` has `/generated/<id>/image.jpg` (readable by the page, 1312 x 1504).
- **The sites notice it.** Signing in inside a window with a debugging port attached failed on both: Grok said "We've temporarily limited your login", ChatGPT showed a route error. A **plain window** (the same profile, opened with no port at all, the user closes it when done, then the app attaches) did sign in. But after a few script-driven sessions in a row ChatGPT answered "Unknown error", and then Cloudflare's "Verify you are human" check came up and reopened itself on every click: a browser with a script attached does not pass it. Getting past that is bypassing bot detection, which this project does not do, and it would break whenever a site changed its check.
- **On macOS, closing the last window does not end Chrome**, so waiting for "the sign-in window closed" needs the process to end (Cmd+Q) or a button in the app that ends it.
- **A free ChatGPT account** stops after a handful of images a day (see above), so it would not carry a pack either way.

Why the Claude in Chrome route does not hit this: it runs inside the user's own, normal, signed-in Chrome through an extension the user installed, with no debugging port. Result: the website makers stay Claude-only, and the other brains get the **assisted** route below (a person does the website step; the app does the rest) or a model on this computer or a paid API.

## The by-hand maker (2026-10-31)

The answer to "the other brains cannot drive Chrome" (see above): a maker that is the user. `/studio backend assisted`, or **By hand** in the Image maker list (always ready; free in this app). `src/studio/assisted.ts` is an `ImageBackend` whose `edit()` writes `assist/<n>-in.png` and `assist/<n>-prompt.txt` into the job's folder (a single picture's working folder for "draw one picture again"), calls `onAssist({ n, prompt, error? })`, and polls (400 ms) for `assist/<n>-out.png|jpg|jpeg|webp`, which it accepts once the size stops changing and the bytes decode as a picture. A file that does not decode is deleted and the same request is announced again with an `error`. The files are removed when the picture is taken or the wait is stopped. `maxTries: 1` (build.ts uses it instead of its three tries: every try costs the user time; a picture that fails a check is flagged in the review for the user to redo).

- **Why a folder:** the job runs in a worker thread and one picture runs in the main thread; a folder is the same hand-over in both, survives a page reload, and lets a user (or an agent) save the answer into it by hand.
- **The service** (`offerAssist`, `assistResult`, `clearAssist`): the worker sends an `assist` event (or the one-picture path calls `offerAssist` directly); the service reads `<n>-in.png` into a data URL and broadcasts `studio-assist` (`id`, `n`, `prompt`, `input`, `error`, `folder`, `text`); the state message carries the same as `assist`, so a reload shows it. The page's answer is `studio-assist-result { id, n, image }`: it must match the open request, fit 5 MB (`MAX_IMAGE_BYTES`), sniff as a PNG, JPEG, WebP or GIF and decode; it is re-encoded as PNG into `<n>-out.png`, and `studio-assist-done` clears the box. Anything else puts an `error` on the request and the box stays open. A job stopped, an error, a close and a single picture stopped (`frameAbort`, new for this maker: a wait with no limit must be stoppable) all clear it.
- **Cards:** one picture needs none (nothing leaves the computer from this app). A pack's card (`assistedNote`) says what is asked: about 40 pictures one after the other, each at the user's pace, that nothing is sent anywhere by the app, and that what the user gives a site is between them and the site. It is the cheapest way to try one picture or a few, and the most tiring for a whole pack.
- **The page** (`showAssist` in `public/studio.js`, styles `.studio-assist*`): a box at the top of the panel (and of the full studio page, which is the same code) with the words in a read-only box and a Copy button, the picture with Copy (clipboard image) and Save, a line of sites that work (links only; nothing is sent), a drop zone that also takes a paste anywhere on the page and a file chooser, the last error, and **Stop here**. The ring is not shown while it waits for a person. It is redrawn only when the request changes, so a state message does not take the user's place.
- **Tests:** `test/studio-assisted.test.ts` (files, answer, a bad file asked for again, abort), and two in `test/studio-service.test.ts` (one picture: no card, a bad file, a JPEG of another size, stop; a pack through the real worker: the card, the first request, the next request after the pick, stop). The tests answer through the same messages the page sends.
- **Not done:** nothing watches a folder the user chooses for downloads (the answer folder is the job's); a batch route (give several pictures at once) is not worth it while each picture depends on the one before it.

## Choosing the image maker in the panel

The panel has an **Image maker** list (top of the form; it is disabled while a job runs): a model on this computer (always listed: the last saved address, which `/studio backend <address>` sets, or `http://127.0.0.1:7861`; when nothing answers there, or the server says its weights are not downloaded, the studio shows the setup steps and the guide `site/pages/local-model.md` instead of an error), the three paid APIs, and the three websites through Chrome, each with what it costs. A choice is saved (`studioBackend`) and is what the next question, resume and "Carry on" use, so a job can start with one maker and go on with another (a base picture from one, the rest from another). Nothing is checked or started by choosing: the approval card names what will be used, and says if a key or Claude Code is missing. Refused from a phone and while a job is running (`chooseBackend`).

**What can be used now.** Each entry of the list says whether it can be used on this computer at the moment, and why not when it cannot: a model on this computer must answer its `/health` (asked every few seconds, never drawn with); a paid API needs its key in this app's environment (`XAI_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY`, `OPENAI_API_KEY`; the value is never read out or sent to the page); a website through Chrome needs Claude as the brain and `/chrome on`. Unusable entries are listed but cannot be picked. Handover needs nothing and is always there. When a model on this computer does not answer but its weights are in the Hugging Face cache (`HF_HUB_CACHE`, or `~/.cache/huggingface/hub`), the reason names them (Qwen-Image-2.1-Turbo, Qwen-Image-Edit, Z-Image-Turbo, Pony Diffusion V6 XL; `src/studio/local-models.ts`): finding weights starts nothing, so the backend still has to be started by hand.

## The full studio on its own page

The panel's **Open full studio** button (on this computer only) opens the same studio on its own page, `/studio-full.html`, in a new tab. In the desktop app that tab is the user's own browser, because the shell hands any other address out. It uses the same socket and the same rules as the panel (`public/studio-full.js` is a thin page around `public/studio.js`), so a job started in one is shown in the other. The page is refused to every other device, even with phone access on.

## Your own Python for a local model

The app bundles no Python, so a model on this computer is started by the user. `/studio python <whole path>` and `/studio server <whole path>` (`studioPython`, `studioServer` in `data/settings.json`; `none` clears one) say which Python and which server script are theirs. The commands and the paths alone start nothing: when the local model does not answer, the reason in the Image maker list and the setup help show the exact command (`<python> <server> --port <port>`) to run in their own terminal. Both are whole paths of an existing file, on one line, without quotes or `$` (`checkPath` in `src/settings.ts`). The setup guide is `site/pages/local-model.md` (it names which model has a server: only FLUX.2 klein 4B, and gives a prompt for an AI agent to do the setup). 

**Starting it from the panel.** The panel's "Start my own image server" section (the same two paths, a device of `mps`, `cuda` or `cpu`) starts the script as a child process (`src/studio/local-server.ts`): `<python> <script> --port <port> --device <device>`, no shell, in the script's own folder, on the port of the local address (loopback only; any other address is refused). A card shows the exact command, the port and the model folder and says what runs, and nothing starts before **Start it**. The child gets the app's environment without any variable ending in KEY, TOKEN, SECRET or PASSWORD. The panel shows its last 80 lines of output and whether it answers `/health` (30 seconds to answer, otherwise it is stopped and reported as failed); **Stop** ends it (SIGTERM, then SIGKILL after 3 seconds), and so does turning the studio off or closing the app's service. It is memory only: nothing is started at launch, a phone is refused like all studio messages, and an address that already answers is never started over.

## One picture again with a paid service or a browser maker

"Draw one picture of a pack again" works with whatever image maker is chosen. A model on this computer draws at once (it costs nothing). A paid service or a browser maker (Grok Imagine, Gemini or ChatGPT through Claude in Chrome) first shows a card with the same warning a whole pack gets, worded for one picture (`studio-frame-ask`, answered by `studio-frame-go`): nothing is sent before the yes, the yes covers that one picture only, and a paid call counts against the same limit. The picture is put on the key colour, the prompt names that colour (a model told only "the key colour" chooses its own background), the result is cut out and checked like a pack picture, and it is kept as a new pack only when the user says so. A browser maker's working folder lives in `data/studio/<id>-draw/` for the call and is removed afterwards. Tried once by hand with each browser maker (2026-10-31, one generation each, `happy` of `risa-dress`, "a red scarf around her neck"): Grok Imagine about 80 seconds, Gemini about 75 seconds, ChatGPT about 60 seconds. Each put on the scarf and left the rest as it was, and the checks passed. Nothing was left in the downloads folder.

## Import and export

The panel's last section copies a pack out to a folder, or a folder in as a pack (`src/studio/transfer.ts`). Both take the whole path typed in the box (no system dialog, so it works the same in the browser and the desktop app), both are refused from a phone like the rest of the studio, and neither ever writes over anything:

- **Export** copies the pack picked in the "draw one picture again" list into a new folder of its name inside the folder given. Only `.webp` pictures and `.txt` / `.md` files are copied (links are skipped); a pack must have `neutral.webp`. A `NOTICE.md` is added only when the pack has none, and no text file of the pack is ever replaced.
- **Import** copies a folder of the same kind into `data/frames/<name>`, adds a `NOTICE.md` that says it was imported, and refreshes the pack list. A name that is taken is refused.

A folder is capped at 600 files and 40 MB a file.

## The handover prompt

For a user with no image maker the studio can use: `/studio handover [outfit words]` (works with the studio off, only from this computer) and the panel's *Hand over to an AI agent…* button give a prompt (`src/studio/handover.ts`) to copy into any AI agent that makes pictures. It says what a picture pack is, the file names and rules in short, and links to the guide for agents on the site (`site/pages/agent-guide.md`, the long version: files, consistency rules, checks, what to hand back). Nothing is sent from the app; the user copies it, attaches the neutral picture, and installs the folder by hand (`/frames <name>`). The unreachable-local-model help names it as the way out.

## What is built, and how to try it

1. Start an image backend on this computer. The reference one: `uv run --with torch --with diffusers --with transformers --with accelerate --with sentencepiece --with pillow python python/pack_studio/server.py` (FLUX.2 klein 4B, weights already in the Hugging Face cache at the pinned revision; see the file's docstring). It loads the model on the first request and needs about 22 GB.
2. In the app: `/studio backend http://127.0.0.1:7861`, then `/studio on` (it checks the backend, says what it is and who is responsible, and opens the panel; when no maker works yet it says what is missing and opens the panel anyway, so its Image maker list is reachable on a first start, and drawing checks again). Pick a pack to draw from, a name and an outfit, and press *Draw outfits*; read the question; press *Draw 4 pictures*; pick one; wait for the rest (about forty pictures: 8 to 15 minutes on the machine it was built on, more with retries); look at the review (⚠ marks a picture a check flagged; *Draw again* redraws it and what was drawn from it); *Use this pack* writes `data/frames/<name>`, and *Show her as…* turns it on.
   In the panel the pointer over any small picture shows it at full size (beside the panel when the window is wide enough, else over the stage). The eleven pictures of the review (every emotion, then the poses) are drawn first and line up in the panel as each one is done, so a bad outfit can be seen, and the job stopped, within minutes; their blinks and mouths come after. The form starts from the pack she is wearing.
3. With a brain (chat mode), ask her for an outfit in plain words ("a burgundy cardigan over a cream blouse and a dark brown skirt, as a pack"). While the studio is on she is told, once per conversation, what it is and how to propose (`src/studio/skill.md`, the lessons of `pack-image-models` for the model that reads them, plus the packs she can draw from), and she may write `[studio outfit="…" name="…" look="…" source="…"]`. The page opens the form with those words in it and says they are hers; you change anything and press *Draw outfits* as usual. When a pack is ready she is given the check report as a note, and may suggest `[studio redraw="happy, shy"]`, which shows as a button *Draw … again* under the form. **She starts nothing**: the tag only fills in what you can read; a name that is not usable, a pack that is not there (the form then starts from the pack she is wearing) or a work-mode reply are left out (`src/studio-service.ts`, `propose`). With the studio off her words wait: the page asks *Turn on the pack studio?* with her outfit in the question, and the yes (from this computer only) turns it on and opens the form with them. Without a brain the form works the same.
4. A job survives a restart: `/studio on` offers *Carry on …* for a job that waits for the pick, is half drawn, or is ready to review (everything is on disk in `data/studio/<job>/`).

What the first real runs showed (Risa's dress pack, FLUX.2 klein 4B, Apple M5 Max): the model sometimes returns a broken pose (two copies of her stacked), repaints the backdrop near the face a slightly different pink, or changes an expression too little; the checks catch these and each picture gets three attempts, but a draft still needs a person's eye. Decoded pictures must be copied out of `sharp`'s buffers (a view onto them was overwritten, which looked like noise in the pictures).

## Milestones (each ends at something to try in the app)

| # | What is built | You can try |
| --- | --- | --- |
| 0 | The contracts: backend protocol, job file, event lines, report format; the fake backend; this file reviewed | read and change the design |
| 1 | Reference backend server; runner steps 1 to 2 for the **base only**; service with the opt-in and the card; the page shows progress and the four base candidates | "make Risa a winter coat": four neutrals appear, you pick one |
| 2 | The full `redraw`: faces, poses, cut-out, checks, contact sheet, per-picture regenerate, install under a new name | a complete casual-style pack from inside the app, then `/frames <name>` |
| 3 | The brain helps: the skill note, prompts from a request, `look.txt`, reading the report and suggesting retries; works with no brain too | describe an outfit in chat; compare a 3B and a 30B model |
| 4 | `new` from a description, with base choice and the adult rule; web image backend, one service | a pack from scratch; the same job on the web backend |
| 5 | Activities: 4-picture image loops and the talking set; the card names the cost | "a reading loop for this outfit" |
| 6 | A long loop from a video API; more backends; the shared-packs path documented (a generated pack is not published from here) | a 12-fps loop |

Rule for every milestone: it ships off by default, behind the opt-in, with the docs wording saying what it is (a draft maker), and with
`AGENTS.md` and `docs/frame-packs.md` updated in the same change.

## Open questions for the owner

1. **Python** (settled 2026-10-24: everything the app needs for this ships in the app, so the runner and the cut-out are TypeScript, and only
   the image model is external). Open: how close the TypeScript cut-out gets to the Python matting (measured in milestone 1).
2. **Where a redraw lands.** New name always (default in this doc), or may the user replace a pack of their own in place (with `.bak`)?
3. **Which web services** first (one that offers image editing with a reference picture, and, later, video)? Needs a licence and
   price check at the time, and a decision on keys: environment variable only (this doc), or a `data/` file the user can see and delete.
4. **Video.** Is a web video API acceptable for long loops, given that the one we used was a browser session with the owner's own login?
5. **Minimum hardware wording.** Only an Apple M5 Max with 128 GB was measured. Say "tested on" and nothing more until someone else has run it.
6. **Brain access to images.** Vision-capable brains could judge pictures; local ones mostly cannot. Do we let a vision brain see the
   contact sheet (with the existing image attachment path), or keep the review human-only?
7. **Naming and sharing.** A generated pack gets a `NOTICE.md` saying it was made on this computer; can the user share it? Proposed:
   their business under the model's terms, never through our repositories without the normal review.
8. **UI home.** A "Make a pack" button inside Looks → Packs…, or a separate studio page (`/studio`), given the length of a job.

## The stepper (2026-10-31)

The panel is a stepper, not one long form: what to do (a new outfit, or one picture drawn again), the pack to draw from (a thumbnail for each character, then for each of its outfits), what should change, who draws it, and a review that starts the job. A finished step is one line with *Change*. The studio opens on the last choices made in this browser (`studio-last` in local storage: the kind of work and the pack), one step from the start. The maker step opens only when the saved maker is not ready, and lists the makers in groups (on this computer, paid, through Chrome, by hand) with a cost for each; a Chrome maker that cannot run now is left out. While a job is drawn, waits for the pick or the review, the steps are hidden and the pictures are the page; Import, Export, the own image server and the agent handover are under *More…*. The full page (`/studio-full.html`) is 1100 px wide. The server's part is unchanged except that `studio-state` carries `characters` (which character each pack is an outfit of).

Not done yet: a thumbnail for each single picture of a pack in the redraw step (they are names today), and picking several pictures to redraw at once.
