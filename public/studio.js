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
      io.send({ type: "studio-start", source: source.value, name: name.value, outfit: outfit.value });
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
            if (msg.job && panel) {
              const grid = q(".studio-candidates");
              if (grid && grid.childElementCount === 0) for (const c of Array.isArray(msg.candidates) ? msg.candidates : []) addCandidate(String(msg.job.id), c.seed, c.thumb, grid.childElementCount + 1);
              status(String(msg.job.text || "Working…"));
            }
          }
          running(Boolean(msg.running));
          document.dispatchEvent(new CustomEvent("studio-state", { detail: { on } }));
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
        case "studio-candidates-done":
          running(false);
          status("Pick the one you like. Nothing is saved until you do.");
          return true;
        case "studio-installed": {
          running(false);
          const name = String(msg.name);
          status(`Made ${name}: a draft with her neutral picture.`);
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
