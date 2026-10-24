/**
 * The pack studio's panel (docs/pack-studio.md): a form, the question before anything is drawn, the pictures to pick from, and the result.
 * It only sends and shows; every rule (off at every start, nothing from a phone, one job at a time) is the server's.
 *
 * @param {{ send: (msg: object) => void, host: () => Element | null, say: (text: string) => void }} io
 */
export function createStudio(io) {
  let on = false;
  /** @type {string[]} */
  let sources = [];
  /** @type {HTMLElement | null} */
  let panel = null;
  let jobId = "";

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

  function close() {
    panel?.remove();
    panel = null;
  }

  function open() {
    if (!on) return io.say("The pack studio is off. Type /studio on.");
    if (panel) return close(); // the same menu entry again closes it
    const source = el("select", { id: "studio-source", ariaLabel: "Draw from this pack" });
    const name = el("input", { type: "text", id: "studio-name", maxLength: 40, placeholder: "name of the new pack", ariaLabel: "Name of the new pack" });
    const outfit = el("textarea", { id: "studio-outfit", rows: 3, maxLength: 400, placeholder: "her new outfit, in your own words (a dark green winter coat over a white sweater)", ariaLabel: "The new outfit" });
    const look = el("textarea", { id: "studio-look", rows: 2, maxLength: 600, placeholder: "optional: how she says what she wears (You wear …). Left empty, it is made from the outfit.", ariaLabel: "What she says she wears" });
    const start = el("button", { type: "button", textContent: "Draw outfits" });
    const stop = el("button", { type: "button", className: "ghost", textContent: "Stop", hidden: true });
    const closeButton = el("button", { type: "button", className: "ghost", textContent: "Close" });
    closeButton.onclick = close;
    stop.onclick = () => io.send({ type: "studio-cancel" });
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
      io.send({ type: "studio-start", source: source.value, name: name.value, outfit: outfit.value, look: look.value });
      status("Checking…");
    };
    panel = el(
      "div",
      { className: "studio", role: "dialog", ariaLabel: "Pack studio" },
      el("div", { className: "gallery-title", textContent: "Pack studio: a draft of her in a new outfit, drawn on this computer" }),
      el("label", { textContent: "Draw from", htmlFor: "studio-source" }),
      source,
      el("label", { textContent: "New pack", htmlFor: "studio-name" }),
      name,
      el("label", { textContent: "Outfit", htmlFor: "studio-outfit" }),
      outfit,
      el("label", { textContent: "Her words for it", htmlFor: "studio-look" }),
      look,
      el("div", { className: "studio-proposal" }),
      el("div", { className: "pack-confirm-buttons" }, start, stop, closeButton),
      el("p", { className: "studio-status", role: "status" }),
      el("div", { className: "studio-confirm" }),
      el("div", { className: "studio-candidates" }),
    );
    io.host()?.append(panel);
    fillSources();
    source.onchange?.(new Event("change"));
    outfit.focus();
    io.send({ type: "studio-state" }); // a job that is already going (or waiting for the pick) is shown again
  }

  function addCandidate(/** @type {string} */ id, /** @type {number} */ seed, /** @type {unknown} */ thumb, /** @type {number} */ number) {
    const grid = q(".studio-candidates");
    grid?.classList.remove("studio-review");
    if (!grid || typeof thumb !== "string" || !thumb.startsWith("data:image/webp;base64,")) return;
    const pick = el("button", { type: "button", className: "preset", title: "Use this one", ariaLabel: `Use picture ${number}` });
    pick.append(el("img", { src: thumb, alt: `Candidate ${number}` }));
    pick.onclick = () => {
      io.send({ type: "studio-pick", id, seed });
      grid.replaceChildren();
      status("Cutting her out…");
      running(true);
    };
    grid.append(pick);
  }

  /** The finished pack: a tile for each emotion and pose, what the checks found, and the choice to draw some again or use it. */
  function showReview(/** @type {string} */ id, /** @type {{ tiles?: any[], flagged?: any[] }} */ review) {
    const box = q(".studio-candidates");
    if (!box) return;
    /** @type {Set<string>} */
    const selected = new Set();
    const grid = el("div", { className: "studio-tiles" });
    const again = el("button", { type: "button", className: "ghost", textContent: "Draw the selected again", disabled: true });
    const use = el("button", { type: "button", textContent: "Use this pack" });
    for (const tile of review.tiles ?? []) {
      if (typeof tile.thumb !== "string" || !tile.thumb.startsWith("data:image/webp;base64,")) continue;
      const t = el("button", { type: "button", className: "preset", title: `${tile.name}${tile.flagged ? " (a check failed)" : ""}`, ariaLabel: `${tile.name}`, ariaPressed: "false" });
      t.append(el("img", { src: tile.thumb, alt: tile.name }), el("span", { className: "preset-name", textContent: `${tile.flagged ? "⚠ " : ""}${tile.name}` }));
      t.onclick = () => {
        const on = !selected.has(tile.name);
        if (on) selected.add(tile.name);
        else selected.delete(tile.name);
        t.setAttribute("aria-pressed", String(on));
        t.classList.toggle("studio-selected", on);
        again.disabled = selected.size === 0;
      };
      grid.append(t);
    }
    const notes = el("ul", { className: "studio-flags" });
    for (const f of review.flagged ?? []) {
      const redo = el("button", { type: "button", className: "ghost", textContent: "Draw again" });
      redo.onclick = () => {
        io.send({ type: "studio-regen", id, names: [f.name] });
        box.replaceChildren();
        status("Drawing it again…");
        running(true);
      };
      notes.append(el("li", {}, el("strong", { textContent: `${f.name}: ` }), String((f.flags ?? []).join("; ")), " ", redo));
    }
    again.onclick = () => {
      io.send({ type: "studio-regen", id, names: [...selected] });
      box.replaceChildren();
      status("Drawing them again…");
      running(true);
    };
    use.onclick = () => {
      io.send({ type: "studio-accept", id });
      use.disabled = true;
      status("Writing the pack…");
    };
    box.classList.add("studio-review");
    box.replaceChildren(grid, notes, el("div", { className: "pack-confirm-buttons" }, use, again));
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
        return button;
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

  function fillSources() {
    const select = /** @type {HTMLSelectElement | null} */ (q("#studio-source"));
    if (!select) return;
    const keep = select.value;
    select.replaceChildren(...sources.map((s) => new Option(s, s)));
    if (sources.includes(keep)) select.value = keep;
  }

  function running(/** @type {boolean} */ busy) {
    const start = /** @type {HTMLButtonElement | null} */ (panel?.querySelector(".pack-confirm-buttons button"));
    if (start) start.disabled = busy;
    const stop = q(".pack-confirm-buttons button:nth-child(2)");
    if (stop) stop.hidden = !busy;
  }

  return {
    open,
    /** Handles the studio messages; false for anything else. */
    handle(/** @type {Record<string, any>} */ msg) {
      switch (msg.type) {
        case "studio-state":
          on = msg.on === true;
          sources = Array.isArray(msg.sources) ? msg.sources.filter((/** @type {unknown} */ s) => typeof s === "string") : [];
          if (!on) close();
          else {
            // A job is running or waits for the pick (this page was reloaded, or the panel was closed): show where it is.
            if (msg.job && !panel) open();
            fillSources();
            if (!msg.job && panel && Array.isArray(msg.resumable) && msg.resumable.length && !q(".studio-confirm")?.childElementCount) showResumable(msg.resumable);
            if (msg.job && panel) {
              const grid = q(".studio-candidates");
              if (grid && grid.childElementCount === 0) {
                if (msg.review) showReview(String(msg.job.id), msg.review);
                else for (const c of Array.isArray(msg.candidates) ? msg.candidates : []) addCandidate(String(msg.job.id), c.seed, c.thumb, grid.childElementCount + 1);
              }
              status(String(msg.job.text || "Working…"));
            }
          }
          if (msg.proposal && panel && !q(".studio-proposal")?.childElementCount) applyProposal({ ...msg.proposal, job: msg.job?.reviewing ? msg.job.id : null });
          running(Boolean(msg.running));
          document.dispatchEvent(new CustomEvent("studio-state", { detail: { on } }));
          return true;
        case "studio-proposal":
          applyProposal(msg);
          return true;
        case "studio-open":
          if (!panel) open();
          return true;
        case "studio-confirm": {
          jobId = String(msg.id);
          const box = q(".studio-confirm");
          if (!box) return true;
          const yes = el("button", { type: "button", textContent: `Draw ${msg.pictures} pictures` });
          const no = el("button", { type: "button", className: "ghost", textContent: "Not now" });
          no.onclick = () => {
            box.replaceChildren();
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
            el("div", { className: "pack-confirm", role: "alertdialog" }, el("p", { textContent: String(msg.note) }), el("div", { className: "pack-confirm-buttons" }, yes, no)),
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
          status(msg.flagged?.length ? `Done. ${msg.flagged.length} picture(s) did not pass every check: look at them.` : "Done. Look at the pack, then use it.");
          return true;
        case "studio-candidates-done":
          running(false);
          status("Pick the one you like. Nothing is saved until you do.");
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
        case "studio-error":
          running(false);
          status(String(msg.message), true);
          return true;
        case "studio-cancelled":
          running(false);
          q(".studio-confirm")?.replaceChildren();
          q(".studio-candidates")?.replaceChildren();
          status("Stopped.");
          return true;
        default:
          return false;
      }
    },
    enabled: () => on,
  };
}
