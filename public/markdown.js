// A small, safe Markdown subset for her replies: paragraphs, headings, bold, italic, `code`,
// fenced code, bullet and numbered lists, quotes and http(s)/mailto links. Everything is built
// with createElement/textContent, never innerHTML, so nothing she writes can inject markup.
// parseMarkdown is pure (tested in node); renderMarkdown turns its result into DOM.

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/** Inline spans of one line of text. */
export function parseInline(text) {
  const out = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ type: "text", text: plain });
    plain = "";
  };
  for (let i = 0; i < text.length; ) {
    const rest = text.slice(i);
    let m;
    if ((m = /^`([^`\n]+)`/.exec(rest))) {
      flush();
      out.push({ type: "code", text: m[1] });
    } else if ((m = /^\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/.exec(rest))) {
      flush();
      out.push({ type: "bold", children: parseInline(m[1]) });
    } else if ((m = /^\*(?=[^\s*])([^\n*]+?)(?<=[^\s*])\*/.exec(rest)) || (m = /^\b_(?=\S)([^\n_]+?)(?<=\S)_\b/.exec(rest))) {
      flush();
      out.push({ type: "italic", children: parseInline(m[1]) });
    } else if ((m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest)) && SAFE_LINK.test(m[2])) {
      flush();
      out.push({ type: "link", href: m[2], children: parseInline(m[1]) });
    } else {
      plain += text[i];
      i += 1;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

/** Block structure of a reply. An unclosed code fence (the reply is still streaming) counts as code. */
export function parseMarkdown(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", lines: paragraph.map(parseInline) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = /^\s*```\s*([\w+-]*)\s*$/.exec(line))) {
      endParagraph();
      const code = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ type: "code", lang: m[1], text: code.join("\n") });
    } else if (!line.trim()) {
      endParagraph();
    } else if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      endParagraph();
      blocks.push({ type: "heading", level: m[1].length, children: parseInline(m[2]) });
    } else if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      endParagraph();
      const ordered = /\d/.test(m[1]);
      const last = blocks[blocks.length - 1];
      const item = parseInline(m[2]);
      if (last?.type === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ type: "list", ordered, items: [item] });
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      endParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.type === "quote") last.lines.push(parseInline(m[1]));
      else blocks.push({ type: "quote", lines: [parseInline(m[1])] });
    } else {
      paragraph.push(line);
    }
  }
  endParagraph();
  return blocks;
}

function inlineNodes(spans, doc) {
  return spans.map((s) => {
    if (s.type === "text") return doc.createTextNode(s.text);
    const el = doc.createElement({ code: "code", bold: "strong", italic: "em", link: "a" }[s.type]);
    if (s.type === "code") el.textContent = s.text;
    else el.append(...inlineNodes(s.children, doc));
    if (s.type === "link") {
      el.href = s.href;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
    }
    return el;
  });
}

function lineNodes(lines, doc) {
  return lines.flatMap((spans, i) => [...(i ? [doc.createElement("br")] : []), ...inlineNodes(spans, doc)]);
}

/** DOM for a reply; give it the container to fill. */
export function renderMarkdown(source, container, doc = document) {
  const nodes = parseMarkdown(source).map((b) => {
    let el;
    if (b.type === "paragraph") (el = doc.createElement("p")).append(...lineNodes(b.lines, doc));
    else if (b.type === "heading") (el = doc.createElement(`h${Math.min(6, b.level + 2)}`)).append(...inlineNodes(b.children, doc));
    else if (b.type === "quote") (el = doc.createElement("blockquote")).append(...lineNodes(b.lines, doc));
    else if (b.type === "code") {
      el = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = b.text;
      el.append(code);
    } else {
      el = doc.createElement(b.ordered ? "ol" : "ul");
      for (const item of b.items) {
        const li = doc.createElement("li");
        li.append(...inlineNodes(item, doc));
        el.append(li);
      }
    }
    return el;
  });
  container.replaceChildren(...nodes);
}
