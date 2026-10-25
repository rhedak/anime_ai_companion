<p align="center">
  <img src="site/assets/hero-activities.gif" alt="Franzi dancing, Risa playing tennis and Risa splashing water at you: three activities of picture packs, animated" width="100%"><br>
  <sub>Picture packs (pictures made with AI): Franzi dances, Risa plays tennis and splashes water at you.</sub>
</p>

<h1 align="center">Anime AI Companion</h1>

<p align="center">
  <b>A face for your coding agent.</b><br>
  A free, open-source anime character on <b>your own computer</b>, in front of Claude Code, Cursor, opencode or a local Ollama model.<br>
  She asks before every command and answers from your phone. Drawn by code, she redraws herself on request;<br>
  in picture packs she dances and plays tennis. And you can have new outfits made for her.
</p>

<p align="center">
  <a href="https://rhedak.github.io/anime_ai_companion/demo/"><b>▶ Try the demo</b></a> &nbsp;·&nbsp;
  <a href="https://rhedak.github.io/anime_ai_companion/download.html"><b>Download</b></a> &nbsp;·&nbsp;
  <a href="https://rhedak.github.io/anime_ai_companion/">Documentation</a> &nbsp;·&nbsp;
  <a href="https://www.youtube.com/shorts/E_4PIfWC-5U">Trailer</a>
</p>

<p align="center">
  <img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue">
  <img alt="Node.js 22.18 or newer" src="https://img.shields.io/badge/node-%E2%89%A522.18-brightgreen">
  <img alt="Windows, macOS, Linux" src="https://img.shields.io/badge/runs%20on-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-lightgrey">
  <img alt="No telemetry" src="https://img.shields.io/badge/telemetry-none-success">
</p>

The **demo** is a live Risa in your browser: nothing to install and nothing sent anywhere.

## What makes her different

| | |
| --- | --- |
| **She asks first.** | In work mode she reads, edits and runs commands in your project folder, and **every command and file change waits for you**, with the exact text or diff on a card. Looser modes are opt-in and come back to "ask" at every start. A phone on your network can answer the cards. |
| **She can look two ways.** | **Drawn by code** (the default), so she can change her hair, eyes, glasses and clothes the moment you ask, or in **picture packs**: sets of pictures (made with AI) with polished art and activities such as dancing and tennis. [Both below.](#two-ways-she-can-look) |
| **You dress her.** | The **pack studio** draws a whole new picture pack from an outfit you describe, with an image model *you* choose: one on your computer, an API key, or a website you already use. A card says what it costs before anything is drawn. |
| **Your brain, your login.** | It runs on your own computer with the agent you already use. Nothing is hosted, and there is no telemetry. |

## Two ways she can look

| | Drawn by code (the default) | Picture packs |
| --- | --- | --- |
| **What it is** | A vector drawing made by code ([anime-character-creator](https://github.com/rhedak/anime-character-creator)): hair, eyes, glasses, hats and clothes are parameters. | A folder of pictures: the seven expressions with blinks and mouths, poses, and optional activities. Pictures made with AI, bundled, downloaded on request, or made by you. |
| **Strength** | **She can redraw herself in an instant**: "mint green hair", "glasses and a witch hat". Every change is reversible, looks can be saved, and there are many built-in characters. | Polished art, a fixed outfit per pack, and **activities**: dancing, swimming, cooking, reading, tennis. |
| **Limit** | Simpler, less polished. | A pack cannot change its hair or clothes: another outfit is another pack (the studio makes them). |

<table>
  <tr>
    <td valign="top">
      <b>Drawn by code.</b> The picture shows the app's own drawing, answered by its built-in script: no model was needed to change her. Ask for "mint green hair" or "glasses and a witch hat" and she is redrawn on the spot, still blinking and talking.
    </td>
    <td width="330"><img src="site/assets/redraw.gif" alt="The drawn Risa changes her hair to mint green, puts on glasses and a witch hat, changes her eyes and tips, and cuts her hair short" width="330"></td>
  </tr>
</table>

### Picture packs and their activities

An **activity** is something a pack's character does for a while instead of just talking. Ask her to play tennis and her picture turns into a loop where the ball comes at you and she hits it back. These four are picture packs (original characters, made with AI).

<table>
  <tr>
    <td align="center"><img src="site/assets/activity-tennis.gif" alt="Risa hits a tennis ball toward you" width="200"><br><sub>Risa plays tennis</sub></td>
    <td align="center"><img src="site/assets/activity-dancing.gif" alt="Franzi dances in a dirndl" width="200"><br><sub>Franzi dances</sub></td>
    <td align="center"><img src="site/assets/activity-swimming.gif" alt="Risa splashes water toward you" width="200"><br><sub>Risa splashes</sub></td>
    <td align="center"><img src="site/assets/activity-cooking.gif" alt="Franzi cooks in a frying pan" width="200"><br><sub>Franzi cooks</sub></td>
  </tr>
</table>

Risa and Franzi are original characters, and their pictures were made with AI (MIT licence, details in each pack). You can make packs like these with the pack studio; the drawn character above is code, not pictures.

## Make her a new outfit

The **pack studio** turns *"a dark green hooded coat over a white knitted sweater"* into a complete picture pack: seven expressions with blinks and talking mouths, waves and cheers, all cut out and ready to wear. Risa's green coat and tennis outfits were drawn this way.

<table>
  <tr>
    <td valign="top">

| Image maker | What it costs you |
| --- | --- |
| **A model on your computer** (a loopback server you run, such as FLUX.2 klein; [how to set it up](site/pages/local-model.md)) | Nothing but time and about 22 GB of memory |
| **An API** (xAI, Google Gemini, OpenAI) with your own key | Paid per picture: counted live, with a limit per pack |
| **A website you are signed in to** (Grok Imagine, Gemini, ChatGPT), driven through Claude in Chrome | No per-picture bill: it uses your Claude allowance and the site's. Slower; free accounts run out |

Every picture is checked and tried up to three times, you look at the whole pack before anything is written, and in chat she can suggest an outfit but **never starts it**. It is off at every start. None of these suits you? `/studio handover` gives you a prompt to copy into any AI agent that makes pictures, with a [guide for agents](site/pages/agent-guide.md). [How the studio works](docs/pack-studio.md)

</td>
    <td valign="top" width="300"><img src="site/assets/wardrobe.gif" alt="Risa in five outfits, one after the other" width="300"><br><img src="site/assets/studio.png" alt="The pack studio panel with a finished set to review" width="300"></td>
  </tr>
</table>

## A coding agent you can watch

![Work mode: before an edit she asks, and the card shows the diff](site/assets/work.png)

- **Approvals you can read.** Every command and file change waits for you, with the exact text.
- **Carry on from your phone.** One flag (`--lan`), or `/phone` in the desktop app, lets your phone join the session and answer the cards.
- **A companion too.** Chat mode is a friend with a face: character cards, her own notes about you, an optional microphone.

```
browser ──ws── Node server ──┬─ a brain: Claude Code, Cursor, opencode or Ollama   (the persona and the tools)
                             └─ a worker thread (src/render-worker.ts)             draws her, via anime-character-creator
```

**Documentation: <https://rhedak.github.io/anime_ai_companion/>** (the same material as below, with pictures and a menu).
**Made with AI coding agents, mostly Claude Code; the documentation was written by Claude Code:** see [How this was made](#how-this-was-made).

It is free to use, change and share (MIT). Everything runs on your machine; the only thing that leaves it is the
conversation your own brain sends to its provider (nothing at all with Ollama), and, if you turn on the microphone
button, the recording your browser's speech recognition sends to the browser maker. The desktop app can, only if you say yes, ask GitHub once a
day whether a newer version exists (it never installs anything).

## Requirements

- **Node.js 22.18 or newer** (it runs the TypeScript directly, no build step). Many systems ship an older one, and `npm install` itself
  refuses it; with [nvm](https://github.com/nvm-sh/nvm): `nvm install 22 && nvm use 22`
- **One brain** (without one she runs a small built-in script: she can change her look, show moods and wave, but not really talk, and says so
  when you open the page), installed and signed in: [Claude Code](https://code.claude.com) (`claude`), Cursor (`cursor-agent`), opencode,
  or [Ollama](https://ollama.com) for a local model
- A checkout of **[anime-character-creator](https://github.com/rhedak/anime-character-creator)** (the drawing code) next to this repo,
  at the release this version pins (the Quick start does that), or point `CREATOR_SRC` at its `ts/src` folder (the creator's TypeScript draws her, in the app's own process: no Python is involved). Without either, the app downloads
  the pinned release itself on the first start

## Quick start

```bash
git clone --branch v0.7.0 https://github.com/rhedak/anime-character-creator.git
git clone https://github.com/rhedak/anime_ai_companion.git
cd anime_ai_companion
npm install
node bin/anaico.js --doctor   # optional: says what is missing (Node, a brain, the creator, the port)
npm start          # then open http://127.0.0.1:3737
```

The first line takes the creator release this version was made for (`--branch`); its `main` may be ahead of it. Nothing else needs installing:
the app draws her with the creator's TypeScript, so there is no Python to set up. (Python is only for the optional picture-pack tools under
`python/`, which `docs/frame-packs.md` describes.)

**On a Mac**, `npm run dist:mac` in `app/` builds a double-clickable app (a `.dmg` and a `.zip`, for Apple Silicon and Intel) with everything inside; it is the same desktop shell as on Windows ([app/README.md](app/README.md)).

**On Windows**, download the repository as a ZIP (or clone it), unpack it and double-click `windows-start.bat`: it installs Node.js and the
free opencode brain if you say yes, fetches the character creator, and opens the page. [docs/windows.md](docs/windows.md) has the steps.
Windows support is new and has had little testing; please report what breaks.

Try: *"Hi! Could you change your hair to mint green and put on a black witch hat?"*

## Configuration

| Env var | Default | |
| --- | --- | --- |
| `COMPANION_MODEL` | `haiku` | model used for chat |
| `COMPANION_WORK_MODEL` | `sonnet` | model used in work mode |
| `COMPANION_PROVIDER` | `claude` | `claude` (Claude Code), `cursor` (Cursor agent), `opencode` or `ollama` (local models); also switchable in the UI |
| `COMPANION_OPENCODE_MODEL` | opencode's own default | model for opencode, `provider/model` (e.g. `opencode/big-pickle`) |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | where Ollama is listening |
| `COMPANION_OLLAMA_TOOLS` | unset | model names (comma separated) or `all` that you vouch can use tools, when your Ollama cannot report it |
| `COMPANION_OLLAMA_CTX` | `16384` | context size asked of Ollama in work mode with tools |
| `OLLAMA_MODEL` | first installed | model to use with Ollama. A model you name here is saved to `data/settings.json` like a pick in the menu; the first-installed default is only used, never saved |
| `COMPANION_PRESET` | `risa` | starting character (any preset of the creator) |
| `CREATOR_SRC` | `../anime-character-creator/ts/src` | the creator's TypeScript folder (its `ts/src`), which draws her |
| `ANAICO_HOME` | `~/.anaico` | where the pinned creator copy is cloned when none is found next to this repo |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code's own folder, which she reads sessions and skills from |
| `CURSOR_AGENT` | `cursor-agent` | the command that starts the Cursor agent |
| `OPENCODE_BIN` | `opencode` | the command that starts opencode |
| `PORT` | `3737` | |
| `COMPANION_NO_SHELL` | unset | set to `1` to turn off the `!command` box (see Security model) |
| `COMPANION_NO_NUDGE` | unset | set to `1` to silence the friendly reminder below |
| `COMPANION_PACK_INDEX` | the packs repository's list on GitHub Pages | https address of `packs/index.json` for packs that can be downloaded; `off` skips it. See `docs/pack-archives.md` |

## Voice

The **Voice** button makes her read her replies aloud with your browser's own speech synthesis. She speaks
sentence by sentence while the reply streams, and her mouth moves while she speaks. With Voice on, two menus
choose the **voice** and the **speed**; both are remembered in the browser. System voices are made on your device and
nothing is uploaded; a voice marked **online** (desktop Chrome's "Google …" voices) is made by a server, which
receives the text. **Speaking to her** is an opt-in: a microphone button next to the attach button
(where the browser has speech recognition) asks first, because in Chrome, Edge and Safari your recording is sent to the browser
maker's servers to be turned into text. This app's server never receives audio. It listens for one phrase while the button
is lit, and puts the words in the message box for you to check; nothing is sent by itself. Microphones need `localhost` or
HTTPS, so on a phone over plain `http` use the keyboard's microphone key. To change the voice itself (pitch, a voice per
character, a local TTS engine), edit `public/speech.js` in your own checkout; the
[customising page](https://rhedak.github.io/anime_ai_companion/customising.html#her-voice) has ideas.

## Looks: undo, save, load

She can redesign herself at any time, so it is reversible: **Undo** steps back through her recent
changes, **Save look** stores the current look by name, and the **Looks** menu loads one, or opens **Presets…**, a gallery with a preview of each of the 19 built-in characters (Undo brings the old look back). She can load
a saved look herself too (`[avatar load=name]`). Saved looks are plain files in `data/looks/`; delete a
file to delete a look.

She is drawn in the creator's **soft finish** by default (gradients in the eyes and blush, tinted lines, tone clumps in the hair),
which sits closer to a picture pack than the flat house style. It is only a starting value: ask her for `finish=flat` (`[avatar finish=flat]`)
to turn it off, or `highlight_strength=0.5` (0 to 2, 1 by default) for softer hair, and a look that says `flat` stays flat (one saved before the finish existed has chosen nothing, so it is drawn soft too).
The soft finish needs the creator at v0.3.0 or newer; an older creator draws the flat style and nothing is set.

## Your own pictures instead of the drawn avatar

If you would rather show her as pictures from an AI image tool (or your own drawings), put a set of images
in `data/frames/<name>/` and pick it from **Looks → Packs…** (or type `/frames <name>`): a rest picture, a blink, a few mouth openings, and one set
per emotion if you like. Only `neutral.png` is required. Choosing the drawn avatar in that gallery (or `/frames off`) goes back, and so does
picking one of your saved looks or a preset.
`docs/frame-packs.md` has the file names, a sample pack drawn by the creator (`python/make_sample_pack.py`),
and how to get a consistent set out of an image tool.

**Risa**, an original character (the same as the drawn Risa preset, pictures made with Grok Imagine, MIT-licensed like the rest;
[`packs/risa-dress/NOTICE.md`](packs/risa-dress/NOTICE.md)), has three outfits: the dress comes with the app (Looks → Packs… → risa-dress, or `/frames risa-dress`),
and the bikini and the school uniform are downloaded when you want them (Looks → Packs… → Risa, or `/frames risa-bikini` and `/frames risa-uniform`; the page asks first).

**Franzi**, an original character (made with AI, MIT-licensed like the rest), has four outfits: the dirndl comes with the app, and the casual, pajama and bikini
outfits are downloaded when you want them. Pictures are grouped by character in **Looks → Packs…**: a character with several outfits is one tile that opens a row of them.
While a pack is on, she is told what the pictures show (each pack's `look.txt`, and the character's shared description), and with a brain that can read pictures she is
also shown her resting picture. She can change outfit herself: ask her to, or let her decide, and she writes `[outfit casual]` (only outfits of her own character; one that
has to be downloaded makes the page ask you first).

**Draconia Malfoid** is her own character, not one of Franzi's outfits. She is an unofficial fan character loosely inspired by Draco Malfoy (a girl version, 21 years old): long platinum-blonde hair in a side braid, teal-green eyes, and a Slytherin-style uniform. She has three outfits, the uniform, the same uniform with the robe off (the vest), and an emerald and silver Yule Ball gown, and each pack is downloaded when you want it (Looks → Packs… → Draconia Malfoid, or `/frames draconia-uniform`, `/frames draconia-vest` and `/frames draconia-gown`; the page asks first). They are **not MIT** and are for **non-commercial** use only. She is not affiliated with or endorsed by Warner Bros. or Wizarding World, and the pictures will be taken down on request (rhedak00@yahoo.de). The pictures live in the [packs repository](https://github.com/rhedak/anime_ai_companion-packs), not in this one, and each pack's `NOTICE.md` (in `data/frames/<name>/` once downloaded) is what you follow.

A **Hatsune Miku** pack is available too, as a download (Looks → Packs… → Miku, or `/frames miku`; the page asks first). She is Crypton's character, so that
pack is unofficial fan art for **non-commercial** use under the Piapro Character License, with its credit shown on screen and its terms said in the chat when you
choose it. It lives in the [packs repository](https://github.com/rhedak/anime_ai_companion-packs), not in this one, and its `NOTICE.md` (in `data/frames/miku/` once
downloaded) says what you may do: read it before you use or share it, and follow its terms yourself: this project cannot grant you the right to use the character.

A pack that is not on this computer yet can be downloaded from **Looks → Packs…** (a small preview and **Download**)
or with `/frames <name>`. The page asks first and says how big it is (about 4 to 5 MB) and which server is contacted (GitHub, which sees your IP address); nothing is
fetched until you say yes. It is saved in `data/frames/` and afterwards works like any other pack, including offline.
The list is fetched from `COMPANION_PACK_INDEX` (by default the list of the [packs repository](https://github.com/rhedak/anime_ai_companion-packs)); if it cannot be reached,
the packs already on this computer still work. [`docs/pack-archives.md`](docs/pack-archives.md) describes it.

**Updated packs.** A pack downloaded from the list remembers which version it came from. When the list has newer files for it (a pack's version goes up whenever
its pictures change), picking it (Looks → Packs…, `/frames <name>`, or she changes into it with `[outfit …]`) shows what is installed at once and then asks:
the card gives the two versions, the size and the server, and nothing is fetched until you say yes; the old copy is replaced only after the new one has been
checked. The gallery marks such a pack **Update available**, `/frames` lists it as `(update available)`, and she is told, so she can mention it. Packs that
did not come from the list (your own, and the ones that ship with the app) are never touched. The list is looked at when you open the gallery or pick a pack
of a character; in the desktop app, if you said yes to update checks (and to the pack list in that), it is also looked at about once a day and a notice says
which packs have updates.

## Local models with Ollama

Pick **Ollama (local)** under *Brain* and she is powered by a model on your own machine: nothing
leaves it at all. Install [Ollama](https://ollama.com), `ollama pull llama3.2` (or any chat model),
and choose the model in the dropdown. The same persona and the same `[emotion:...]` / `[avatar ...]`
tags drive the avatar, though small models follow the tag protocol less reliably. Chat never uses tools.
Switching brains starts a fresh conversation.

You can also start with it: `COMPANION_PROVIDER=ollama npm start` uses the first model you have installed, and
`COMPANION_PROVIDER=ollama OLLAMA_MODEL=llama3.2 npm start` names one.

**Use a model of about 3B or bigger** (`llama3.2`, `qwen2.5:3b` or `qwen2.5:7b`, for example). A very small one such as `qwen2.5:0.5b`
chats, but it does not reliably write her `[emotion:...]` and `[avatar ...]` tags: her face then stays flat, and asking her to change her
hair or her clothes does nothing, however it is worded.

**Work mode with a local model is experimental, and the quality is your responsibility.** If Ollama reports that the
model supports tool calls (a recent Qwen or Llama, for example; `ollama show <model>` lists its capabilities), the **Work** button
works with it. She can then read files, search, run a command, create a file and edit one in your project folder. How well a local model
uses tools depends entirely on the model and its size: small or older ones call tools badly (wrong arguments, loops, or text
that only looks like a tool call), and any model can propose a wrong or harmful command or edit with full confidence. Every
command, file write and edit waits for your approval and shows exactly what it will do, so reading the card is your job;
there is no mode that skips it for Ollama (only **Ask** and **Plan**, and Plan offers reading and searching only). Reading and
searching inside the project are pre-approved, like for the other brains. Nothing outside the project folder can be read or
written through her tools, but an approved `bash` command can do anything your user can. The app does not test, rate or vouch
for any local model: work done through one is at your own risk, so keep the project under git and check the result. She stops
after 12 tool steps in a row. Ollama's default context window is small, so tool work asks for 16384 tokens (change it with
`COMPANION_OLLAMA_CTX`); a big model with a big window needs the memory for it. If your Ollama is too old to report capabilities
and the model is not a known family, vouch for it with `COMPANION_OLLAMA_TOOLS=<model name>` (or `all`).

## Cursor

Pick **Cursor** under *Brain* and she is driven by `cursor-agent` on your machine (Composer, Grok, or
any other model that agent lists). Sign in once with `cursor-agent login`, or set `CURSOR_API_KEY`.
Start the companion from Terminal on this Mac, or from the desktop app. Started from an SSH session, Cursor
reports a locked login keychain even when Keychain Access shows it unlocked, and restarting from the page
keeps that session.
The conversation still goes to Cursor; files stay on this machine. Chat mode is read-only. Work mode
asks with the same approval card as Claude, and the Permissions menu adds **Run everything**
(`cursor-agent --force`): tools run without a card, a deny rule still blocks, and the choice resets
to Ask every time the server starts. If Cursor's own CLI is set to run without asking
(`"approvalMode": "unrestricted"` in `~/.cursor/cli-config.json`), this app starts in Run everything
too and says so. Auto and Accept edits stay Claude Code modes.

## opencode

Pick **opencode** under *Brain* and she is driven by `opencode acp` on your machine, signed into
whatever models your opencode install already knows (choose one in the dropdown, or leave it on
opencode's default). Sign in once with `opencode auth login`. The conversation goes through
opencode; files stay on this machine. Chat mode is read-only. Work mode asks with the same approval
card as Claude; the menu offers **Ask**, **Plan** and **Run everything** (an opt-in that lets every
tool run without a card, and resets to Ask every server start). Every start runs isolated: your
project's own `opencode.json`, plugins and MCP servers stay unloaded, and approvals reset to Ask.

## Work mode

Flip the **Work** switch, pick a project folder, and she can read and edit files and run commands
there, like a regular Claude Code session. She asks first:

- Every action that is not pre-approved shows an approval card with the **exact** command or file
  content. Choose *Allow once*, *Allow for this session*, or *Deny*; a denial is not retried. With a local (Ollama) model, *for this session* covers later file writes and edits in the project folder, but a shell command only as written.
- The **Permissions** menu changes how approvals work: *Ask for each action* (the default),
  *Plan first* (she reads and proposes a plan; nothing changes until you approve it), *Accept edits*
  (file edits no longer ask; commands still do), and *Auto* (Claude Code's own classifier approves
  routine actions and blocks risky ones, so fewer cards reach you). With Cursor, the menu is Ask,
  Plan and **Run everything** instead of Accept edits and Auto. It resets to *Ask* on every start
  (unless Cursor's own CLI is set to run without asking, in which case this app starts in Run everything
  and says so) and can be changed at any time, even while an approval card is waiting; the conversation carries on.
  Approval cards also offer *Allow, and accept all edits* (for file edits) and *Allow, and switch to
  Auto*, like the terminal's "yes, and don't ask again".
- Pre-approved without asking: `Read`, `Grep`, `Glob` (edit in `data/settings.json`).
- **Work here** applies the folder typed in the box. With nothing typed, or once she already works in that folder, the same button
  reads **Choose folder…** and opens your system's folder dialog (macOS, or Linux with `zenity` or
  `kdialog`; elsewhere type the path), starting in the current folder; picking one switches to it.
  Enter in the box always means "use what I typed".
- The folder settings above the chat fold away with the **−** button into a one-line summary (**+** or a click
  on it opens them again), for more room; the choice is remembered in the browser.
- By default your own Claude Code setup is **not** loaded: a folder's `.claude/settings*.json` hooks
  and allow rules, your user settings and MCP servers do not apply, so opening an unfamiliar folder
  runs nothing of its own. The **Use my Claude Code setup** checkbox (or `/setup on`) loads them, as
  in a terminal; hooks run commands, so it is off at every start. The home directory or `/` cannot be
  chosen as a folder.
- **Skills.** Skills are not loaded by default either, so she cannot call one by name and would have to read its file by hand. The **Use my skills** checkbox, or `/skills on`, lets her use your own skills (`~/.claude/skills`) by name. It loads your user settings but keeps hooks off, and a folder's own skills stay off: those only load with the whole setup above. It is off at every start. When she reaches for one of your skills while they are off, she asks first, and a folder with its own skills says so once.
- **Chrome.** The **Use my Chrome** checkbox, or `/chrome on`, lets her drive your own Chrome through the [Claude in Chrome](https://code.claude.com/docs/en/chrome) extension. It passes Claude Code's own `--chrome` and nothing else: your other MCP servers stay unloaded unless the setup above is on. The extension has to be installed already and signed into the same Claude account (an API-key login keeps it off). Browser actions use the same approvals as her other tools. It is off at every start, and a phone cannot turn it on.
- With Claude Code, helpers (subagents) can keep running after her reply ends: a line above the message box says
  **Waiting for N background agents to finish…** (hover for what each is doing), and a reply she gives when one finishes
  appears in the chat like any other.
- Work mode uses a stronger model (`COMPANION_WORK_MODEL`, default `sonnet`) and counts against your
  plan limits faster than chatting.
- The bar under the header shows `claude --resume <session id>`: you can continue the same
  conversation in a terminal. Only one side should write at a time.

`anaico` starts in work mode for the folder you ran it from (a home directory or `/` falls back to
chat). `anaico --chat` starts in chat mode instead; the folder is still pre-filled, so the **Work**
switch is one click. A server started another way (`npm start`) begins in work mode only if it has a
saved folder, and in chat mode otherwise. A server that is already running keeps its mode and folder.

### Running it in the background

`anaico --daemon` starts the server in the background and returns; it keeps running after you close the
terminal (its output goes to `data/server.log`). Take the same `--chat` and `--no-open` as usual.

A problem in the page itself (a script error, an animation frame that failed) shows as an orange ⚠ line in the chat; tap it
for the details. It is also written to the server's log as `[page ...]`, so a problem on your phone can be read on the computer.
`anaico --doctor` checks what the companion needs (Node, a brain, the character creator, the port) and says what is
missing and how to fix it; it only looks and changes nothing. In the page, `/doctor` does the same for the running app (it names the opencode in use and her data folder, and is not available from a phone: paste its output into a bug report), `/claude-login` signs in to Claude Code again when its login has expired (it runs `claude auth login`, which opens your browser), and `/install-opencode` installs the opencode this app was made for, for the app only (it asks first, and is used instead of any other opencode on the computer). `anaico --status` says whether it is running, `anaico --stop` stops it, and `anaico --restart` stops and
starts it again in the folder you run it from (use it after an update, or to change folder or mode). In the page, `/restart` does the same for the running server: the page reconnects, the conversation stays, and phone access and permissions go back to a fresh start. It is not available from a phone.
Only a server started with `--daemon` is managed by `anaico --stop` and `anaico --restart`: those will not touch one
that is running in another terminal. `/restart` in the page works for whichever way the server was started. Unless you start it with `--lan` or turn phone access on with `/phone` (next section), the server only
listens on `127.0.0.1`, and a background server is no different.

## Controlling her from your phone

`anaico --lan` (or `npm start -- --lan`) also lets other devices on your network in, so you can carry on
a session from your phone while the computer does the work. In the desktop app, or any run without the flag, type
`/phone`: when phone access is off the page asks whether to turn it on, and a yes opens it without a restart. It is **off at
every start**: you ask for it each time, like a looser permission mode.

1. Start with `--lan`, or type `/phone` and answer **Turn on** (your system may ask once to allow incoming connections).
   It shows a few links ending in `?t=<token>`, one per way the phone can reach this
   computer (the Wi-Fi address first, then other addresses such as Tailscale, then its `.local` name), with a
   **QR code** for the first one: scan it with the phone's camera. Type `/phone` again to see them again.
2. Open the link on the phone, on the same Wi-Fi. The first visit signs the phone in (a cookie) and removes the
   token from the address, so the page stays open without it.
3. `/phone new` makes a new token and signs every phone out. `/phone off` turns phone access off again, until you
   ask next time.

What a phone can do: chat, answer the approval cards, stop her, switch between chat and work, set the project
folder by typing its path (`/work ~/project`, or the folder field), choose **Run everything**, change the look.
What it cannot, because these run without a card or reach into the computer: `!commands`, Auto and Accept edits,
`/setup on`, `/skills on`, `/chrome on`, importing or resetting a character card, opening her notes file, and the system folder
dialog (it opens on the computer). The home folder and `/` still cannot be chosen.

On a narrow screen she is above the chat, with a bar between them to drag up or down (double-tap resets it). The
button in the chat's header puts her behind the chat instead: the chat takes the whole screen and she shows
faintly through it; dragging the bar on past the smallest she gets does the same. That works on a wide screen too,
and the choice is remembered in that browser.

The token is a password, and the connection is plain `http`, so use it only on a network you trust (not
café Wi-Fi), and not through a tunnel you do not control. For use away from home, put the computer and the phone
on a private network such as Tailscale and use the computer's address there; `--lan` lists it among the links.
The token is saved in `data/lan-token` (only you can read it). On the phone's plain-`http` page the browser
withholds the clipboard, so the copy buttons do nothing there. If the page does not load at all
(`ERR_ADDRESS_UNREACHABLE`), the network is in the way, not the app: turn off a VPN on the phone, and look for
"client isolation" or "AP isolation" in the router's Wi-Fi settings, which lets Wi-Fi devices reach the router
but not each other. macOS asks once whether `node` may accept
incoming connections: allow it.

## Her name

Click her name at the top (or use `/rename Hana`) to rename her: Enter saves, Esc cancels. The reset beside the name (or `/rename reset`) forgets that name, so she follows the character of the pack that is on again, or Risa when none is. The name is
saved in `data/settings.json`, shown in the page title and exports, used in her system prompt
(`persona.md` has a `{{name}}` placeholder), and she is told about the change right away. Names are 1 to 24
letters, numbers, spaces and `. ' - _`, so a name cannot carry instructions into her prompt.

## Changing her personality by asking

You can ask her in chat to change her personality or voice. She answers with a proposal card showing the whole new text, and nothing is
written until you press Keep (the old file is kept as `persona.md.bak`). **Known limitation:** the card depends on the model following the
instruction to write the proposal. It appeared every time in testing (Claude, Big Pickle, a 3B Ollama model), but there is no fallback on
the server, so a stubborn model can answer in words and show no card. Ask again, or edit `data/persona.md` yourself.

## Her notes about you

She can keep a few notes about you across conversations, in `data/memory.md`: one short fact per line, plain Markdown you can
open and edit.

- In chat, when you tell her something worth keeping (your name, a preference, something you ask her to remember), she
  **asks first**: a small card under her message shows the note and you choose **Keep** or **Not now**. Nothing is saved until you
  keep it, a note you turn down is not offered again in that conversation, and an unanswered card just stays unsaved. She is told
  which proposed notes were declined or are still waiting, so she does not say she saved them. Up to 50 notes, 200 characters each.
- `/memory ask` (the default), `/memory auto` and `/memory off` choose what happens to a note she proposes. With **auto** she saves
  it herself (**🧠 Remembered: …**) with an **Undo** button next to it; **off** saves nothing, and she is told so. The choice is
  kept in `data/settings.json`, and `auto` cannot be switched on from a phone.
- `/memory` lists them, `/memory add <note>` adds one, `/memory forget <number>` (or `all`) removes one, and `/memory edit`
  opens the file. An edit by hand is picked up with her next message.
- She is told her notes with the first message of a conversation, and only what changed after that, so the prompt that
  Claude keeps cached is never touched. A new conversation (`/clear`) gets the full list again.
- Notes are information about you, not instructions: they are handed over as data. **She saves nothing in work mode**, because a
  file or web page she reads there could talk her into writing a note that outlives the conversation; use `/memory add` there. If
  you ask her to remember something in work mode (or with notes off), the chat says once that she cannot, and she is told not to
  promise it.
- These are **her own notes about you**, a plain file on your computer. They are not Claude's memory feature, and they are
  not shared with it.
- The file belongs to you: it stays in `data/`, out of git, and nothing is sent anywhere except in her messages to your brain.
  Switching brain starts a new conversation, so she is told the notes again.

## Character cards

Character cards (the community format used by [SillyTavern](https://github.com/SillyTavern/SillyTavern), [Chub](https://chub.ai) and similar sites: a `.json` file, or a `.png`
with the card inside) can give her a ready-made personality.

- `/card import <file>` reads a V1, V2 or V3 card and shows what it will add. Nothing changes until you choose
  **Use this card** (or `/card apply`); **Cancel** (or `/card cancel`) drops it.
- Her description, personality, scenario, example lines and name are always used. HTML and our own tags
  (`[emotion:…]`, `[avatar …]`, `[image …]`) are removed from the text, `{{char}}` becomes her name, and each field is capped
  in length. The author's own notes are shown in the preview, nothing more.
- A card can carry more, and the preview offers each part as a checkbox:
  - **Her greeting** (`first_mes` and the alternate greetings): new conversations open with it, shown by the page without
    asking the model, so it costs nothing. She is told afterwards what she said. Ticked by default.
  - **The lorebook:** short background entries that are added to your message when it mentions their keywords, each entry once
    per conversation, at most three entries and 1,500 characters per message (it adds to what a message costs). Only plain
    keywords are supported, not regular-expression keys. Ticked by default.
  - **The card author's own instructions** (`system_prompt` and `post_history_instructions`): off by default. These are
    orders written by the card's author, and they apply in chat **and in work mode**, where she can read files and run
    commands. They sit before her style notes and the expression protocol, and the protocol still applies, but a card can
    tell her to behave in ways you do not expect, ignore your project's rules, or (if it is malicious) steer her toward harmful
    commands. Every command still waits for your approval, but you are trusting the card's author. The preview warns strongly
    once and that is the only warning: using them is entirely your own risk.
  - Not supported: a card's `extensions` (front-end scripts and the like).
- Her name becomes the card's name if it fits the name rules. Her look is not part of a card.
- The card is saved in `data/character.json` and replaces only the first part of `persona.md`. The style notes and the
  expression protocol stay. A conversation that is already running keeps the persona it began with, so use `/clear`.
- `/card apply greeting lore orders` (any of the three words) applies a waiting card with exactly those parts; plain `/card apply` uses the greeting and lorebook.
- `/card export` downloads her current character as a V2 card, with the greeting, instructions and lorebook if a card brought them. `/card reset` goes back to `persona.md` (she keeps the
  name; rename her with `/rename`).
- A card is text written by someone else and it becomes part of her instructions. Read the preview before you accept it.
  Importing and resetting work from the computer itself only, not from a phone.

## Changing how it looks

All colours, fonts, corner radii and sizes of the interface are CSS variables at the top of
[`public/theme.css`](public/theme.css), with a comment on each. `public/style.css` only uses them.
To restyle it, put your changes in **`data/custom.css`** (create it; it is yours, git ignores it, updates
never overwrite it, and deleting it restores the default look). It loads last and a page reload shows
the change, so you can simply ask an AI assistant: "edit `data/custom.css` to make the chat panel light
with a blue accent and rounded corners; the variables are documented in `public/theme.css`".

```css
:root { --accent: #4f9d69; --surface: #22302a; --panel: #17201c; --radius-lg: 6px; --font-heading: "Courier New", monospace; }
```

Anything the variables do not cover can be restyled with ordinary CSS rules in the same file. Risa's own
appearance (hair, clothes, face) is separate: ask her to change it in chat.

## How her replies are shown

Her replies render a small, safe Markdown subset: paragraphs, headings, **bold**, *italic*, `code`,
code blocks, lists, quotes and http(s) links. It is built from plain DOM nodes, never HTML, so
nothing she writes can inject markup. `/copy` and `/export` keep the Markdown source. The speech bubble
over her head and spoken replies stay plain text.

## Automatic compaction, and long conversations

Claude Code compacts the conversation by itself when the context gets big, also behind this browser; she
keeps a summary and a note appears in the chat ("compacted automatically, about 106k → 19k tokens"). The
app asks for that at **200k tokens** (`--autocompact 200000`), not near the model's whole 1M window: a
conversation that grows to several hundred thousand tokens makes every later message expensive. To change
it, start the server with `COMPANION_AUTOCOMPACT=300000` (100000 to 1000000, or `auto` for Claude Code's own
choice). `/compact` does it on demand, and the `ctx` figure in the usage line shows how close you are.

Claude keeps the conversation in a prompt cache, so each message normally only pays for what is new. The
cache lives about an hour. If you come back after that to a conversation of 100k tokens or more (or
`/resume` an old one), the next message would have to send all of it again at full price, which can use a
big share of your usage limit. So that message waits, and a card asks:

- **Summarise, then send**: runs `/compact` first (like "resume from summary" in the terminal), then sends
  your message. Reading the conversation once to summarise costs about what sending it would, but every
  message after that is cheap. The summary loses some detail.
- **Send as it is**: pays the full read once, keeps every detail.
- **Don't send**: your text goes back into the message box.

Restarting the app does not lose the cache by itself: Claude Code stores the system prompt with the
conversation and reuses it on resume. That is also why a change made after the conversation began (a new
look from the menu, a rename, switching to work mode) reaches her as a short note in your next message,
not as a new system prompt.

## The usage line

Under the message box a small line shows the model and its effort, e.g. `Sonnet 5.5 (high)`, your Claude **session** (five-hour) and **week**
usage with their reset times, and **ctx**, how full her memory of this conversation is (`/compact` frees
it up). Numbers turn amber above 80% and red above 95%. The limits come from Claude Code after each
reply, so they are shown dimmed when they are over ten minutes old, and only for a Claude subscription;
with Ollama only the model is shown. Colours are theme variables (`--warn-text`, `--error-text`).

## Effort

The **Effort** menu (or `/effort low|medium|high|xhigh|max|default`) sets how hard Claude thinks; more
is slower and uses more of your limits. Her sessions do not load your Claude Code settings (so a
folder's hooks and rules never run), with one exception: for *Default* the effort level in your own
`~/.claude/settings.json` (`effortLevel` and `modelSettings`) is read, so she thinks as hard as your
terminal does, and the footer shows it. Changing it restarts her process and the conversation carries on.

## Images

The **📎** button next to the message box attaches up to 5 pictures (PNG, JPEG, GIF or WebP, up to 5 MB
each); you can also paste an image or drop files onto the chat. The browser shrinks anything bigger
than 1568 px on its long edge first (a resized GIF or WebP loses its animation), and the server checks
the type, the real file contents and the sizes again. Pictures go to the model as they are and a picture
without text works too. Only a count is kept in the saved chat log, so after a reload the thumbnails give
way to "🖼 2 images". With Ollama they need
a vision model (e.g. `llava`), and only the message that carries them sees them.

## Shell commands with `!`

In work mode, a message that starts with `!` runs in your project folder straight away, like Claude
Code's bash mode: `!ls`, `!git status`. The output appears in the chat (with the exit code if it
failed) and is passed to her with your next message, so she knows what you saw. There is no approval card,
because you typed the command yourself, so the composer turns amber with a reminder while the line starts
with `!`. Commands run in your shell without a terminal and without input, so they cannot ask questions
or open editors; they stop after 2 minutes and their output is cut at 100 KB. Chat mode refuses them.

## Pictures in the chat

When she makes or finds an image in your project folder (a screenshot, a chart, a logo), she can show it
with an `[image path/to/file.png]` tag in her reply: small thumbnails appear under her message, and
clicking one opens a viewer (arrow keys or the side buttons to move between several, Esc to close).
Your own attached pictures open in the same viewer. Only real PNG, JPEG, GIF and WebP files up to
10 MB inside the project folder are shown (at most 8 per reply; she is told if she named more), symlinks that lead out of it are refused, and she is told when
a path did not work. The chat log keeps only the file's location, not a copy, so a picture that has been
deleted or moved later no longer loads after a reload.

## Typing while she answers

You can keep typing while she is still answering: **Enter** queues the message, like in Claude Code. Queued
messages are listed above the box (the **×** takes one back out) and go out one by one as each reply ends, up to ten.
Stop, an error, `/clear` or switching brain does not send them: the text comes back into the box instead (attached
pictures do not, so attach them again). Slash commands and `!commands` are not queued; they run or say to wait. The
queue is not saved over a server restart.

## Stopping her

**Ctrl+C** (or the round stop button that replaces Send while she works) stops her reply, or a running
`!command` (with everything it started). What she had said so far stays in the conversation, and she
carries on with your next message. With text selected, Ctrl+C still copies. On a Mac use the Control key,
not Cmd.

## Slash commands

Type these in the chat box (`/help` lists them):

| Command | |
| --- | --- |
| `/compact [focus]` | summarise the conversation to free up context; she keeps the gist |
| `/clear`, `/new` | start a fresh conversation, like **New chat** |
| `/resume [number]` | list earlier conversations in the current folder (newest first), or continue one; with Claude the chat log is rebuilt from Claude Code's session file, with Cursor she remembers it and the screen starts clean |
| `/cost` | what the conversation has used: an API-price estimate and how full the context is |
| `/model [name]` | show or set the model for the current mode (`/model opus`), until the server restarts |
| `/chat`, `/work [folder]` | switch modes |
| `/permissions [ask\|plan\|accept\|auto\|everything]`, `/plan` | the Permissions menu, from the keyboard; `everything` is Cursor's Run everything |
| `/rc`, `/remote-control` | not built in: explains why and prints the terminal command to use it yourself |
| `/rewind` | not available in the companion: prints the terminal command to continue there and rewind |
| `/effort [level]` | show or set how hard she thinks (restarts her process; the conversation continues) |
| `/setup [on\|off]` | work mode: load your own Claude Code settings, hooks and MCP servers (off at every start) |
| `/chrome [on\|off]` | work mode: let her use your Chrome through the Claude in Chrome extension (off at every start; the extension must already be installed) |
| `/memory [add <note> \| forget <number\|all> \| edit \| ask \| auto \| off]` | her notes about you (`data/memory.md`); in chat she asks before saving one (`auto` saves with an Undo, `off` saves nothing), never in work mode |
| `/card import <file>` \| `apply` \| `cancel` \| `export` \| `reset` | character cards: use a card's personality, or export hers (`/card import` shows a preview first) |
| `/skills [on\|off]` | work mode: let her use your own skills by name; your user settings apply, hooks stay off (off at every start) |
| `/frames [name\|off]` | show her with the pictures in `data/frames/<name>` instead of the drawn avatar; alone, lists the packs |
| `/play [name] [end]` | play a short scene in chat (`/play` lists them; `/play key` is The spare key; `/play room` is a short story you are both trapped in, and the page asks you to wait while she writes it; `/play room 5 1 3 1` sets steps, hints, herrings and traps; a trap starts that room over; she explains the thread when you finish or `/play end`). In work mode, `/play` switches to chat |
| `/show` | she shows all her emotions, a blink, talking and her gestures, a second each, naming every one (no model call); asking her "show me all your animations" does the same |
| `/restart` | restart the server (the page reconnects; the conversation stays; phone access and permissions go back to a fresh start). Not from a phone |
| `/status` | brain, model, mode, folder and session id |
| `/copy` | copy her last reply to the clipboard |
| `/export` | download the conversation as a Markdown file |
| `/voice` | turn spoken replies on or off |

`/resume` looks in the folder she is working in (the project folder in work mode, her own `workspace/`
in chat mode), so it also finds sessions you started in a terminal there; switch modes first to look
elsewhere. It is refused mid-reply and with Ollama.

Anything else that looks like `/word` is reported as unknown instead of being sent to her; paths like
`/etc/hosts` are sent as usual. Commands that change settings are refused mid-reply. Commands that
need Claude Code (`/compact`, `/cost`, `/resume`, `/work`, `/permissions`, `/plan`, `/rc`, `/rewind`) say
so plainly when another brain, such as Ollama, is active, instead of pretending to work.


## How it works

- **Gestures:** `[gesture:wave]` and `[gesture:cheer]` raise an arm for a moment (two pose frames).
- **Showing off:** `[demo]` at the end of a reply starts the same sequence as `/show`. The page plays it, because tags in a
  streaming reply would all fire at once; any new message ends it. A picture pack shows what its pictures have.
- **Emotions:** she starts replies with tags like `[emotion:happy]`; `emotions.json` maps each to
  face settings. The server renders a few mouth openings and a blink per emotion and the browser
  flips between them while text streams.
- **Narration (chat only):** a line that is only an action, written `*she moves a step closer*`, is shown in its own italic bubble.
  The voice and the speech bubble over her picture skip it. In work mode those asterisks stay ordinary emphasis.
- **Looks:** she writes `[avatar hair_color=#ff88cc outfit.hat_color=#222 glasses=true]`.
  `src/render-ops.ts` validates every key; rejected ones are reported back to her on her next
  turn. Your current look is saved in `data/avatar.json` (git-ignored).
- **Providers:** `src/providers/types.ts` is the interface and Claude Code is the first
  implementation. The tags are plain text, so other backends (for example Ollama) can reuse them.
- The server listens on `127.0.0.1` only, unless you pass `--lan`, and rejects WebSocket connections from other origins.

The roadmap is in [docs/plan.md](docs/plan.md).

## Using it with your Claude account

This project runs **on your own computer, with your own unmodified `claude` and your own login**.
Please keep it that way:

- Do not host it as a service for other people, and do not build anything that collects, stores
  or relays Claude credentials. Anthropic's terms do not allow routing other people's requests
  through a subscription. See the
  [Claude Code legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance).
- Plan limits assume ordinary individual use; a companion who chats all day uses them up faster
  than you might expect.
- Prefer an API key? Claude Code supports `ANTHROPIC_API_KEY`; this project does not change that.
- This is an independent project, **not affiliated with or endorsed by Anthropic**.

## Sharing improvements (a friendly request, never a requirement)

The licence lets you do anything with this code, and that is the point. If you improve it, or fix
something in your checkout of [anime-character-creator](https://github.com/rhedak/anime-character-creator),
a pull request would make it better for everyone, and it is very welcome. Small ones are great.
See [CONTRIBUTING.md](CONTRIBUTING.md). If either checkout has local changes, the server mentions
this once a week at startup (local check only, no network); `COMPANION_NO_NUDGE=1` turns it off.

## Security model

Because the server can run Claude Code, it is built to be reachable only by you:

- It listens on `127.0.0.1` and accepts WebSocket connections only from its own origin. That stops any website you visit
  from talking to it. It does not stop other software on the same computer: a local program can send any `Origin`
  header, and on a shared computer another user could reach the port. Run it on a computer only you use. If you cannot,
  set `COMPANION_NO_SHELL=1` (turns off `!command`, the one way to run a command without a card) and do not use work
  mode: anyone who can reach the port can also answer the approval cards.
- `--lan`, or a yes to the question `/phone` asks on the computer itself, is the one way past that, and it is opt-in at every start (a phone cannot turn it on or off). Then every page, file and WebSocket
  from another device needs the secret token (a cookie, checked in constant time), a `Host` that is a local
  address or `.local` name (against DNS rebinding), and, for the WebSocket, an `Origin` equal to that address.
  Such a device can still not run `!commands`, loosen the permission mode, load your Claude Code setup or your skills, or change her character.
  Connections from the computer itself are unchanged, so a tunnel or reverse proxy on it is not given a way in.
- The page ships a strict Content-Security-Policy (no inline or foreign scripts, no framing, so nobody can
  click the approval buttons for you).
- Everything the model chooses is validated: avatar values are coerced per field (hex colours, numbers,
  plain-text only for free text), even though the character renderer now escapes text itself (older
  checkouts of it did not). The SVG is also sanitised in the browser before it is shown.
- Work mode never skips permissions (even *Auto* leaves risky actions to Claude Code's safety checks), shows the exact command or content you approve, and does not load a
  folder's own hooks or settings. With Ollama (experimental) every command, file write and edit asks first, there is no looser mode,
  and how well a local model behaves is up to the model and to you.
- Character cards are text from a stranger: cleaned, previewed and confirmed before they apply, with her greeting, the lorebook and the
  card author's own instructions as separate choices (the instructions off by default, with one strong warning at import). The
  expression protocol is never replaced by a card.
- Her notes about you (`data/memory.md`) are proposed by her in chat only, never in work mode; by default each one waits for your yes. They reach her as information, not instructions.
- The one place audio leaves the machine is the opt-in microphone button (the browser's speech recognition); it asks first and the app's own server never receives audio.

Found something? Please open an issue, or report it privately if it is serious.

## How this was made

**This project was built with AI, and you should know that.** The code of this repository and the code of the
[character creator](https://github.com/rhedak/anime-character-creator) behind it were written with AI coding agents,
directed by their owner: mostly **Claude Code** (Anthropic), with some work done with **Cursor** (using Grok models)
and **opencode** (using the free "Big Pickle" model). AI-written code can be wrong. There is an automated test suite
and safety rules written into the code (see the Security model section above), but treat this as you would any
software you have not read line by line.

- **The documentation** (the README and the documentation site) was written by Claude Code,
  from the code.
- **The drawing** is ordinary code: when a character is drawn, no image generator runs. But the characters' designs
  began from AI-generated reference images (some made with Grok, kept in the creator's `ref/` folder), which set the
  style and the first roster, and several characters, Katherina and Risa among them, were traced from such
  references.
- **The Hatsune Miku pictures, the Risa (dress) pictures and the Draconia pictures** were made with Grok Imagine (see [Credits](#credits)).
- **The commits** made by Claude Code in this repository carry a `Co-Authored-By` trailer. The creator's commits do
  not, so its history does not show which were AI-written: assume most of its code was.

## Credits

- Characters are drawn by **[anime-character-creator](https://github.com/rhedak/anime-character-creator)**
  (MIT), a program that draws them from parametric shapes in code, not by hand and not by image generation
  (the code is AI-written and the designs began from AI-generated references: see
  [How this was made](#how-this-was-made)). Please keep saying so if you share what it makes.
- [`ws`](https://github.com/websockets/ws) for WebSockets.
- `packs/risa-dress`: an original character, pictures made with Grok Imagine (AI-made; MIT, see its `NOTICE.md`).
- The Hatsune Miku pack (downloaded on request from the [packs repository](https://github.com/rhedak/anime_ai_companion-packs), not part of this repository): Hatsune Miku © Crypton Future Media, INC. (www.piapro.net), unofficial fan art under the
  [Piapro Character License](https://piapro.net/license/pcl). Not MIT; see its `NOTICE.md`.
- The Draconia Malfoid packs (downloaded on request from the [packs repository](https://github.com/rhedak/anime_ai_companion-packs), not part of this repository): unofficial fan art, non-commercial, not affiliated with or endorsed by Warner Bros. or Wizarding World. Not MIT; see each pack's `NOTICE.md`. They will be taken down on request (rhedak00@yahoo.de).

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) (the Contributor Covenant).

## Licence

[MIT](LICENSE). Everything in this repository is MIT. The exceptions are two packs you can download, not part of this repository: the Hatsune Miku pictures
(see above) show a character that belongs to Crypton Future Media and may only be used non-commercially, under the terms in the pack's own `NOTICE.md`; the Draconia Malfoid pictures are unofficial fan art under the same kind of exception (non-commercial, taken down on request; see the pack's `NOTICE.md`).
