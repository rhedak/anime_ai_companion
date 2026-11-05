/**
 * The pack studio's activity workspace (docs/pack-studio.md, "Making an activity"): a loop of pictures drawn one at a time, each from a picture the
 * user picks and a few words about what changes. The pictures wait on the server until the user saves the activity into the pack, so the work can be
 * stopped and carried on later. This file only shows and sends; every rule is the server's (src/studio-service.ts, src/studio/activity.ts).
 *
 * @param {{
 *   el: (tag: string, props?: Record<string, any>, ...kids: (Node | string)[]) => any,
 *   send: (msg: object) => void,
 *   pack: () => string,
 *   packFrames: () => string[],
 *   packThumb: (frame: string) => string,
 *   zoom: (node: HTMLElement, key: string, thumb: string, request: () => void) => void,
 *   zoomUrl: (node: HTMLElement, url: string, thumb: string) => void,
 *   hideZoom: () => void,
 *   status: (text: string, bad?: boolean) => void,
 *   busy: (on: boolean, text?: string) => void,
 *   continueDraft: (draft: { id: string, source: string }) => void,
 * }} ctx
 */
export function createActivityBox(ctx) {
  const { el } = ctx;
  /** @type {null | { id: string, source: string, name: string, taken: boolean, frames: { n: number, file: string, change: string, from: string, thumb: string, talk: string | null }[] }} */
  let draft = null;
  /** What the next picture is drawn from: `pack:<name>` or `draft:<file>`. */
  let drawFrom = "pack:neutral";
  let prompt = "";
  let newName = "";
  let renaming = false;
  let confirmSave = false;
  let talkText = "";
  let playing = false;
  let showTalk = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  /** @type {Record<string, any>[]} */
  let drafts = [];
  /** The pack the workspace was drawn for (so a repeated "show" does not redraw it under the user's typing). */
  let shownPack = "";
  let shownDrafts = "";

  const node = el("div", { className: "studio-activity", hidden: true });
  const list = el("div", { className: "studio-drafts" });

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  function sourceLabel() {
    if (drawFrom.startsWith("pack:")) return drawFrom.slice(5);
    const f = draft?.frames.find((x) => `draft:${x.file}` === drawFrom);
    return f ? `picture ${f.n} of the loop` : "";
  }
  function sourceThumb() {
    if (drawFrom.startsWith("pack:")) return ctx.packThumb(drawFrom.slice(5));
    return draft?.frames.find((x) => `draft:${x.file}` === drawFrom)?.thumb ?? "";
  }

  function render() {
    stopTimer();
    ctx.hideZoom();
    const pack = ctx.pack();
    node.hidden = false;
    if (!draft) {
      const mine = drafts.filter((a) => a.source === pack);
      const name = el("input", { type: "text", maxLength: 24, placeholder: "a word, e.g. cooking or tea_time", value: newName, ariaLabel: "Name of the activity", autocomplete: "off" });
      name.oninput = () => (newName = name.value);
      const go = el("button", { type: "button", textContent: "Start the activity" });
      go.onclick = () => ctx.send({ type: "studio-activity-new", source: pack, name: name.value });
      node.replaceChildren(
        el("p", { className: "studio-help", textContent: `A new activity for ${pack || "this pack"}. You draw a key picture from the neutral one, then add pictures one by one, each from any picture you pick. Nothing is written to the pack until you save it, and you can stop and carry on later.` }),
        el("label", { textContent: "Name of the activity" }),
        name,
        el("div", { className: "pack-confirm-buttons" }, go),
        ...(mine.length ? [el("p", { className: "studio-help", textContent: `Or carry on with one you began for ${pack}:` }), ...mine.map(draftRow)] : []),
      );
      return;
    }
    const d = draft;
    const frames = d.frames;
    // The name, with a rename at any time.
    const title = el("div", { className: "studio-activity-title" });
    if (renaming) {
      const name = el("input", { type: "text", maxLength: 24, value: d.name, ariaLabel: "New name of the activity", autocomplete: "off" });
      const ok = el("button", { type: "button", textContent: "Rename" });
      const no = el("button", { type: "button", className: "ghost", textContent: "Cancel" });
      ok.onclick = () => {
        renaming = false;
        ctx.send({ type: "studio-activity-rename", id: d.id, name: name.value });
      };
      no.onclick = () => {
        renaming = false;
        render();
      };
      title.append(name, ok, no);
    } else {
      const rename = el("button", { type: "button", className: "ghost", textContent: "Rename" });
      rename.onclick = () => {
        renaming = true;
        render();
      };
      const discard = el("button", { type: "button", className: "ghost", textContent: "Discard this activity" });
      discard.onclick = () => {
        if (window.confirm(`Throw away the unfinished activity ${d.name} and its ${frames.length} pictures?`)) ctx.send({ type: "studio-activity-delete", id: d.id });
      };
      title.append(el("strong", { textContent: `activity-${d.name}` }), el("span", { className: "studio-help", textContent: ` for ${d.source}` }), rename, discard);
    }

    // The loop so far: a tile for each picture (the one the next is drawn from is outlined).
    const strip = el("div", { className: "studio-thumbs studio-thumbs-small studio-loop" });
    for (const f of frames) {
      const tile = el("button", { type: "button", className: `preset${drawFrom === `draft:${f.file}` ? " studio-selected" : ""}`, title: `${f.n}: ${f.change}` });
      tile.append(el("img", { src: f.thumb, alt: "" }), el("span", { className: "preset-name", textContent: `${f.n}` }), el("span", { className: "studio-tile-sub", textContent: [f.from ? `from ${f.from}` : "", f.talk ? "talks" : ""].filter(Boolean).join(" · ") }));
      tile.onclick = () => {
        drawFrom = `draft:${f.file}`;
        render();
      };
      ctx.zoom(tile, `${d.id}/${f.file}`, f.thumb, () => ctx.send({ type: "studio-activity-full", id: d.id, file: f.file }));
      const remove = el("button", { type: "button", className: "ghost studio-tile-remove", textContent: "Remove", title: `Take picture ${f.n} out of the loop; the ones after it move up` });
      remove.onclick = () => {
        if (window.confirm(`Take picture ${f.n} out of the loop?`)) ctx.send({ type: "studio-activity-remove", id: d.id, file: f.file });
      };
      strip.append(el("div", { className: "studio-loop-item" }, tile, remove));
    }

    // A small player for the loop (and the talking versions when there are some).
    const player = el("div", { className: "studio-loop-player" });
    if (frames.length >= 2) {
      const img = el("img", { alt: "The loop", src: frames[0].thumb });
      const play = el("button", { type: "button", className: "ghost", textContent: playing ? "Pause" : "Play the loop" });
      let i = 0;
      const shown = () => frames.map((f) => (showTalk && f.talk ? f.talk : f.thumb));
      const tick = () => {
        i = (i + 1) % frames.length;
        /** @type {HTMLImageElement} */ (img).src = shown()[i];
      };
      if (playing) timer = setInterval(tick, 125);
      play.onclick = () => {
        playing = !playing;
        render();
      };
      player.append(img, play);
      if (frames.every((f) => f.talk)) {
        const talk = el("label", { className: "studio-inline" }, el("input", { type: "checkbox", checked: showTalk }), " with her mouth open");
        /** @type {HTMLInputElement} */ (talk.querySelector("input")).onchange = (e) => {
          showTalk = /** @type {HTMLInputElement} */ (e.target).checked;
          render();
        };
        player.append(talk);
      }
    }

    // The next picture.
    const hasFrames = frames.length > 0;
    const next = frames.length + 1;
    const packFrames = ctx.packFrames();
    const from = el("select", { ariaLabel: "Draw the next picture from" });
    for (const n of packFrames) from.append(new Option(`${n} (the pack's own)`, `pack:${n}`));
    if (drawFrom.startsWith("pack:") && !packFrames.includes(drawFrom.slice(5))) drawFrom = hasFrames ? `draft:${frames[frames.length - 1].file}` : "pack:neutral";
    for (const f of frames) from.append(new Option(`picture ${f.n} of the loop`, `draft:${f.file}`));
    from.value = drawFrom;
    from.onchange = () => {
      drawFrom = from.value;
      render();
    };
    const words = el("textarea", { rows: 2, maxLength: 400, value: prompt, ariaLabel: "What changes", placeholder: hasFrames ? "what changes from the picture it is drawn from (she lifts the cup a little higher)" : "the key picture: what is she doing? (holding a cup in both hands, steam rising)" });
    words.oninput = () => (prompt = words.value);
    const draw = el("button", { type: "button", textContent: hasFrames ? `Draw picture ${next}` : "Draw the key picture" });
    draw.onclick = () => {
      ctx.busy(true, `Drawing picture ${next}…`);
      ctx.send({ type: "studio-activity-draw", id: d.id, from: drawFrom, prompt: words.value });
    };
    const close = el("button", { type: "button", className: "ghost", textContent: "Close the loop", title: "Draw a picture from the last one that leads back to the first, so the loop has no jump", hidden: frames.length < 2 });
    close.onclick = () => {
      drawFrom = `draft:${frames[frames.length - 1].file}`;
      prompt = "move back towards how she looks in the first picture, so the loop can start over without a jump";
      render();
    };
    const thumb = sourceThumb();
    const preview = el("figure", { className: "studio-from" }, thumb ? el("img", { src: thumb, alt: "" }) : "", el("figcaption", { textContent: `drawn from: ${sourceLabel()}` }));
    if (drawFrom.startsWith("pack:") && thumb) ctx.zoomUrl(preview, `${thumb}/full`, thumb);

    // Talking versions.
    const talks = el("div", { className: "studio-talk" });
    if (hasFrames) {
      const have = frames.filter((f) => f.talk).length;
      const script = el("button", { type: "button", className: "ghost", textContent: have ? (have < frames.length ? "Finish them by script" : "Make them again by script") : "By script", title: "Copies her mouth from the pack's own talking pictures. Quick and free; right while her head stays about where it is in the pack's rest picture." });
      const model = el("button", { type: "button", className: "ghost", textContent: have ? (have < frames.length ? "Finish them with the image model" : "Make them again with the image model") : "With the image model", title: "The image model opens her mouth in each picture. With paste-back ticked only the mouth is kept; otherwise the whole picture the model drew. Needs an image model on this computer." });
      script.onclick = () => ctx.send({ type: "studio-activity-talk", id: d.id, how: "script", redo: have === frames.length });
      // Paste-back for the model's talking versions: off unless ticked (the whole picture the model drew is kept then).
      const paste = el("input", { type: "checkbox", id: "studio-activity-paste", checked: false });
      model.onclick = () => ctx.send({ type: "studio-activity-talk", id: d.id, how: "model", redo: have === frames.length, pasteBack: paste.checked });
      talks.append(el("label", { textContent: `Talking versions (${have} of ${frames.length})` }), el("p", { className: "studio-help", textContent: "The same pictures with her mouth open, for while she speaks." }), el("div", { className: "pack-confirm-buttons" }, script, model), el("label", { className: "studio-keep", htmlFor: "studio-activity-paste" }, paste, " Paste back into her face for the model's talking versions (off by default: the whole picture the model drew is kept)"), el("p", { className: "studio-help studio-talk-text", textContent: talkText }));
    }

    // The save.
    const save = el("div", { className: "studio-save" });
    if (frames.length >= 2) {
      const have = frames.filter((f) => f.talk).length;
      const mixed = have > 0 && have < frames.length;
      const go = el("button", { type: "button", textContent: confirmSave ? `Yes, save ${frames.length} pictures into ${d.source}` : `Save the activity into ${d.source}…`, disabled: mixed || d.taken });
      go.onclick = () => {
        if (!confirmSave) {
          confirmSave = true;
          return render();
        }
        confirmSave = false;
        ctx.send({ type: "studio-activity-save", id: d.id });
      };
      save.append(
        ...(confirmSave ? [el("p", { className: "studio-help", textContent: `This adds activity-${d.name}-1 to ${frames.length}${have ? " and the talking versions" : ""} to the ${d.source} pack. Nothing the pack has is replaced. If the pack comes with the app, your own copy of it is made and used instead.` })] : []),
        go,
        ...(mixed ? [el("p", { className: "studio-help", textContent: "Some pictures have a talking version and some do not: finish them above before saving." })] : []),
        ...(d.taken ? [el("p", { className: "studio-help", textContent: `The pack has an activity called ${d.name} now. Rename this one to save it.` })] : []),
      );
    } else save.append(el("p", { className: "studio-help", textContent: "A loop needs at least two pictures." }));

    node.replaceChildren(
      title,
      strip,
      player,
      el("div", { className: "studio-activity-next" },
        el("label", { textContent: hasFrames ? `Picture ${next}: draw it from` : "Key picture: draw it from" }),
        from,
        preview,
        el("label", { textContent: "What changes" }),
        words,
        el("p", { className: "studio-help", textContent: "Small steps keep her the same from picture to picture; a big change drifts, and how well that holds depends on the image maker." }),
        el("div", { className: "pack-confirm-buttons" }, draw, close)),
      talks,
      save,
    );
  }

  function draftRow(/** @type {Record<string, any>} */ a) {
    {
      const go = el("button", { type: "button", className: "ghost", textContent: "Carry on" });
      go.onclick = () => ctx.continueDraft({ id: String(a.id), source: String(a.source) });
      const del = el("button", { type: "button", className: "ghost", textContent: "Discard" });
      del.onclick = () => {
        if (window.confirm(`Throw away the unfinished activity ${a.name}?`)) ctx.send({ type: "studio-activity-delete", id: a.id });
      };
      return el("div", { className: "studio-draft" }, el("span", { textContent: `activity-${a.name} · ${a.source} · ${a.frames} picture${a.frames === 1 ? "" : "s"}` }), go, del);
    }
  }

  function renderDrafts() {
    const rows = drafts.map(draftRow);
    // The form lists the unfinished activities of its pack: draw it again only when that list changed (not under the user's typing).
    const sig = JSON.stringify(drafts.filter((d) => d.source === ctx.pack()).map((d) => [d.id, d.frames]));
    if (!draft && !node.hidden && sig !== shownDrafts) render();
    shownDrafts = sig;
    list.replaceChildren(...(rows.length ? [el("p", { className: "studio-help", textContent: "Activities you began and have not saved:" }), ...rows] : []));
  }

  return {
    node,
    list,
    /** Shows the workspace for the chosen pack (a new activity, or the one that is open). */
    show() {
      if (!node.hidden && shownPack === ctx.pack()) return;
      shownPack = ctx.pack();
      if (draft && draft.source !== shownPack) draft = null;
      render();
    },
    hide() {
      stopTimer();
      shownPack = "";
      node.hidden = true;
    },
    setDrafts(/** @type {any[]} */ next) {
      drafts = next;
      renderDrafts();
    },
    isOpen: () => Boolean(draft),
    /** @returns {boolean} */
    handle(/** @type {Record<string, any>} */ msg) {
      switch (msg.type) {
        case "studio-activity": {
          const fresh = !draft || draft.id !== msg.id;
          const was = draft?.frames.length ?? 0;
          draft = { id: String(msg.id), source: String(msg.source), name: String(msg.name), taken: msg.taken === true, frames: Array.isArray(msg.frames) ? msg.frames : [] };
          if (fresh) drawFrom = draft.frames.length ? `draft:${draft.frames[draft.frames.length - 1].file}` : "pack:neutral";
          else if (draft.frames.length > was) drawFrom = `draft:${draft.frames[draft.frames.length - 1].file}`;
          else if (drawFrom.startsWith("draft:") && !draft.frames.some((f) => `draft:${f.file}` === drawFrom)) drawFrom = draft.frames.length ? `draft:${draft.frames[draft.frames.length - 1].file}` : "pack:neutral";
          if (fresh) {
            prompt = "";
            confirmSave = false;
            playing = false;
            showTalk = false;
          }
          ctx.busy(false);
          render();
          return true;
        }
        case "studio-activity-added":
          prompt = "";
          confirmSave = false;
          ctx.status("Added to the loop. Draw the next picture, or save the activity when it is done.");
          return true;
        case "studio-activity-gone":
          if (draft?.id === msg.id) draft = null;
          drafts = drafts.filter((a) => a.id !== msg.id);
          renderDrafts();
          if (!node.hidden) render();
          return true;
        case "studio-activity-progress":
          talkText = String(msg.text || "");
          ctx.status(talkText || "Talking versions are made. Look at them in the player (with her mouth open), then save the activity.");
          const line = node.querySelector(".studio-talk-text");
          if (line) line.textContent = talkText;
          return true;
        case "studio-activity-saved":
          draft = null;
          newName = "";
          confirmSave = false;
          ctx.busy(false);
          ctx.status(`Saved ${msg.count} pictures as activity-${msg.name} in ${msg.source}${msg.talk ? ", with talking versions" : ""}. Use the pack from Looks → Packs, and she can start it with [activity ${msg.name}].`);
          render();
          return true;
        default:
          return false;
      }
    },
  };
}
