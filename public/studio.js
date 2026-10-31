/**
 * The pack studio's panel (docs/pack-studio.md): a form, the question before anything is drawn, the pictures to pick from, and the result.
 * It only sends and shows; every rule (off at every start, nothing from a phone, one job at a time) is the server's.
 *
 * @param {{ attention?: (text: string) => boolean, send: (msg: object) => void, host: () => Element | null, say: (text: string) => void, closeWindow?: () => void }} io
 *   `closeWindow` is the full studio's own page (studio-full.js): its Close button closes that tab.
 */
export function createStudio(io) {
  let on = false;
  /** The user pressed "Not now" on the card: the cancel that follows is not a stop. */
  let declined = false;
  /** @type {string[]} */
  let sources = [];
  /** The pack she is wearing: the form starts from it, until the user picks another. */
  let active = "";
  let sourceTouched = false;
  /** The image makers the server offers, and the one that is chosen. */
  /** @type {{ value: string, label: string, kind: string, cost?: string, keyNames?: string[], available?: boolean, reason?: string | null }[]} */
  let makers = [];
  /** How many pictures a full pack has, from the server. */
  let packSize = 0;
  /** The pictures of each pack that were drawn again in the pack itself: `{ pack: [picture names] }`. */
  /** @type {Record<string, string[]>} */
  let edited = {};
  let maker = "";
  /** @type {HTMLElement | null} */
  let panel = null;
  let jobId = "";
  /** The packs' pictures, by pack: "Draw one picture again" offers these. */
  /** @type {Record<string, string[]>} */
  let frames = {};

  const el = (/** @type {string} */ tag, /** @type {Record<string, any>} */ props = {}, /** @type {(Node | string)[]} */ ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
  };
  const q = (/** @type {string} */ sel) => /** @type {HTMLElement | null} */ (panel?.querySelector(sel) ?? null);

  /** The corner ring that says the studio is working (like local_models' own): shown while a job, a redraw, an export or a server start runs. */
  let busyOn = false;
  /** The ring was started by what the server reported (so the server's next report may end it), not by a click on this page. */
  let fromState = false;
  function setBusy(/** @type {boolean} */ on, /** @type {string} */ text = "") {
    busyOn = on;
    if (!on) fromState = false;
    let ring = document.querySelector(".studio-busy");
    if (!on) return void ring?.remove();
    if (!ring) {
      ring = el("div", { className: "studio-busy", role: "status", ariaLive: "polite" }, el("span", { className: "studio-ring" }), el("span", { className: "studio-busy-text" }));
      document.body.append(ring);
    }
    if (text) /** @type {HTMLElement} */ (ring.querySelector(".studio-busy-text")).textContent = text;
  }

  function status(/** @type {string} */ text, /** @type {boolean} */ bad = false) {
    if (busyOn && !bad) setBusy(true, text);
    const line = q(".studio-status");
    if (!line) return;
    line.textContent = text;
    line.classList.toggle("studio-bad", bad);
  }

  /** The page is on this computer (the studio is refused from a phone, and so is its own page). */
  function onThisComputer() {
    return /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
  }

  function close() {
    hideAssist();
    setBusy(false);
    panel?.remove();
    panel = null;
    zoom?.remove();
    zoom = null;
  }

  /** The studio is off and the user asked for it: ask whether to turn it on. The yes is the opt-in; the server then opens the panel (studio-open). */
  function askToOpen() {
    document.querySelector('.pack-confirm[data-kind="studio-ask"]')?.remove();
    const box = el("div", { className: "pack-confirm", role: "alertdialog", ariaLabel: "Turn on the pack studio?" });
    box.dataset.kind = "studio-ask";
    const yes = el("button", { type: "button", textContent: "Turn on the pack studio" });
    const no = el("button", { type: "button", className: "ghost", textContent: "Not now" });
    no.onclick = () => box.remove();
    yes.onclick = () => {
      box.remove();
      io.send({ type: "studio-on" });
    };
    box.append(
      el("p", { textContent: "The pack studio makes picture packs of her on this computer with an image model you run, and it is off until you turn it on. Turn it on and open it now?" }),
      el("div", { className: "pack-confirm-buttons" }, yes, no),
    );
    io.host()?.append(box);
    yes.focus();
  }

  // --- the panel is a stepper: goal, the pack to draw from, what should change, who draws it, review and start. A finished step is one line with "Change". ---

  const STEPS = ["goal", "source", "words", "maker", "start"];
  /** What the user is making: a whole new outfit, or one picture of a pack drawn again. */
  /** @type {"new" | "redraw" | ""} */
  let mode = "";
  let stage = 0;
  let initialised = false;
  /** Which character's outfits the picker is showing ("" is the characters). */
  let openCharacter = "";
  /** Which character each pack belongs to ({ pack: { id, name } }), from the server. */
  /** @type {Record<string, { id: string, name: string }>} */
  let characters = {};
  /** @type {Record<string, HTMLElement>} */
  let stepBoxes = {};

  /** The choices the user made last time (this browser only; nothing here matters to the server): the studio opens on them. */
  function remembered() {
    try {
      return JSON.parse(localStorage.getItem("studio-last") || "{}") || {};
    } catch {
      return {};
    }
  }
  function remember(/** @type {Record<string, string>} */ patch) {
    try {
      localStorage.setItem("studio-last", JSON.stringify({ ...remembered(), ...patch }));
    } catch {}
  }

  const makerChoice = () => makers.find((m) => m.value === maker);
  const makerReady = () => Boolean(makerChoice()) && makerChoice()?.available !== false;
  const COST = /** @type {Record<string, string>} */ ({ free: "free", "per-picture": "paid per picture", allowance: "uses your allowance" });

  function setStage(/** @type {number} */ n) {
    stage = Math.max(0, Math.min(STEPS.length - 1, n));
    refreshSteps();
  }

  /** The words next to each step (what was chosen), and which steps are open, done or waiting. */
  function refreshSteps() {
    if (!panel) return;
    const pick = /** @type {HTMLSelectElement | null} */ (q("#studio-source"));
    const char = pick?.value ? characters[pick.value] : null;
    const outfit = /** @type {HTMLTextAreaElement | null} */ (q("#studio-outfit"));
    const frameName = /** @type {HTMLSelectElement | null} */ (q("#studio-frame-name"));
    const chosen = makerChoice();
    /** @type {Record<string, string>} */
    const words = {
      goal: mode === "new" ? "Design a new outfit" : mode === "redraw" ? "Redraw a picture" : "",
      source: mode && pick?.value ? (char ? `${char.name} › ${outfitLabel(pick.value, char.id)}` : pick.value) : "",
      words: !mode ? "" : mode === "redraw" ? frameName?.value || "" : (outfit?.value || "").slice(0, 70),
      maker: chosen ? `${chosen.available === false ? "not ready" : "ready"} · ${chosen.label}` : "",
      start: "",
    };
    STEPS.forEach((key, i) => {
      const box = stepBoxes[key];
      if (!box) return;
      const active = i === stage;
      box.classList.toggle("studio-step-active", active);
      box.classList.toggle("studio-step-done", !active && Boolean(words[key]) && (i < stage || key === "maker"));
      const done = box.classList.contains("studio-step-done");
      /** @type {HTMLElement} */ (box.querySelector(".studio-step-num")).textContent = done ? "✓" : String(i + 1);
      /** @type {HTMLElement} */ (box.querySelector(".studio-step-val")).textContent = active ? "" : words[key];
      /** @type {HTMLElement} */ (box.querySelector(".studio-step-change")).hidden = active || !words[key];
      /** @type {HTMLElement} */ (box.querySelector(".studio-step-body")).hidden = !active;
    });
    // The two kinds of work share the third and the last step; only the fields differ.
    for (const n of panel.querySelectorAll("[data-for]")) /** @type {HTMLElement} */ (n).hidden = /** @type {HTMLElement} */ (n).dataset.for !== mode;
    const review = q(".studio-review-lines");
    if (review) {
      const frameSaved = /** @type {HTMLInputElement | null} */ (q("#studio-frame-pack"))?.value.trim();
      const rows = [["Drawn from", words.source], [mode === "redraw" ? "Picture" : "Change", words.words], ...(mode === "redraw" ? [["Result", frameSaved ? `a new pack called ${frameSaved}` : "the picture is changed in the pack itself (the original is kept)"]] : []), ["Maker", chosen?.label ?? ""]];
      review.replaceChildren(...rows.filter(([, v]) => v).flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v })]));
    }
  }

  function chooseMode(/** @type {"new" | "redraw"} */ next) {
    mode = next;
    remember({ mode });
    renderSources();
    renderFrames();
    setStage(1);
  }

  /** @param {string} pack */
  function choosePack(pack) {
    const select = /** @type {HTMLSelectElement | null} */ (q("#studio-source"));
    if (!select) return;
    sourceTouched = true; // only the user's own choice counts: it keeps the form from being moved back to the pack she wears
    openFrameGroup = "";
    select.value = pack;
    select.onchange?.(new Event("change"));
    const frameSource = /** @type {HTMLSelectElement | null} */ (q("#studio-frame-source"));
    if (frameSource) frameSource.value = pack;
    fillFrames();
    remember({ source: pack });
    renderSources();
    setStage(2);
  }

  /** A pack's outfit as a label: its folder name without the character's id in front ("risa-casual" is "casual"). */
  function outfitLabel(/** @type {string} */ pack, /** @type {string} */ id) {
    return pack.toLowerCase().startsWith(`${id}-`) ? pack.slice(id.length + 1) : pack;
  }

  function tile(/** @type {string} */ src, /** @type {string} */ label, /** @type {string} */ sub, /** @type {boolean} */ selected, /** @type {() => void} */ onclick, /** @type {string} */ full = "") {
    const t = el("button", { type: "button", className: `preset${selected ? " studio-selected" : ""}`, title: sub ? `${label}: ${sub}` : label });
    t.append(el("img", { src, alt: "", loading: "lazy" }), el("span", { className: "preset-name", textContent: label }));
    if (sub) t.append(el("span", { className: "studio-tile-sub", textContent: sub }));
    t.onclick = onclick;
    if (full) attachZoomUrl(t, full, src);
    return t;
  }

  const packThumb = (/** @type {string} */ pack) => `pack-thumb/${encodeURIComponent(pack)}`;
  /** A pack's neutral picture as it is, for the large view under the pointer. */
  const packWhole = (/** @type {string} */ pack) => `pack-frame/${encodeURIComponent(pack)}/neutral/full`;

  /** The characters as tiles, then the outfits of the one that was opened: a thumbnail for each, so nobody has to guess from a folder name. */
  function renderSources() {
    const box = q(".studio-thumbs");
    const crumbs = q(".studio-crumbs");
    const select = /** @type {HTMLSelectElement | null} */ (q("#studio-source"));
    if (!box || !crumbs || !select) return;
    /** @type {Map<string, { id: string, label: string, packs: string[] }>} */
    const groups = new Map();
    for (const s of sources) {
      const c = characters[s];
      const id = c?.id ?? `pack:${s}`;
      if (!groups.has(id)) groups.set(id, { id, label: c?.name ?? s, packs: [] });
      groups.get(id)?.packs.push(s);
    }
    const open = openCharacter ? groups.get(openCharacter) : null;
    if (open && open.packs.length > 1) {
      const back = el("button", { type: "button", className: "ghost studio-crumb", textContent: "Characters" });
      back.onclick = () => {
        openCharacter = "";
        renderSources();
      };
      crumbs.replaceChildren(back, ` › ${open.label} › choose an outfit`);
      hideZoom();
      box.replaceChildren(...open.packs.map((p) => tile(packThumb(p), outfitLabel(p, open.id), "", p === select.value, () => choosePack(p), packWhole(p))));
      return;
    }
    openCharacter = "";
    crumbs.textContent = sources.length ? "Choose a character" : "There are no packs on this computer to draw from.";
    hideZoom(); // the tile under the pointer is gone
    box.replaceChildren(
      ...[...groups.values()].map((g) =>
        tile(packThumb(g.packs.includes(select.value) ? select.value : g.packs[0]), g.label, g.packs.length > 1 ? `${g.packs.length} outfits` : "", g.packs.includes(select.value), () => {
          if (g.packs.length === 1) return choosePack(g.packs[0]);
          openCharacter = g.id;
          renderSources();
        }, packWhole(g.packs.includes(select.value) ? select.value : g.packs[0])),
      ),
    );
  }

  /** The picture a name belongs to: angry-blink, angry-talk2 and angry are all "angry"; cheer-1 is "cheer"; activity-dancing-talk-3 is "activity-dancing". */
  function frameGroup(/** @type {string} */ name) {
    const act = /^(activity-.+?)(?:-talk)?-\d+$/.exec(name);
    if (act) return act[1];
    return name.replace(/-blink$/, "").replace(/-talk\d*$/, "").replace(/-\d+$/, "");
  }

  /** Which group of pictures the picker has opened ("" is the list of groups). */
  let openFrameGroup = "";

  /**
   * The pictures of the chosen pack, grouped: one tile for each emotion, pose or activity (with its main picture as the thumbnail), and a click on a
   * group with variations (blinks, mouth shapes, the numbered pictures of a loop) shows those in its place.
   */
  function renderFrames() {
    const box = q(".studio-frame-chips");
    const source = /** @type {HTMLSelectElement | null} */ (q("#studio-frame-source"));
    const name = /** @type {HTMLSelectElement | null} */ (q("#studio-frame-name"));
    if (!box || !source || !name) return;
    const pack = source.value;
    const pictures = frames[pack] ?? [];
    /** @type {Map<string, string[]>} */
    const groups = new Map();
    for (const p of pictures) {
      const key = frameGroup(p);
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    const thumb = (/** @type {string} */ f) => `pack-frame/${encodeURIComponent(pack)}/${encodeURIComponent(f)}`;
    const whole = (/** @type {string} */ f) => `${thumb(f)}/full`;
    const pickFrame = (/** @type {string} */ f) => {
      name.value = f;
      renderFrames();
      refreshSteps();
    };
    const changed = new Set(edited[pack] ?? []);
    const restore = q(".studio-restore");
    if (restore) {
      restore.replaceChildren();
      if (changed.has(name.value)) {
        const back = el("button", { type: "button", className: "ghost", textContent: `Put the original ${name.value} back`, title: "Replaces the picture you drew again with the one the pack had before" });
        back.onclick = () => {
          back.disabled = true;
          io.send({ type: "studio-frame-restore", source: pack, frame: name.value });
        };
        restore.append(el("p", { className: "studio-help", textContent: `${name.value} was drawn again in this pack.` }), back);
      }
    }
    const members = openFrameGroup ? groups.get(openFrameGroup) : null;
    const crumbs = el("div", { className: "studio-crumbs" });
    const grid = el("div", { className: "studio-thumbs studio-thumbs-small" });
    if (members && members.length > 1) {
      const back = el("button", { type: "button", className: "ghost studio-crumb", textContent: "All pictures" });
      back.onclick = () => {
        openFrameGroup = "";
        renderFrames();
      };
      crumbs.append(back, ` › ${openFrameGroup} › choose the one to change`);
      // The main picture first, then the variations by their number.
      const sorted = [...members].sort((a, b) => Number(a !== openFrameGroup) - Number(b !== openFrameGroup) || a.localeCompare(b, undefined, { numeric: true }));
      grid.append(...sorted.map((f) => tile(thumb(f), f === openFrameGroup ? "main" : f.slice(openFrameGroup.length + 1) || f, changed.has(f) ? "changed" : "", f === name.value, () => pickFrame(f), whole(f))));
    } else {
      openFrameGroup = "";
      crumbs.textContent = pictures.length ? "Choose a picture. A group with variations (blinks, mouth shapes, loops) opens on a click." : "This pack has no pictures to draw again.";
      const keys = [...groups.keys()].sort((a, b) => Number(a.startsWith("activity-")) - Number(b.startsWith("activity-")) || a.localeCompare(b));
      grid.append(
        ...keys.map((k) => {
          const list = groups.get(k) ?? [];
          // The thumbnail is the main picture: the one named like the group, else the first by number.
          const main = list.includes(k) ? k : [...list].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
          const selected = list.includes(name.value);
          const some = list.filter((f) => changed.has(f)).length;
          return tile(thumb(main), k, [list.length > 1 ? `${list.length} pictures` : "", some ? (list.length > 1 ? `${some} changed` : "changed") : ""].filter(Boolean).join(" · "), selected, () => (list.length > 1 ? ((openFrameGroup = k), renderFrames()) : pickFrame(k)), whole(main));
        }),
      );
    }
    hideZoom(); // the tile under the pointer is gone
    box.replaceChildren(crumbs, grid);
  }

  /** The steps are hidden while a job is drawn, waits for the pick or the review: then the pictures are the page. */
  function stepsHidden(/** @type {boolean} */ hidden) {
    const steps = q(".studio-steps");
    if (steps) steps.hidden = hidden;
  }

  /** The studio opens on what the user did last time: the same kind of work, the same pack and the same maker, one step from the start. */
  function initStage() {
    if (initialised || !panel || !sources.length) return;
    initialised = true;
    const last = remembered();
    const select = /** @type {HTMLSelectElement | null} */ (q("#studio-source"));
    if ((last.mode === "new" || last.mode === "redraw") && sources.includes(last.source) && select) {
      mode = last.mode;
      choosePackQuiet(last.source);
      setStage(2);
    } else setStage(0);
  }

  function choosePackQuiet(/** @type {string} */ pack) {
    const select = /** @type {HTMLSelectElement | null} */ (q("#studio-source"));
    const frameSource = /** @type {HTMLSelectElement | null} */ (q("#studio-frame-source"));
    if (select) {
      sourceTouched = true;
      select.value = pack;
      select.onchange?.(new Event("change"));
    }
    if (frameSource) frameSource.value = pack;
    fillFrames();
    renderSources();
  }

  function open() {
    if (!on) return askToOpen();
    if (panel) return close(); // the same menu entry again closes it
    const source = el("select", { id: "studio-source", hidden: true, ariaLabel: "Draw from this pack" });
    const name = el("input", { type: "text", id: "studio-name", title: "The folder name of the new pack in data/frames. A name that is taken is refused; nothing is replaced.", maxLength: 40, placeholder: "name of the new pack", ariaLabel: "Name of the new pack" });
    const outfit = el("textarea", { id: "studio-outfit", title: "What she wears in the new pack. The image maker is told this, with the rest of the picture kept the same.", rows: 3, maxLength: 400, placeholder: "her new outfit, in your own words (a dark green winter coat over a white sweater)", ariaLabel: "The new outfit" });
    outfit.addEventListener("input", refreshSteps);
    const look = el("textarea", { id: "studio-look", title: "The line she uses to say what she wears (look.txt). Left empty it is made from the outfit.", rows: 2, maxLength: 600, placeholder: "optional: how she says what she wears (You wear …). Left empty, it is made from the outfit.", ariaLabel: "What she says she wears" });
    const count = el("select", { id: "studio-count", title: "How many different first pictures are drawn for you to pick the best from. A paid maker charges for each one.", ariaLabel: "How many first pictures to draw" }, ...[4, 3, 2, 1].map((n) => el("option", { value: String(n), textContent: n === 4 ? "4 (you pick the best)" : String(n) })));
    const makerSelect = el("select", { id: "studio-maker", hidden: true, ariaLabel: "Which image maker draws it" });
    makerSelect.onchange = () => {
      maker = makerSelect.value;
      remember({ maker });
      io.send({ type: "studio-backend", value: makerSelect.value });
      fillMakers();
    };
    const localBox = el("details", { className: "studio-local" },
      el("summary", { textContent: "Start my own image server (a local model you set up yourself)" }),
      el("label", { textContent: "Python (whole path)", htmlFor: "studio-local-python" }),
      el("input", { type: "text", id: "studio-local-python", autocomplete: "off", placeholder: "/path/to/your/venv/bin/python", title: "The Python of the environment that has your image model's packages. Only a file you name; the app never searches for one." }),
      el("label", { textContent: "Server script (whole path)", htmlFor: "studio-local-server" }),
      el("input", { type: "text", id: "studio-local-server", autocomplete: "off", placeholder: "whole path of your server script (the one in this app's python/pack_studio folder, or your own)", title: "A script that speaks the studio's protocol on 127.0.0.1 and takes --port and --device (docs: A model on your computer)." }),
      el("label", { textContent: "Device", htmlFor: "studio-local-device" }),
      el("select", { id: "studio-local-device", title: "mps is a Mac's graphics, cuda an NVIDIA card. cpu works but is very slow." }, ...["mps", "cuda", "cpu"].map((d) => el("option", { value: d, textContent: d }))),
      el("div", { className: "pack-confirm-buttons" },
        el("button", { type: "button", className: "ghost", id: "studio-local-save", textContent: "Save paths" }),
        el("button", { type: "button", id: "studio-local-start", textContent: "Start the server" }),
        el("button", { type: "button", className: "ghost", id: "studio-local-stop", textContent: "Stop it", hidden: true })),
      el("div", { className: "studio-local-card" }),
      el("p", { className: "studio-local-status", role: "status" }),
      el("pre", { className: "studio-local-log", hidden: true }),
    );
    const localValue = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (localBox.querySelector(id)).value;
    /** @type {HTMLElement} */ (localBox.querySelector("#studio-local-save")).onclick = () => io.send({ type: "studio-local-config", python: localValue("#studio-local-python"), server: localValue("#studio-local-server") });
    /** @type {HTMLElement} */ (localBox.querySelector("#studio-local-start")).onclick = () => {
      io.send({ type: "studio-local-start", python: localValue("#studio-local-python"), server: localValue("#studio-local-server"), device: localValue("#studio-local-device") });
    };
    /** @type {HTMLElement} */ (localBox.querySelector("#studio-local-stop")).onclick = () => io.send({ type: "studio-local-stop" });
    const models = el("div", { className: "studio-models", ariaLabel: "Image makers and what each needs" });
    const chip = el("button", { type: "button", className: "ghost studio-chip-maker", ariaExpanded: "false" });
    chip.onclick = () => {
      models.hidden = !models.hidden;
      chip.setAttribute("aria-expanded", String(!models.hidden));
    };
    models.hidden = true;
    const start = el("button", { type: "button", className: "studio-start", textContent: "Draw outfits" });
    const stop = el("button", { type: "button", className: "ghost studio-stop", textContent: "Stop", hidden: true });
    const closeButton = el("button", { type: "button", className: "ghost", textContent: "Close", ariaLabel: "Close the pack studio" });
    const frameSource = el("select", { id: "studio-frame-source", hidden: true, ariaLabel: "Draw one picture again from this pack" });
    const frameName = el("select", { id: "studio-frame-name", hidden: true, ariaLabel: "Which picture of it" });
    const framePrompt = el("textarea", { id: "studio-frame-prompt", title: "Only this is changed in the picture; the character, pose and framing are asked to stay the same.", rows: 2, maxLength: 400, placeholder: "what to change in that picture, in your own words (a red scarf around her neck)", ariaLabel: "What to change in the picture" });
    const framePack = el("input", { type: "text", id: "studio-frame-pack", title: "Leave it empty to change the picture in the pack itself (the original is kept in it and can be put back). A name makes a new pack, a copy of this one with the picture changed.", maxLength: 40, placeholder: "empty: change it in the pack itself", ariaLabel: "Name of a new pack for the picture, or empty to change the pack itself" });
    framePack.addEventListener("input", refreshSteps);
    const frameStart = el("button", { type: "button", className: "studio-frame-start", textContent: "Draw this picture again" });
    frameStart.onclick = () => {
      q(".studio-frame")?.replaceChildren();
      setBusy(true, "Drawing the picture again…");
      io.send({ type: "studio-frame-edit", source: frameSource.value, frame: frameName.value, prompt: framePrompt.value, name: framePack.value });
    };
    frameSource.onchange = () => {
      fillFrames();
      renderFrames();
    };
    const handover = el("button", { type: "button", className: "ghost", textContent: "Hand over to an AI agent…", title: "A prompt to copy into any AI agent that makes pictures, if no image maker here suits you" });
    handover.onclick = () => io.send({ type: "studio-handover", source: source.value, name: name.value, outfit: outfit.value });
    closeButton.onclick = () => {
      close();
      io.closeWindow?.();
    };
    // The same studio on its own page, in a new tab (or the desktop shell's browser). Only from this computer: a phone has no such page.
    const full = el("button", { type: "button", className: "ghost", textContent: "Open full studio", title: "The whole studio on its own page, in a new tab", hidden: !onThisComputer() || Boolean(io.closeWindow) }); // the full studio is this page: nothing to open
    full.onclick = () => window.open("/studio-full.html", "_blank", "noopener");
    stop.onclick = () => io.send({ type: "studio-cancel" });
    source.onchange = () => {
      if (!name.value || name.dataset.auto === "1") {
        name.value = `${source.value}-new`;
        name.dataset.auto = "1";
      }
      refreshSteps();
    };
    name.oninput = () => delete name.dataset.auto;
    start.onclick = () => {
      q(".studio-confirm")?.replaceChildren();
      q(".studio-candidates")?.replaceChildren();
      io.send({ type: "studio-start", source: source.value, name: name.value, outfit: outfit.value, look: look.value, pictures: Number(count.value) });
      status("Checking…");
    };
    const transferFolder = el("input", { id: "studio-transfer-folder", type: "text", placeholder: "Whole path of a folder, e.g. /Users/me/packs", autocomplete: "off" });
    const transferName = el("input", { id: "studio-transfer-name", type: "text", placeholder: "Name for an imported pack", autocomplete: "off", title: "Used by Import. Export uses the pack chosen in the steps." });
    const exportButton = el("button", { type: "button", className: "ghost", textContent: "Export the chosen pack", title: "Copies the pack chosen in the steps into a new folder of that name inside the folder given" });
    const importButton = el("button", { type: "button", className: "ghost", textContent: "Import a folder as a pack", title: "Copies the pictures of the folder given into a new pack of the name given" });
    exportButton.onclick = () => {
      io.send({ type: "studio-export", source: source.value, folder: transferFolder.value });
      setBusy(true, "Exporting…");
      status("Exporting…");
    };
    importButton.onclick = () => {
      io.send({ type: "studio-import", folder: transferFolder.value, name: transferName.value });
      setBusy(true, "Importing…");
      status("Importing…");
    };

    /** One step: its number, title, what was chosen, "Change", and the body that only the open step shows. */
    const step = (/** @type {string} */ key, /** @type {string} */ title, /** @type {string} */ help, /** @type {(Node | string)[]} */ ...body) => {
      const change = el("button", { type: "button", className: "studio-step-change ghost", textContent: "Change", hidden: true });
      change.onclick = () => setStage(STEPS.indexOf(key));
      const box = el("section", { className: "studio-step" },
        el("div", { className: "studio-step-head" }, el("span", { className: "studio-step-num" }), el("span", { className: "studio-step-title", textContent: title }), el("span", { className: "studio-step-val" }), change),
        el("div", { className: "studio-step-body" }, help ? el("p", { className: "studio-help", textContent: help }) : "", ...body),
      );
      box.dataset.step = key;
      stepBoxes[key] = box;
      return box;
    };
    const forMode = (/** @type {"new" | "redraw"} */ m, /** @type {(Node | string)[]} */ ...kids) => {
      const box = el("div", {}, ...kids);
      box.dataset.for = m;
      return box;
    };
    const next = (/** @type {() => number} */ to) => {
      const b = el("button", { type: "button", textContent: "Next" });
      b.onclick = () => setStage(to());
      return el("div", { className: "pack-confirm-buttons" }, b);
    };
    const goalButton = (/** @type {"new" | "redraw"} */ m, /** @type {string} */ title, /** @type {string} */ sub) => {
      const b = el("button", { type: "button", className: "ghost studio-goal" }, el("strong", { textContent: title }), el("span", { textContent: sub }));
      b.onclick = () => chooseMode(m);
      return b;
    };
    const pickMaker = el("div", { className: "pack-confirm-buttons" });
    const makerNext = el("button", { type: "button", className: "studio-maker-next", textContent: "Next" });
    makerNext.onclick = () => setStage(4);
    pickMaker.append(makerNext);
    const moreBox = el("details", { className: "studio-more" },
      el("summary", { textContent: "More…" }),
      el("p", { className: "studio-help", textContent: "Rarely needed: a pack as a folder of pictures (nothing is ever written over a folder that exists), your own image server, and a prompt for any AI agent." }),
      localBox,
      el("label", { textContent: "Import and export", htmlFor: "studio-transfer-folder" }),
      transferFolder,
      transferName,
      el("div", { className: "pack-confirm-buttons" }, exportButton, importButton),
      el("div", { className: "pack-confirm-buttons" }, handover),
      el("div", { className: "studio-handover" }),
    );
    stepBoxes = {};
    panel = el(
      "div",
      { className: "studio", role: "dialog", ariaLabel: "Pack studio" },
      el("div", { className: "studio-top" }, el("div", { className: "gallery-title", textContent: "Pack studio" }), full, closeButton),
      el("div", { className: "studio-assist", hidden: true }),
      el("div", { className: "studio-proposal" }),
      el("div", { className: "studio-resume" }),
      el("div", { className: "studio-steps" },
        step("goal", "What do you want to do?", "", el("div", { className: "studio-goals" }, goalButton("new", "Design a new outfit", "A new pack, made from one of her outfits"), goalButton("redraw", "Redraw a picture", "Change one picture of a pack you have"))),
        step("source", "Draw from", "Only read: nothing in the pack you pick is changed.", el("div", { className: "studio-crumbs" }), el("div", { className: "studio-thumbs" }), source, frameSource, frameName),
        step("words", "What should change?", "",
          forMode("new", el("label", { textContent: "Her new outfit", htmlFor: "studio-outfit" }), outfit,
            el("label", { textContent: "Name of the new pack", htmlFor: "studio-name" }), name,
            el("details", {}, el("summary", { textContent: "Her words for it (optional)" }), look)),
          forMode("redraw", el("label", { textContent: "Which picture" }), el("div", { className: "studio-frame-chips" }),
            el("label", { textContent: "What to change in it", htmlFor: "studio-frame-prompt" }), framePrompt,
            el("label", { textContent: "Save as a new pack instead (optional)", htmlFor: "studio-frame-pack" }), framePack, el("div", { className: "studio-restore" })),
          next(() => (makerReady() ? 4 : 3))),
        step("maker", "Who draws it?", "Web services cost money or allowance; the next question says what.", chip, models, makerSelect, pickMaker),
        step("start", "Review and start", "",
          el("dl", { className: "studio-review-lines" }),
          forMode("new", el("label", { textContent: "First pictures (a paid service charges for each)", htmlFor: "studio-count" }), count,
            el("details", {}, el("summary", { textContent: "What is in a pack?" }), el("p", { className: "studio-contents", textContent: `A full pack is ${packSize || "39"} pictures: the neutral picture, six expressions, thinking, four poses, and for each expression a blink and three mouth shapes. Each picture is checked and drawn again when a check fails (up to three tries).` }))),
          el("div", { className: "pack-confirm-buttons" }, forMode("new", start), forMode("redraw", frameStart), stop)),
      ),
      el("p", { className: "studio-status", role: "status" }),
      el("p", { className: "studio-spend", role: "status" }),
      el("div", { className: "studio-confirm" }),
      el("div", { className: "studio-frame" }),
      el("div", { className: "studio-candidates" }),
      moreBox,
    );
    io.host()?.append(panel);
    zoom = el("div", { className: "studio-zoom", hidden: true }, el("img", { alt: "" }));
    io.host()?.append(zoom);
    initialised = false;
    fillSources();
    fillMakers();
    fillFrames();
    renderFrames();
    source.onchange?.(new Event("change"));
    if (!initialised) setStage(0);
    io.send({ type: "studio-state" }); // a job that is already going (or waiting for the pick) is shown again
  }

  // --- looking at the pictures: the pointer over a small one shows it at full size, beside the panel ---

  /** @type {HTMLElement | null} */
  let zoom = null;
  /** Full-size pictures already fetched, by `<job>/<name>`. */
  const fullSize = new Map();
  let zoomKey = "";

  /**
   * She proposed an outfit while the studio is off: ask whether to turn it on. The yes (it only counts from this computer) is the opt-in, and
   * her words are in the form when the panel opens.
   */
  function ask(/** @type {Record<string, any>} */ msg) {
    document.querySelector('.pack-confirm[data-kind="studio-ask"]')?.remove();
    const box = el("div", { className: "pack-confirm", role: "alertdialog", ariaLabel: "Turn on the pack studio?" });
    box.dataset.kind = "studio-ask";
    const outfit = typeof msg.outfit === "string" && msg.outfit ? ` “${msg.outfit}”` : "";
    const backend = typeof msg.backend === "string" && msg.backend ? ` (${msg.backend})` : "";
    const yes = el("button", { type: "button", textContent: "Turn on the pack studio" });
    const no = el("button", { type: "button", className: "ghost", textContent: "Not now" });
    no.onclick = () => box.remove();
    yes.onclick = () => {
      box.remove();
      io.send({ type: "studio-on" });
    };
    box.append(
      el("p", { textContent: `She suggested an outfit for the pack studio:${outfit || " (no words yet)"}. The studio makes picture packs of her on this computer with an image model you run${backend}, and it is off until you turn it on. Turn it on and open it with her words?` }),
      el("div", { className: "pack-confirm-buttons" }, yes, no),
    );
    io.host()?.append(box);
    yes.focus();
  }

  function showZoom(/** @type {string} */ id, /** @type {string} */ name, /** @type {string} */ thumb) {
    if (!zoom) return;
    zoomKey = `${id}/${name}`;
    const img = /** @type {HTMLImageElement} */ (zoom.firstElementChild);
    img.src = fullSize.get(zoomKey) ?? thumb; // the small one at once, the full one when it arrives
    // Beside the panel when the stage is wide enough for a picture there, else over the whole stage (the pointer goes through it).
    zoom.classList.toggle("beside", (zoom.parentElement?.clientWidth ?? 0) - 576 >= 320);
    zoom.hidden = false;
    if (!fullSize.has(zoomKey)) io.send({ type: "studio-full", id, name });
  }

  function hideZoom() {
    zoomKey = "";
    if (zoom) zoom.hidden = true;
  }

  function attachZoom(/** @type {HTMLElement} */ node, /** @type {string} */ id, /** @type {string} */ name, /** @type {string} */ thumb) {
    node.addEventListener("mouseenter", () => showZoom(id, name, thumb));
    node.addEventListener("focus", () => showZoom(id, name, thumb));
    node.addEventListener("mouseleave", hideZoom);
    node.addEventListener("blur", hideZoom);
  }

  /** A picture that is a plain address (a pack's picture), shown large under the pointer the same way: the small one at once, the whole one when it has loaded. */
  function attachZoomUrl(/** @type {HTMLElement} */ node, /** @type {string} */ url, /** @type {string} */ thumb) {
    const show = () => {
      if (!zoom) return;
      zoomKey = url;
      const img = /** @type {HTMLImageElement} */ (zoom.firstElementChild);
      img.src = thumb;
      const big = new Image();
      big.onload = () => {
        if (zoomKey === url) img.src = url;
      };
      big.src = url;
      zoom.classList.toggle("beside", (zoom.parentElement?.clientWidth ?? 0) - 576 >= 320);
      zoom.hidden = false;
    };
    node.addEventListener("mouseenter", show);
    node.addEventListener("focus", show);
    node.addEventListener("mouseleave", hideZoom);
    node.addEventListener("blur", hideZoom);
  }

  const isThumb = (/** @type {unknown} */ t) => typeof t === "string" && t.startsWith("data:image/webp;base64,");

  function addCandidate(/** @type {string} */ id, /** @type {number} */ seed, /** @type {unknown} */ thumb, /** @type {number} */ number) {
    const grid = q(".studio-candidates");
    grid?.classList.remove("studio-review");
    if (!grid || !isThumb(thumb)) return;
    const pick = el("button", { type: "button", className: "preset", title: "Use this one (the pointer over it shows it larger)", ariaLabel: `Use picture ${number}` });
    pick.append(el("img", { src: /** @type {string} */ (thumb), alt: `Candidate ${number}` }));
    attachZoom(pick, id, `seed-${seed}`, /** @type {string} */ (thumb));
    pick.onclick = () => {
      hideZoom();
      io.send({ type: "studio-pick", id, seed });
      grid.replaceChildren();
      status("Drawing the rest of her…");
      running(true);
    };
    grid.append(pick);
  }

  /** The pictures of the pack as a grid: it fills while the pack is drawn, and becomes the review. Returns the grid and the room for what the review adds. */
  function tilesBox() {
    const box = q(".studio-candidates");
    if (!box) return null;
    let grid = /** @type {HTMLElement | null} */ (box.querySelector(".studio-tiles"));
    if (!grid) {
      box.classList.add("studio-review");
      grid = el("div", { className: "studio-tiles" });
      box.replaceChildren(grid, el("div", { className: "studio-extra" }));
    }
    return { grid, extra: /** @type {HTMLElement} */ (box.querySelector(".studio-extra")) };
  }

  /** One tile: made, or made again (it takes the old one's place). Selectable only once the pack is done. */
  function setTile(/** @type {string} */ id, /** @type {{ name: string, thumb: unknown, flagged?: boolean, flags?: string[] }} */ tile, /** @type {Set<string> | null} */ selected, /** @type {() => void} */ changed) {
    const parts = tilesBox();
    if (!parts || !isThumb(tile.thumb)) return;
    const label = `${tile.flagged ? "⚠ " : ""}${tile.name}`;
    const t = el("button", { type: "button", className: "preset", title: tile.flagged ? `${tile.name}: ${tile.flags?.length ? tile.flags.join("; ") : "a check failed"}` : tile.name, ariaLabel: tile.name });
    t.dataset.name = tile.name;
    t.append(el("img", { src: /** @type {string} */ (tile.thumb), alt: tile.name }), el("span", { className: "preset-name", textContent: label }));
    attachZoom(t, id, tile.name, /** @type {string} */ (tile.thumb));
    if (selected) {
      t.setAttribute("aria-pressed", "false");
      t.onclick = () => {
        const on = !selected.has(tile.name);
        if (on) selected.add(tile.name);
        else selected.delete(tile.name);
        t.setAttribute("aria-pressed", String(on));
        t.classList.toggle("studio-selected", on);
        changed();
      };
    }
    const old = Array.from(parts.grid.children).find((c) => /** @type {HTMLElement} */ (c).dataset.name === tile.name);
    // A picture made again keeps the one it replaced, small beside it, until the pack is used or left.
    const was = old ? old.querySelector("img")?.getAttribute("src") : null;
    if (was && was !== tile.thumb) {
      t.append(el("img", { src: was, alt: `${tile.name}, before`, className: "studio-was", title: "the picture before it was drawn again" }));
      t.classList.add("studio-redrawn");
    }
    if (old) old.replaceWith(t);
    else parts.grid.append(t);
  }

  /** The finished pack: a tile for each emotion and pose, what the checks found, and the choice to draw some again or use it. */
  function showReview(/** @type {string} */ id, /** @type {{ tiles?: any[], flagged?: any[] }} */ review) {
    const parts = tilesBox();
    if (!parts) return;
    /** @type {Set<string>} */
    const selected = new Set();
    const again = el("button", { type: "button", className: "ghost studio-action", textContent: "Draw the selected again", disabled: true });
    // Same seed keeps the picture as it is and only tries the checks again (the blur, mostly); a new seed draws it another way.
    const keepSeed = el("input", { type: "checkbox", id: "studio-keep-seed" });
    const use = el("button", { type: "button", className: "studio-action", textContent: "Use this pack" });
    for (const tile of review.tiles ?? []) setTile(id, tile, selected, () => (again.disabled = selected.size === 0));
    const notes = el("ul", { className: "studio-flags" });
    /** Drawing again: the tiles stay (the ones that are made again are replaced as they are drawn), the buttons wait. */
    const redraw = (/** @type {string[]} */ names, /** @type {string} */ text) => {
      io.send({ type: "studio-regen", id, names, sameSeed: keepSeed.checked });
      parts.extra.querySelectorAll("button").forEach((b) => ((/** @type {HTMLButtonElement} */ (b)).disabled = true));
      parts.grid.querySelectorAll("button").forEach((b) => b.removeAttribute("aria-pressed"));
      status(text);
      running(true);
    };
    for (const f of review.flagged ?? []) {
      const redo = el("button", { type: "button", className: "ghost studio-action", textContent: "Draw again" });
      redo.onclick = () => redraw([f.name], "Drawing it again…");
      notes.append(el("li", {}, el("strong", { textContent: `${f.name}: ` }), String((f.flags ?? []).join("; ")), " ", redo));
    }
    again.onclick = () => redraw([...selected], "Drawing them again…");
    use.onclick = () => {
      io.send({ type: "studio-accept", id });
      use.disabled = true;
      status("Writing the pack…");
    };
    parts.extra.replaceChildren(notes, el("label", { className: "studio-keep", htmlFor: "studio-keep-seed" }, keepSeed, " Same seed: keeps each picture, and only the checks are tried again (fixes blur, not a wrong pose or outfit)"), el("div", { className: "pack-confirm-buttons" }, use, again));
    // The panel scrolls and the buttons are below the pictures: bring them into view.
    parts.extra.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }

  /** What a paid backend has cost this job, always in view while it is drawn. */
  function spendLine(/** @type {number} */ usd, /** @type {number} */ limit) {
    const p = q(".studio-spend");
    if (!p) return;
    p.textContent = Number.isFinite(usd) && Number.isFinite(limit) ? `Paid so far: $${usd.toFixed(2)} of your $${limit.toFixed(2)} limit for this pack.` : "";
  }

  /** Jobs from an earlier session, as buttons that carry them on. */
  function showResumable(/** @type {any[]} */ jobs) {
    const box = q(".studio-resume");
    if (!box) return;
    box.replaceChildren(
      ...jobs.map((j) => {
        const stage = j.stage === "review" ? "ready to look at" : j.stage === "pick" ? "waiting for you to pick a picture" : "half drawn";
        const button = el("button", { type: "button", className: "ghost", textContent: `Carry on ${j.name} (${stage})` });
        button.title = String(j.outfit);
        button.onclick = () => {
          io.send({ type: "studio-resume", id: j.id });
          box.replaceChildren();
          status("Carrying on…");
        };
        const discard = el("button", { type: "button", className: "ghost", textContent: "Delete", title: `Delete the unfinished job ${j.name} from this computer (a pack already installed is kept)` });
        const row = el("div", { className: "pack-confirm-buttons" }, button, discard);
        discard.onclick = () => {
          if (!confirm(`Delete the unfinished job "${j.name}" (${j.outfit}) from this computer?`)) return;
          io.send({ type: "studio-discard", id: j.id });
          row.remove();
        };
        return row;
      }),
    );
  }

  /**
   * Something she proposed (chat): words for the form, or pictures to draw again. It only fills in what the user can read and change; the
   * user still presses the button, and the server asks its question before anything is drawn.
   */
  function applyProposal(/** @type {Record<string, any>} */ p) {
    if (!panel) open();
    const set = (/** @type {string} */ id, /** @type {unknown} */ value) => {
      const field = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (q(id));
      if (field && typeof value === "string" && value) field.value = value;
    };
    const select = /** @type {HTMLSelectElement | null} */ (q("#studio-source"));
    if (select && typeof p.source === "string" && sources.includes(p.source)) select.value = p.source;
    set("#studio-outfit", p.outfit);
    set("#studio-look", p.look);
    if (typeof p.name === "string" && p.name) {
      set("#studio-name", p.name);
      const name = q("#studio-name");
      if (name) delete name.dataset.auto;
    }
    const box = q(".studio-proposal");
    if (!box) return;
    box.replaceChildren();
    if (Array.isArray(p.redraw) && p.redraw.length && p.job) {
      const names = p.redraw.map(String);
      const go = el("button", { type: "button", textContent: `Draw ${names.join(", ")} again` });
      go.onclick = () => {
        io.send({ type: "studio-regen", id: String(p.job), names });
        box.replaceChildren();
        q(".studio-candidates")?.replaceChildren();
        status("Drawing them again…");
        running(true);
      };
      box.append(el("p", { textContent: "She suggests drawing these again:" }), go);
    } else if (p.outfit || p.name || p.look) {
      mode = "new";
      remember({ mode });
      renderSources();
      setStage(2);
      box.append(el("p", { textContent: "She suggested these words. Change anything, then go on to the end." }));
    }
  }

  /** The user's own image server: the paths, the card that asks before it starts, its status and what it printed. */
  function fillLocal(/** @type {any} */ local) {
    const box = q(".studio-local");
    if (!box || !local || typeof local !== "object") return;
    const python = /** @type {HTMLInputElement} */ (box.querySelector("#studio-local-python"));
    const server = /** @type {HTMLInputElement} */ (box.querySelector("#studio-local-server"));
    if (document.activeElement !== python && typeof local.python === "string") python.value = local.python;
    if (document.activeElement !== server && typeof local.server === "string") server.value = local.server;
    const status = String(local.status);
    const busy = status === "starting" || status === "running";
    /** @type {HTMLElement} */ (box.querySelector("#studio-local-start")).hidden = busy;
    /** @type {HTMLElement} */ (box.querySelector("#studio-local-stop")).hidden = !busy;
    const text = { stopped: "Not started by the app.", starting: "Starting… (the model itself loads on the first picture)", running: `Running at ${local.address}. It stops when you press Stop or turn the studio off.`, failed: `Did not start. ${local.problem ?? ""}` }[status] ?? "";
    const line = /** @type {HTMLElement} */ (box.querySelector(".studio-local-status"));
    line.textContent = `${text}${status === "stopped" && local.problem ? ` ${local.problem}` : ""}`;
    const log = /** @type {HTMLElement} */ (box.querySelector(".studio-local-log"));
    const lines = Array.isArray(local.log) ? local.log.map(String) : [];
    log.hidden = lines.length === 0;
    log.textContent = lines.join("\n");
    const card = /** @type {HTMLElement} */ (box.querySelector(".studio-local-card"));
    const ask = local.ask;
    if (!ask || typeof ask !== "object") return void card.replaceChildren();
    if (card.dataset.id === ask.id) return;
    card.dataset.id = ask.id;
    const yes = el("button", { type: "button", textContent: "Start it" });
    const no = el("button", { type: "button", className: "ghost", textContent: "Not now" });
    yes.onclick = () => io.send({ type: "studio-local-confirm", id: ask.id });
    no.onclick = () => io.send({ type: "studio-local-cancel" });
    card.replaceChildren(
      el("p", { textContent: `This starts a program on this computer: ${ask.command}` }),
      el("p", { textContent: `It runs your own script with your own Python, as you, in the script's folder. It listens on 127.0.0.1:${ask.port} only (this app only talks to that), and reads image models from ${ask.hub}. The app passes it no key, token or password from its environment. What the script does is yours to check; it stops when you press Stop or turn the studio off. Whatever it draws is your responsibility.` }),
      el("div", { className: "pack-confirm-buttons" }, yes, no),
    );
    yes.focus();
  }

  const GROUPS = [
    ["local", "On this computer"],
    ["paid", "Paid websites (a cost for each picture)"],
    ["browser", "Through your Chrome"],
    ["assisted", "By hand"],
  ];

  function fillMakers() {
    const list = q(".studio-models");
    const chip = q(".studio-chip-maker");
    const select = /** @type {HTMLSelectElement | null} */ (q("#studio-maker"));
    if (list) {
      /** @param {typeof makers[number]} m */
      const option = (m) => {
        const off = m.available === false;
        const b = el("button", { type: "button", className: `ghost studio-opt${m.value === maker ? " studio-selected" : ""}${off ? " studio-not-ready" : ""}`, disabled: off });
        b.append(
          el("span", { className: off ? "studio-dot studio-dot-off" : "studio-dot" }),
          el("span", { className: "studio-opt-label", textContent: m.label }),
          el("small", { textContent: off ? m.reason || "not ready" : COST[m.cost ?? "free"] ?? "" }),
        );
        b.onclick = () => {
          if (!select) return;
          select.value = m.value;
          select.dispatchEvent(new Event("change"));
          /** @type {HTMLElement} */ (list).hidden = true;
        };
        return b;
      };
      list.replaceChildren(
        ...GROUPS.flatMap(([kind, title]) => {
          // A site maker that cannot run now (it needs Claude as the brain, say) is left out: a greyed row only adds to the wall.
          const own = makers.filter((m) => m.kind === kind && !(kind === "browser" && m.available === false));
          if (!own.length) return [];
          const group = el("div", { className: "studio-group" }, el("h4", { textContent: title }), ...own.map(option));
          if (kind === "local" && own.some((m) => m.available === false)) {
            const more = el("button", { type: "button", className: "ghost", textContent: "Start my own image server…" });
            more.onclick = () => {
              const box = /** @type {HTMLDetailsElement | null} */ (q(".studio-more"));
              if (box) box.open = true;
              /** @type {HTMLDetailsElement | null} */ (q(".studio-local"))?.setAttribute("open", "");
              q(".studio-more")?.scrollIntoView?.({ block: "nearest" });
            };
            group.append(more);
          }
          return [group];
        }),
      );
    }
    const chosen = makerChoice();
    if (chip) {
      chip.replaceChildren(
        el("span", { className: chosen && chosen.available !== false ? "studio-dot" : "studio-dot studio-dot-off" }),
        el("span", { textContent: chosen ? `${chosen.label}${chosen.available === false && chosen.reason ? ` (${chosen.reason})` : ""}` : "Choose how it is drawn" }),
        el("span", { textContent: "▾" }),
      );
    }
    const nextButton = /** @type {HTMLButtonElement | null} */ (q(".studio-maker-next"));
    if (nextButton) nextButton.disabled = !makerReady();
    if (select) {
      // A maker that cannot be used now is listed with why, and cannot be picked (the server says the same when asked to draw).
      select.replaceChildren(...makers.map((m) => new Option(m.available === false && m.reason ? `${m.label} (${m.reason})` : m.label, m.value)));
      for (const o of select.options) o.disabled = makers.some((m) => m.value === o.value && m.available === false);
      if (makers.some((m) => m.value === maker)) select.value = maker;
      else select.prepend(new Option("Choose an image maker…", "", true, true));
    }
    // Nothing usable chosen: the list is open, so the next move is clear.
    if (list && !makerReady()) list.hidden = false;
    refreshSteps();
  }

  function fillFrames() {
    const source = /** @type {HTMLSelectElement | null} */ (q("#studio-frame-source"));
    const name = /** @type {HTMLSelectElement | null} */ (q("#studio-frame-name"));
    if (!source || !name) return;
    const keepSource = source.value;
    source.replaceChildren(...sources.map((s) => new Option(s, s)));
    if (sources.includes(keepSource)) source.value = keepSource;
    else if (sources.includes(active)) source.value = active;
    const keep = name.value;
    const pictures = frames[source.value] ?? [];
    name.replaceChildren(...pictures.map((p) => new Option(p, p)));
    if (pictures.includes(keep)) name.value = keep;
    else name.value = ""; // no picture is chosen until the user clicks one
    renderFrames();
  }

  /** One picture with a paid service or a browser maker: the question first, with what it costs and what it does (nothing is drawn before the yes). */
  function showFrameAsk(/** @type {Record<string, any>} */ a) {
    const box = q(".studio-frame");
    if (!box) return;
    const yes = el("button", { type: "button", textContent: a.paid ? "Draw this one picture (paid)" : a.browser ? "Draw this one picture (drives your Chrome)" : "Draw this one picture" });
    const no = el("button", { type: "button", className: "ghost", textContent: "Not now" });
    yes.onclick = () => {
      box.replaceChildren();
      setBusy(true, `Drawing ${a.frame} again…`);
      io.send({ type: "studio-frame-go", id: a.id });
    };
    no.onclick = () => io.send({ type: "studio-frame-ask-cancel" });
    box.replaceChildren(el("p", { textContent: String(a.note) }), el("div", { className: "pack-confirm-buttons" }, yes, no));
  }

  /** The drawn picture beside the one it replaces: keep it (a new pack is made) or drop it (nothing is written). */
  function showFrameReview(/** @type {Record<string, any>} */ r) {
    const box = q(".studio-frame");
    if (!box) return;
    const here = !r.name;
    const keep = el("button", { type: "button", textContent: here ? `Change it in ${r.source}` : "Keep as a new pack" });
    const drop = el("button", { type: "button", className: "ghost", textContent: "Drop it" });
    keep.onclick = () => io.send({ type: "studio-frame-accept", id: r.id });
    drop.onclick = () => io.send({ type: "studio-frame-reject", id: r.id });
    const flags = Array.isArray(r.flags) ? r.flags.map((/** @type {string} */ f) => el("li", { textContent: f })) : [];
    box.replaceChildren(
      el("p", { textContent: `${r.frame} from ${r.source}, drawn with ${r.model}. ${here ? `Keeping it changes the picture in the pack itself; the original stays in the pack and can be put back.${r.shipped ? " This pack comes with the app, so your changed copy of it is saved in your own pictures folder and used instead." : ""}` : `Keeping it makes a new pack called ${r.name}.`}` }),
      el("div", { className: "studio-frame-pair" },
        el("figure", {}, el("img", { src: String(r.old), alt: "before" }), el("figcaption", { textContent: "before" })),
        el("figure", {}, el("img", { src: String(r.new), alt: "after" }), el("figcaption", { textContent: "after" })),
      ),
      flags.length ? el("ul", { className: "studio-flags" }, ...flags) : el("p", { textContent: "The checks passed. Look at it by eye." }),
      el("div", { className: "pack-confirm-buttons" }, keep, drop),
    );
  }

  // --- the by-hand maker: the page shows the picture and the words, the user draws it elsewhere and gives the result back ---

  /** What the box shows now (job, picture number and error), so a state message that repeats it does not redraw the box and lose the user's place. */
  let assistKey = "";
  /** @type {((e: ClipboardEvent) => void) | null} */
  let assistPaste = null;

  function hideAssist() {
    assistKey = "";
    if (assistPaste) document.removeEventListener("paste", assistPaste);
    assistPaste = null;
    const box = q(".studio-assist");
    if (box) {
      box.hidden = true;
      box.replaceChildren();
    }
  }

  function readFile(/** @type {Blob} */ file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function showAssist(/** @type {Record<string, any>} */ a) {
    const box = q(".studio-assist");
    if (!box) return;
    const key = `${a.id}/${a.n}/${a.error || ""}`;
    if (key === assistKey && !box.hidden) return;
    assistKey = key;
    setBusy(false); // it waits for a person: a spinning ring would say it is working
    const words = el("textarea", { className: "studio-handover-text", rows: 4, readOnly: true, ariaLabel: "The words to give the image maker" });
    words.value = String(a.prompt || "");
    const copyWords = el("button", { type: "button", textContent: "Copy the words" });
    copyWords.onclick = () => navigator.clipboard?.writeText(words.value).then(() => (copyWords.textContent = "Copied"), () => (copyWords.textContent = "Select the words and copy them"));
    const picture = el("img", { src: typeof a.input === "string" ? a.input : "", alt: "The picture to change", className: "studio-assist-picture" });
    const copyPicture = el("button", { type: "button", className: "ghost", textContent: "Copy the picture", title: "Puts the picture on the clipboard, to paste into a site's prompt box" });
    copyPicture.onclick = async () => {
      try {
        const blob = await (await fetch(String(a.input))).blob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        copyPicture.textContent = "Copied";
      } catch {
        copyPicture.textContent = "Not copied: use Save the picture";
      }
    };
    const save = el("a", { className: "studio-assist-save", href: typeof a.input === "string" ? a.input : "#", download: `picture-${a.n}.png`, textContent: "Save the picture" });
    const sites = el("p", { className: "studio-assist-sites" }, "Any website or program that changes a picture from words works. A few: ",
      ...[["Grok Imagine", "https://grok.com/imagine"], ["Gemini", "https://gemini.google.com/app"], ["ChatGPT", "https://chatgpt.com/"]].flatMap(([label, href], i) => [i ? ", " : "", el("a", { href, target: "_blank", rel: "noopener noreferrer", textContent: label })]),
      ". What you give a site is between you and it.");
    const drop = el("div", { className: "studio-assist-drop", tabIndex: 0, role: "button", ariaLabel: "Give the finished picture back" }, "Drop the finished picture here, or paste it (Ctrl or Cmd + V), or ");
    const choose = el("button", { type: "button", textContent: "choose a file…" });
    const input = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true });
    drop.append(choose, input);
    const message = el("p", { className: "studio-assist-error", role: "status" });
    if (a.error) {
      message.textContent = String(a.error);
      message.classList.add("studio-bad");
    }
    /** @param {Blob | null | undefined} file */
    const give = async (file) => {
      if (!file || !file.type.startsWith("image/")) {
        message.textContent = "That is not a picture. Drop a PNG, JPEG or WebP.";
        message.classList.add("studio-bad");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        message.textContent = "That picture is larger than 5 MB. Save it smaller and give it again.";
        message.classList.add("studio-bad");
        return;
      }
      message.classList.remove("studio-bad");
      message.textContent = "Checking the picture…";
      io.send({ type: "studio-assist-result", id: a.id, n: a.n, image: await readFile(file) });
    };
    choose.onclick = () => input.click();
    input.onchange = () => void give(input.files?.[0]);
    drop.ondragover = (e) => {
      e.preventDefault();
      drop.classList.add("studio-assist-over");
    };
    drop.ondragleave = () => drop.classList.remove("studio-assist-over");
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove("studio-assist-over");
      void give(e.dataTransfer?.files?.[0]);
    };
    if (assistPaste) document.removeEventListener("paste", assistPaste);
    assistPaste = (e) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void give(file);
    };
    document.addEventListener("paste", assistPaste);
    const stop = el("button", { type: "button", className: "ghost", textContent: "Stop here" });
    stop.onclick = () => io.send({ type: "studio-cancel" });
    box.hidden = false;
    box.replaceChildren(
      el("p", { className: "studio-assist-title", textContent: "Your turn: draw this picture" }),
      a.text ? el("p", { className: "studio-assist-where", textContent: String(a.text) }) : "",
      el("ol", { className: "studio-assist-steps" },
        el("li", {}, "Take the words and the picture below to the website or program you like.", words, el("div", { className: "pack-confirm-buttons" }, copyWords, copyPicture, save)),
        el("li", {}, "Ask it to change the picture as the words say, and keep the plain background colour the same."),
        el("li", {}, "Give the result back here."),
      ),
      picture,
      sites,
      drop,
      message,
      el("div", { className: "pack-confirm-buttons" }, stop),
    );
  }

  function fillSources() {
    const select = /** @type {HTMLSelectElement | null} */ (q("#studio-source"));
    if (!select) return;
    const keep = select.value;
    select.replaceChildren(...sources.map((s) => new Option(s, s)));
    if (!sourceTouched && sources.includes(active)) select.value = active;
    else if (sources.includes(keep)) select.value = keep;
    select.onchange?.(new Event("change")); // the name of the new pack follows the pack it is drawn from, until the user has typed one
    if (!openCharacter && characters[select.value] && !initialised) openCharacter = "";
    renderSources();
    initStage();
    refreshSteps();
  }

  function running(/** @type {boolean} */ busy) {
    setBusy(busy, busy ? q(".studio-status")?.textContent || "Working…" : "");
    const picker = /** @type {HTMLSelectElement | null} */ (q("#studio-maker"));
    if (picker) picker.disabled = busy;
    for (const b of panel?.querySelectorAll(".studio-start, .studio-frame-start") ?? []) /** @type {HTMLButtonElement} */ (b).disabled = busy;
    const stop = q(".studio-stop");
    if (stop) stop.hidden = !busy;
    if (busy) stepsHidden(true);
  }

  return {
    open,
    /** Whether the panel is showing (the full studio's page opens it once, when the page is loaded). */
    isOpen: () => panel !== null,
    /** Handles the studio messages; false for anything else. */
    handle(/** @type {Record<string, any>} */ msg) {
      switch (msg.type) {
        case "studio-state":
          on = msg.on === true;
          if (on) document.querySelector('.pack-confirm[data-kind="studio-ask"]')?.remove();
          fillLocal(msg.local);
          // What the server says is going on (a job, a redraw, the local server starting) shows the ring too, after a reload as well.
          {
            const working = (Boolean(msg.running) || Boolean(msg.frameBusy) || msg.local?.status === "starting") && !msg.assist;
            if (working && !busyOn) {
              fromState = true;
              setBusy(true, msg.local?.status === "starting" ? "Starting the image server…" : msg.running ? `Drawing ${msg.running.name}…` : "Drawing the picture again…");
            } else if (!working && busyOn && fromState) {
              fromState = false;
              setBusy(false);
            }
          }
          if (msg.assist && typeof msg.assist === "object") {
            if (!panel) open();
            showAssist(msg.assist);
          } else hideAssist();
          makers = Array.isArray(msg.backends) ? msg.backends.filter((/** @type {any} */ b) => b && typeof b.value === "string" && typeof b.label === "string") : [];
          packSize = Number(msg.packSize) || 0;
          maker = typeof msg.backend === "string" ? msg.backend : "";
          fillMakers();
          characters = msg.characters && typeof msg.characters === "object" ? msg.characters : {};
          edited = msg.edited && typeof msg.edited === "object" ? msg.edited : {};
          sources = Array.isArray(msg.sources) ? msg.sources.filter((/** @type {unknown} */ s) => typeof s === "string") : [];
          active = typeof msg.active === "string" ? msg.active : "";
          if (!on) close();
          else {
            // A job is running or waits for the pick (this page was reloaded, or the panel was closed): show where it is.
            if (msg.job && !panel) open();
            fillSources();
            frames = msg.frames && typeof msg.frames === "object" ? msg.frames : {};
            fillFrames();
            if (msg.frameReview) showFrameReview(msg.frameReview);
            else if (msg.frameAsk) showFrameAsk(msg.frameAsk);
            else q(".studio-frame")?.replaceChildren();
            if (!msg.job && panel && Array.isArray(msg.resumable) && msg.resumable.length && !q(".studio-resume")?.childElementCount) showResumable(msg.resumable);
            if (msg.job && panel) {
              const grid = q(".studio-candidates");
              // A review that is waiting but whose buttons are missing (the pictures came first) is shown again whole.
              if (grid && msg.review && !q(".studio-extra")?.childElementCount) showReview(String(msg.job.id), msg.review);
              else if (grid && grid.childElementCount === 0) {
                if (msg.review) showReview(String(msg.job.id), msg.review);
                else if (Array.isArray(msg.previews) && msg.previews.length) for (const t of msg.previews) setTile(String(msg.job.id), t, null, () => {});
                else for (const c of Array.isArray(msg.candidates) ? msg.candidates : []) addCandidate(String(msg.job.id), c.seed, c.thumb, grid.childElementCount + 1);
              }
              status(String(msg.job.text || "Working…"));
            }
          }
          if (msg.proposal && panel && !q(".studio-proposal")?.childElementCount) applyProposal({ ...msg.proposal, job: msg.job?.reviewing ? msg.job.id : null });
          spendLine(Number(msg.spend?.usd), Number(msg.spend?.limit));
          running(Boolean(msg.running));
          stepsHidden(Boolean(msg.job) || Boolean(msg.running));
          document.dispatchEvent(new CustomEvent("studio-state", { detail: { on } }));
          return true;
        case "studio-spend":
          spendLine(Number(msg.usd), Number(msg.limit));
          return true;
        case "studio-assist":
          if (!panel) open();
          showAssist(msg);
          io.attention?.("Your turn: a picture waits for you");
          return true;
        case "studio-assist-done":
          hideAssist();
          return true;
        case "studio-frame-progress":
          status(String(msg.text));
          return true;
        case "studio-frame-ask":
          setBusy(false);
          showFrameAsk(msg);
          return true;
        case "studio-frame-review":
          setBusy(false);
          showFrameReview(msg);
          status("Look at the picture drawn: keep it as a new pack, or drop it.");
          return true;
        case "studio-frame-installed":
          setBusy(false);
          q(".studio-frame")?.replaceChildren();
          status(msg.here ? `Changed ${msg.frame} in ${msg.name}. The original is kept: pick the picture again to put it back.` : `Made ${msg.name}: the same pack with that picture drawn again.`);
          return true;
        case "studio-frame-restored":
          status(`Put the original ${msg.frame} back in ${msg.source}.`);
          return true;
        case "studio-transferred":
          setBusy(false);
          status(String(msg.message));
          return true;
        case "studio-frame-cancelled":
          hideAssist();
          setBusy(false);
          status(""); // the "look at the picture" line no longer applies
          q(".studio-frame")?.replaceChildren();
          return true;
        case "studio-ask":
          ask(msg);
          return true;
        case "studio-preview":
          setTile(String(msg.id), { name: String(msg.name), thumb: msg.thumb, flagged: msg.flagged === true, flags: Array.isArray(msg.flags) ? msg.flags : [] }, null, () => {});
          return true;
        case "studio-full":
          if (isThumb(msg.image)) {
            fullSize.set(`${msg.id}/${msg.name}`, msg.image);
            if (zoomKey === `${msg.id}/${msg.name}` && zoom) /** @type {HTMLImageElement} */ (zoom.firstElementChild).src = msg.image;
          }
          return true;
        case "studio-proposal":
          applyProposal(msg);
          return true;
        case "studio-handover": {
          // The prompt for an AI agent of the user's choice: shown whole, with a button that copies it (nothing is sent from here).
          if (typeof msg.prompt !== "string") return true;
          const text = msg.prompt;
          const box = q(".studio-handover");
          if (!box) {
            // From the chat command: the prompt in the chat, read-only, with a button that copies it.
            /** @type {any} */
            const shown = io.say("");
            const field = el("textarea", { className: "studio-handover-text", rows: 10, readOnly: true, ariaLabel: "Handover prompt" });
            field.value = text;
            const button = el("button", { type: "button", textContent: "Copy the prompt" });
            button.onclick = () => {
              field.select();
              navigator.clipboard?.writeText(text).then(() => (button.textContent = "Copied"), () => (button.textContent = "Select the text and copy it"));
            };
            shown?.append(field, button);
            return true;
          }
          const area = el("textarea", { className: "studio-handover-text", rows: 10, readOnly: true, ariaLabel: "Handover prompt" });
          area.value = text;
          const copy = el("button", { type: "button", textContent: "Copy the prompt" });
          copy.onclick = () => {
            area.select();
            navigator.clipboard?.writeText(text).then(() => (copy.textContent = "Copied"), () => (copy.textContent = "Select the text and copy it"));
          };
          box.replaceChildren(
            el("p", { textContent: "Paste this into an AI agent that makes pictures (a chat website, an agent, anything you use) and attach the neutral picture of the pack you start from. It follows a guide on the documentation site. What it makes is yours to check and answer for; nothing is sent from here." }),
            area,
            copy,
          );
          return true;
        }
        case "studio-open":
          if (!panel) open();
          return true;
        case "studio-confirm": {
          jobId = String(msg.id);
          const box = q(".studio-confirm");
          if (!box) return true;
          const paid = msg.paid && typeof msg.paid === "object";
          const browser = msg.browser && typeof msg.browser === "object";
          const yes = el("button", { type: "button", textContent: msg.assisted ? "Start (you draw each picture)" : `Draw ${msg.pictures} ${msg.pictures === 1 ? "picture" : "pictures"}${paid ? " (paid)" : browser ? " (drives your Chrome)" : ""}` });
          const no = el("button", { type: "button", className: "ghost", textContent: "Not now" });
          no.onclick = () => {
            box.replaceChildren();
            declined = true;
            io.send({ type: "studio-cancel" });
            status("");
          };
          yes.onclick = () => {
            box.replaceChildren();
            io.send({ type: "studio-confirm", id: jobId });
            running(true);
            status("Starting…");
          };
          box.replaceChildren(
            el("div", { className: paid || browser ? "pack-confirm studio-paid" : "pack-confirm", role: "alertdialog" }, el("p", { textContent: String(msg.note) }), el("div", { className: "pack-confirm-buttons" }, yes, no)),
          );
          status("");
          yes.focus();
          return true;
        }
        case "studio-progress":
          status(String(msg.text));
          running(true);
          return true;
        case "studio-candidate": {
          const grid = q(".studio-candidates");
          if (grid) addCandidate(String(msg.id), msg.seed, msg.thumb, Number(msg.done));
          return true;
        }
        case "studio-review":
          running(false);
          stepsHidden(true);
          showReview(String(msg.id), msg);
          io.attention?.(msg.flagged?.length ? "Pack ready: look at the flagged pictures" : "Pack ready to review");
          status(msg.flagged?.length ? `Done. ${msg.flagged.length} picture(s) did not pass every check: look at them.` : "Done. Look at the pack, then use it.");
          return true;
        case "studio-candidates-done":
          running(false);
          stepsHidden(true);
          io.attention?.("Pick a picture");
          status(typeof msg.text === "string" && msg.text ? msg.text : "Pick the one you like. Nothing is saved until you do.");
          return true;
        case "studio-installed": {
          running(false);
          stepsHidden(false);
          const name = String(msg.name);
          status(`Made ${name}: a draft pack, written to your pictures. Look it over in a chat before you rely on it.`);
          const show = el("button", { type: "button", textContent: `Show her as ${name}` });
          show.onclick = () => io.send({ type: "pack-select", name });
          q(".studio-candidates")?.replaceChildren(show);
          return true;
        }
        case "studio-error": {
          hideAssist();
          running(false);
          stepsHidden(false);
          io.attention?.("The studio stopped");
          status(String(msg.message), true);
          // A job that stopped part way is still on disk: one button carries it on from the picture that failed.
          q(".studio-retry")?.remove();
          if (msg.retry === "resume" && typeof msg.id === "string") {
            const again = el("button", { type: "button", className: "studio-retry", textContent: "Try again from here" });
            again.onclick = () => {
              again.remove();
              io.send({ type: "studio-resume", id: msg.id });
              status("Carrying on…");
            };
            q(".studio-status")?.after(again);
          }
          return true;
        }
        case "studio-cancelled":
          hideAssist();
          running(false);
          stepsHidden(false);
          q(".studio-confirm")?.replaceChildren();
          q(".studio-candidates")?.replaceChildren();
          status(declined ? "Nothing was drawn." : "Stopped.");
          declined = false;
          return true;
        default:
          return false;
      }
    },
    enabled: () => on,
  };
}
