import assert from "node:assert/strict";
import { test } from "node:test";
import { createAttention } from "../public/attention.js";

test("a hidden tab gets a mark and the words in its title, a visible one does not, and looking again takes it off", () => {
  const doc = { title: "Risa", hidden: false };
  const a = createAttention(doc);
  assert.equal(a.notify("Pack ready"), false, "a tab being looked at needs no mark");
  assert.equal(doc.title, "Risa");
  doc.hidden = true;
  assert.equal(a.notify("Pack ready to review"), true);
  assert.equal(doc.title, "● Pack ready to review · Risa");
  a.setName("Hana");
  assert.equal(doc.title, "● Pack ready to review · Hana", "a rename keeps the mark");
  a.clear();
  assert.equal(doc.title, "Hana");
  a.clear();
  assert.equal(doc.title, "Hana", "clearing twice changes nothing");
});

test("the words in the title are cut to a sensible length", () => {
  const doc = { title: "Risa", hidden: true };
  createAttention(doc).notify("x".repeat(200));
  assert.ok(doc.title.length <= 2 + 60 + 3 + 4 + 1, doc.title);
});
