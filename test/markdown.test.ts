import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseMarkdown } from "../public/markdown.js";

const text = (spans: any[]): string => spans.map((s) => s.text ?? text(s.children ?? [])).join("");

test("inline: bold, italic, code and safe links", () => {
  const spans = parseInline("a **bold** and *it* and `x*y*` and [site](https://example.com) end");
  assert.deepEqual(spans.map((s: any) => s.type), ["text", "bold", "text", "italic", "text", "code", "text", "link", "text"]);
  assert.equal((spans[5] as any).text, "x*y*"); // nothing inside code is formatted
  assert.equal((spans[7] as any).href, "https://example.com");
});

test("inline: unsafe links, stray asterisks and snake_case stay plain text", () => {
  assert.deepEqual(parseInline("[x](javascript:alert(1))").map((s: any) => s.type), ["text"]);
  assert.equal(text(parseInline("[x](javascript:alert(1))")), "[x](javascript:alert(1))");
  assert.deepEqual(parseInline("2 * 3 * 4").map((s: any) => s.type), ["text"]);
  assert.deepEqual(parseInline("my_var_name").map((s: any) => s.type), ["text"]);
  assert.deepEqual(parseInline("<img src=x onerror=alert(1)>").map((s: any) => s.type), ["text"]);
});

test("blocks: paragraphs, headings, lists, quotes and code", () => {
  const blocks = parseMarkdown("# Title\nfirst line\nsecond line\n\n- one\n- two\n1. a\n2. b\n> quoted\n\n```js\nlet x = 1;\n\nlet y = 2;\n```\ndone");
  assert.deepEqual(blocks.map((b: any) => b.type), ["heading", "paragraph", "list", "list", "quote", "code", "paragraph"]);
  assert.equal((blocks[1] as any).lines.length, 2);
  assert.deepEqual([blocks[2], blocks[3]].map((b: any) => [b.ordered, b.items.length]), [[false, 2], [true, 2]]);
  assert.equal((blocks[5] as any).text, "let x = 1;\n\nlet y = 2;");
  assert.equal((blocks[5] as any).lang, "js");
});

test("an unclosed code fence, as in a half-streamed reply, is code", () => {
  const blocks = parseMarkdown("look:\n```\nnpm test");
  assert.deepEqual(blocks.map((b: any) => b.type), ["paragraph", "code"]);
  assert.equal((blocks[1] as any).text, "npm test");
});
