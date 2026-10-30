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

  function status(/** @type {string} */ text, /** @type {boolean} */ bad = false) {
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

  function open() {
    if (!on) return askToOpen();
    if (panel) return close(); // the same menu entry again closes it
    const source = el("select", { id: "studio-source", ariaLabel: "Draw from this pack" });
    const name = el("input", { type: "text", id: "studio-name", maxLength: 40, placeholder: "name of the new pack", ariaLabel: "Name of the new pack" });
    const outfit = el("textarea", { id: "studio-outfit", rows: 3, maxLength: 400, placeholder: "her new outfit, in your own words (a dark green winter coat over a white sweater)", ariaLabel: "The new outfit" });
    const look = el("textarea", { id: "studio-look", rows: 2, maxLength: 600, placeholder: "optional: how she says what she wears (You wear …). Left empty, it is made from the outfit.", ariaLabel: "What she says she wears" });
    const count = el("select", { id: "studio-count", ariaLabel: "How many first pictures to draw" }, ...[4, 3, 2, 1].map((n) => el("option", { value: String(n), textContent: n === 4 ? "4 (you pick the best)" : String(n) })));
    const makerSelect = el("select", { id: "studio-maker", ariaLabel: "Which image maker draws it" });
    makerSelect.onchange = () => io.send({ type: "studio-backend", value: makerSelect.value });
    const models = el("ul", { className: "studio-models", ariaLabel: "Image makers and what each needs" });
    const start = el("button", { type: "button", textContent: "Draw outfits" });
    const stop = el("button", { type: "button", className: "ghost", textContent: "Stop", hidden: true });
    const closeButton = el("button", { type: "button", className: "ghost", textContent: "Close" });
    const frameSource = el("select", { id: "studio-frame-source", ariaLabel: "Draw one picture again from this pack" });
    const frameName = el("select", { id: "studio-frame-name", ariaLabel: "Which picture of it" });
    const framePrompt = el("textarea", { id: "studio-frame-prompt", rows: 2, maxLength: 400, placeholder: "what to change in that picture, in your own words (a red scarf around her neck)", ariaLabel: "What to change in the picture" });
    const framePack = el("input", { type: "text", id: "studio-frame-pack", maxLength: 40, placeholder: "name of the new pack (empty: the source pack's name with -edit)", ariaLabel: "Name of the new pack for the picture" });
    const frameStart = el("button", { type: "button", className: "ghost", textContent: "Draw this picture again" });
    frameStart.onclick = () => {
      q(".studio-frame")?.replaceChildren();
      io.send({ type: "studio-frame-edit", source: frameSource.value, frame: frameName.value, prompt: framePrompt.value, name: framePack.value });
    };
    frameSource.onchange = () => fillFrames();
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
    source.addEventListener("input", () => (sourceTouched = true)); // only the user's own choice counts (a script's change does not fire this)
    source.onchange = () => {
      if (!name.value || name.dataset.auto === "1") {
        name.value = `${source.value}-new`;
        name.dataset.auto = "1";
      }
    };
    name.oninput = () => delete name.dataset.auto;
    start.onclick = () => {
      q(".studio-confirm")?.replaceChildren();
      q(".studio-candidates")?.replaceChildren();
      io.send({ type: "studio-start", source: source.value, name: name.value, outfit: outfit.value, look: look.value, pictures: Number(count.value) });
      status("Checking…");
    };
    panel = el(
      "div",
      { className: "studio", role: "dialog", ariaLabel: "Pack studio" },
      el("div", { className: "gallery-title", textContent: "Pack studio: a draft of her in a new outfit, drawn on this computer" }),
      el("label", { textContent: "Image maker (web services cost money or allowance; the next question says what)", htmlFor: "studio-maker" }),
      makerSelect,
      models,
      el("label", { textContent: "Draw from", htmlFor: "studio-source" }),
      source,
      el("label", { textContent: "New pack", htmlFor: "studio-name" }),
      name,
      el("label", { textContent: "Outfit", htmlFor: "studio-outfit" }),
      outfit,
      el("label", { textContent: "Her words for it", htmlFor: "studio-look" }),
      look,
      el("label", { textContent: "First pictures (a paid service charges for each)", htmlFor: "studio-count" }),
      count,
      el("div", { className: "studio-proposal" }),
      el("p", { className: "studio-contents", textContent: `A full pack is ${packSize || "39"} pictures: the neutral picture, six expressions, thinking, four poses, and for each expression a blink and three mouth shapes. Each picture is checked and drawn again when a check fails (up to three tries).` }),
      el("div", { className: "pack-confirm-buttons" }, start, stop, closeButton, full, handover),
      el("label", { textContent: "Draw one picture of a pack again (needs a model on this computer; the new pack is a copy, the source is not changed)" }),
      frameSource,
      frameName,
      framePrompt,
      framePack,
      el("div", { className: "pack-confirm-buttons" }, frameStart),
      el("div", { className: "studio-frame" }),
      el("div", { className: "studio-handover" }),
      el("p", { className: "studio-status", role: "status" }),
      el("p", { className: "studio-spend", role: "status" }),
      el("div", { className: "studio-confirm" }),
      el("div", { className: "studio-candidates" }),
    );
    io.host()?.append(panel);
    zoom = el("div", { className: "studio-zoom", hidden: true }, el("img", { alt: "" }));
    io.host()?.append(zoom);
    fillSources();
    fillMakers();
    source.onchange?.(new Event("change"));
    outfit.focus();
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
    const use = el("button", { type: "button", className: "studio-action", textContent: "Use this pack" });
    for (const tile of review.tiles ?? []) setTile(id, tile, selected, () => (again.disabled = selected.size === 0));
    const notes = el("ul", { className: "studio-flags" });
    /** Drawing again: the tiles stay (the ones that are made again are replaced as they are drawn), the buttons wait. */
    const redraw = (/** @type {string[]} */ names, /** @type {string} */ text) => {
      io.send({ type: "studio-regen", id, names });
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
    parts.extra.replaceChildren(notes, el("div", { className: "pack-confirm-buttons" }, use, again));
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
    const box = q(".studio-confirm");
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
      box.append(el("p", { textContent: "She suggested these words. Change anything, then press Draw outfits." }));
    }
  }

  function fillMakers() {
    const list = q(".studio-models");
    if (list) {
      // Every maker with what it costs and whether it is ready now: the choice itself is the list above.
      list.replaceChildren(...makers.map((m) => el("li", { className: m.available === false ? "studio-not-ready" : "studio-ready" },
        el("span", { textContent: m.available === false ? "not ready" : "ready" }), " · ",
        el("span", { textContent: m.label }),
        m.available === false && m.reason ? el("span", { className: "studio-why", textContent: ` (${m.reason})` }) : "",
      )));
    }
    const select = /** @type {HTMLSelectElement | null} */ (q("#studio-maker"));
    if (!select) return;
    // A maker that cannot be used now is listed with why, and cannot be picked (the server says the same when asked to draw).
    select.replaceChildren(...makers.map((m) => new Option(m.available === false && m.reason ? `${m.label} (${m.reason})` : m.label, m.value)));
    for (const option of select.options) option.disabled = makers.some((m) => m.value === option.value && m.available === false);
    if (makers.some((m) => m.value === maker)) select.value = maker;
    else select.prepend(new Option("Choose an image maker…", "", true, true)); // nothing chosen yet: say so, rather than an empty box
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
  }

  /** The drawn picture beside the one it replaces: keep it (a new pack is made) or drop it (nothing is written). */
  function showFrameReview(/** @type {Record<string, any>} */ r) {
    const box = q(".studio-frame");
    if (!box) return;
    const keep = el("button", { type: "button", textContent: "Keep as a new pack" });
    const drop = el("button", { type: "button", className: "ghost", textContent: "Drop it" });
    keep.onclick = () => io.send({ type: "studio-frame-accept", id: r.id });
    drop.onclick = () => io.send({ type: "studio-frame-reject", id: r.id });
    const flags = Array.isArray(r.flags) ? r.flags.map((/** @type {string} */ f) => el("li", { textContent: f })) : [];
    box.replaceChildren(
      el("p", { textContent: `${r.frame} from ${r.source}, drawn with ${r.model} (new pack: ${r.name}).` }),
      el("div", { className: "studio-frame-pair" },
        el("figure", {}, el("img", { src: String(r.old), alt: "before" }), el("figcaption", { textContent: "before" })),
        el("figure", {}, el("img", { src: String(r.new), alt: "after" }), el("figcaption", { textContent: "after" })),
      ),
      flags.length ? el("ul", { className: "studio-flags" }, ...flags) : el("p", { textContent: "The checks passed. Look at it by eye." }),
      el("div", { className: "pack-confirm-buttons" }, keep, drop),
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
  }

  function running(/** @type {boolean} */ busy) {
    const picker = /** @type {HTMLSelectElement | null} */ (q("#studio-maker"));
    if (picker) picker.disabled = busy;
    const start = /** @type {HTMLButtonElement | null} */ (panel?.querySelector(".pack-confirm-buttons button"));
    if (start) start.disabled = busy;
    const stop = q(".pack-confirm-buttons button:nth-child(2)");
    if (stop) stop.hidden = !busy;
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
          makers = Array.isArray(msg.backends) ? msg.backends.filter((/** @type {any} */ b) => b && typeof b.value === "string" && typeof b.label === "string") : [];
          packSize = Number(msg.packSize) || 0;
          maker = typeof msg.backend === "string" ? msg.backend : "";
          fillMakers();
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
            else q(".studio-frame")?.replaceChildren();
            if (!msg.job && panel && Array.isArray(msg.resumable) && msg.resumable.length && !q(".studio-confirm")?.childElementCount) showResumable(msg.resumable);
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
          document.dispatchEvent(new CustomEvent("studio-state", { detail: { on } }));
          return true;
        case "studio-spend":
          spendLine(Number(msg.usd), Number(msg.limit));
          return true;
        case "studio-frame-progress":
          status(String(msg.text));
          return true;
        case "studio-frame-review":
          showFrameReview(msg);
          status("Look at the picture drawn: keep it as a new pack, or drop it.");
          return true;
        case "studio-frame-installed":
          q(".studio-frame")?.replaceChildren();
          status(`Made ${msg.name}: the same pack with that picture drawn again.`);
          return true;
        case "studio-frame-cancelled":
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
          const yes = el("button", { type: "button", textContent: paid ? `Draw ${msg.pictures} pictures (paid)` : browser ? `Draw ${msg.pictures} pictures (drives your Chrome)` : `Draw ${msg.pictures} pictures` });
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
          showReview(String(msg.id), msg);
          io.attention?.(msg.flagged?.length ? "Pack ready: look at the flagged pictures" : "Pack ready to review");
          status(msg.flagged?.length ? `Done. ${msg.flagged.length} picture(s) did not pass every check: look at them.` : "Done. Look at the pack, then use it.");
          return true;
        case "studio-candidates-done":
          running(false);
          io.attention?.("Pick a picture");
          status(typeof msg.text === "string" && msg.text ? msg.text : "Pick the one you like. Nothing is saved until you do.");
          return true;
        case "studio-installed": {
          running(false);
          const name = String(msg.name);
          status(`Made ${name}: a draft pack, written to your pictures. Look it over in a chat before you rely on it.`);
          const show = el("button", { type: "button", textContent: `Show her as ${name}` });
          show.onclick = () => io.send({ type: "pack-select", name });
          q(".studio-candidates")?.replaceChildren(show);
          return true;
        }
        case "studio-error": {
          running(false);
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
          running(false);
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
