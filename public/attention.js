/**
 * Tells the user something finished while this tab was in the background, the only way a page can without asking for anything: the tab's title gets a mark and the words
 * ("● Pack ready · Risa") until the tab is looked at again. Nothing is played and no permission is asked.
 */
export function createAttention(doc) {
  let name = doc.title;
  let note = "";
  const show = () => {
    doc.title = note ? `● ${note} · ${name}` : name;
  };
  return {
    /** The page's own title (her name): the mark, if there is one, stays in front of it. */
    setName(next) {
      name = next;
      show();
    },
    /** Marks the title when the tab is hidden. Returns whether it did (a tab being looked at needs no mark). */
    notify(text) {
      if (!doc.hidden) return false;
      note = String(text).slice(0, 60);
      show();
      return true;
    },
    clear() {
      if (!note) return;
      note = "";
      show();
    },
  };
}
