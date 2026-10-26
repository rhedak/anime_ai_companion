import assert from "node:assert/strict";
import { test } from "node:test";
import { bubbleText } from "../public/bubble.js";

test("the bubble shows the words, not the Markdown marks around them", () => {
  assert.equal(bubbleText("I **really** like `code` and *this*."), "I really like code and this.");
  assert.equal(bubbleText("## Heading\n> a quote\n- one\n- two"), "Heading\na quote\n• one\n• two");
  assert.equal(bubbleText("See [the docs](https://example.com/x) now"), "See the docs now");
  assert.equal(bubbleText("```js\nlet a = 1\n```\ndone"), "(a code block)\ndone");
});

test("plain text, snake_case words and a lone star are left alone", () => {
  assert.equal(bubbleText("my_variable_name is fine"), "my_variable_name is fine");
  assert.equal(bubbleText("2 * 3 = 6"), "2 * 3 = 6");
  assert.equal(bubbleText("Hello there!"), "Hello there!");
});
