// Builds the documentation site: markdown pages (site/pages, plus docs/frame-packs.md) into plain static HTML in
// site/dist, ready for GitHub Pages. No framework: a sidebar, previous/next links, anchored headings, copy buttons.
// Usage: node site/build.mjs        (npm run site)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { Marked } from "marked";

const here = import.meta.dirname;
const root = join(here, "..");
const dist = join(here, "dist");
const REPO = "https://github.com/rhedak/anime_ai_companion";

/** The pages, in order. `file` is relative to the repository root. */
const pages = [
  { slug: "index", title: "Home", file: "site/pages/index.md" },
  { slug: "download", title: "Download", file: "site/pages/download.md" },
  { slug: "getting-started", title: "Getting started", file: "site/pages/getting-started.md" },
  { slug: "chatting", title: "Chatting with her", file: "site/pages/chatting.md" },
  { slug: "brains", title: "Brains", file: "site/pages/brains.md" },
  { slug: "work-mode", title: "Work mode", file: "site/pages/work-mode.md" },
  { slug: "phone", title: "From your phone", file: "site/pages/phone.md" },
  { slug: "looks", title: "Her looks", file: "site/pages/looks.md" },
  { slug: "picture-packs", title: "Picture packs", file: "docs/frame-packs.md" },
  { slug: "pack-studio", title: "Make her an outfit", file: "site/pages/pack-studio.md" },
  { slug: "local-model", title: "A model on your computer", file: "site/pages/local-model.md" },
  { slug: "agent-guide", title: "Guide for AI agents", file: "site/pages/agent-guide.md" },
  { slug: "customising", title: "Customising", file: "site/pages/customising.md" },
  { slug: "commands", title: "Slash commands", file: "site/pages/commands.md" },
  { slug: "how-it-works", title: "How it works", file: "site/pages/how-it-works.md" },
  { slug: "safety", title: "Safety and privacy", file: "site/pages/safety.md" },
  { slug: "about", title: "About, credits, licence", file: "site/pages/about.md" },
];
const bySource = new Map(pages.map((p) => [p.file, p]));

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Where a link written in `source` (a repo-relative path) points on the site: another page, or the file on GitHub. */
function resolveLink(href, source) {
  if (/^([a-z]+:|#|mailto:)/i.test(href)) return href;
  const [path, hash] = href.split("#");
  // the browser demo, which is put into the site at demo/ after the build (the pages workflow, npm run site:preview)
  if (path === "demo/") return "demo/";
  // a link to another page of the site, written as page.html
  const named = pages.find((p) => p.slug + ".html" === path);
  if (named) return `${named.slug}.html${hash ? "#" + hash : ""}`;
  const target = posix.normalize(posix.join(posix.dirname(source), path));
  const page = bySource.get(target);
  if (page) return `${page.slug}.html${hash ? "#" + hash : ""}`;
  const isDir = !/\.[a-z0-9]+$/i.test(target);
  return `${REPO}/${isDir ? "tree" : "blob"}/main/${target}${hash ? "#" + hash : ""}`;
}

function render(markdown, source) {
  const headings = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const id = slugify(html) || `section-${headings.length}`;
        if (depth >= 2 && depth <= 3) headings.push({ depth, id, html });
        return `<h${depth} id="${id}">${html}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const to = resolveLink(href, source);
        const external = /^https?:/i.test(to);
        return `<a href="${escape(to)}"${title ? ` title="${escape(title)}"` : ""}${external ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`;
      },
      code({ text, lang }) {
        return `<div class="code"><button class="copy" type="button" aria-label="Copy this code">Copy</button><pre><code${lang ? ` class="language-${escape(lang)}"` : ""}>${escape(text)}</code></pre></div>\n`;
      },
      table(token) {
        const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
        const body = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("");
        return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
      },
      image({ href, title, text }) {
        return `<img src="${escape(href)}" alt="${escape(text)}"${title ? ` title="${escape(title)}"` : ""} loading="lazy">`;
      },
    },
  });
  return { html: marked.parse(markdown), headings };
}

/** Front matter: a few `key: value` lines between `---` lines at the top. */
function split(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = Object.fromEntries(m[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
  return { meta, body: text.slice(m[0].length) };
}

// The version of the installers, written into the Download page where it says <version>, so the file names and links are the real ones.
// A docs-only release (tag message "[docs-only]") builds none, so it names the last version that did (`installerVersion`).
const rootPackage = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
const version = rootPackage.installerVersion ?? rootPackage.version;
const css = readFileSync(join(here, "template", "site.css"), "utf8");
const js = readFileSync(join(here, "template", "site.js"), "utf8");

function layout({ page, index, html, headings, description, wide }) {
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const nav = pages
    .map((p) => `<li><a href="${p.slug}.html"${p.slug === page.slug ? ' aria-current="page"' : ""}>${escape(p.title)}</a></li>`)
    .join("");
  const toc = !wide && headings.length > 2
    ? `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ul>${headings.map((h) => `<li class="d${h.depth}"><a href="#${h.id}">${h.html}</a></li>`).join("")}</ul></nav>`
    : "";
  const title = page.slug === "index" ? "Anime AI Companion" : `${page.title} · Anime AI Companion`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta name="theme-color" content="#1b1535">
<link rel="icon" type="image/png" href="assets/favicon.png">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<style>${css}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the page</a>
<header class="top">
  <button class="menu" type="button" aria-label="Menu" aria-expanded="false" aria-controls="side"><span></span></button>
  <a class="brand" href="index.html">Anime AI Companion</a>
  <a class="gh cta" href="download.html">Download</a>
  <a class="gh demo" href="demo/">Try the demo</a>
  <a class="gh" href="${REPO}">GitHub</a>
</header>
<div class="shell">
  <nav id="side" class="side" aria-label="Documentation"><ul>${nav}</ul></nav>
  <main id="main">
    <article class="doc${wide ? " wide" : ""}">
${html}
      <footer class="pager">
        ${prev ? `<a class="prev" href="${prev.slug}.html"><small>Previous</small>${escape(prev.title)}</a>` : "<span></span>"}
        ${next ? `<a class="next" href="${next.slug}.html"><small>Next</small>${escape(next.title)}</a>` : "<span></span>"}
      </footer>
      <p class="edit"><a href="${REPO}/edit/main/${page.file}">Improve this page on GitHub</a></p>
      <p class="ai-note">Made with AI coding agents, mostly Claude Code. This documentation was written by Claude Code. <a href="about.html#how-this-was-made">Details</a></p>
    </article>
    ${toc}
  </main>
</div>
<script>${js}</script>
</body>
</html>
`;
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
let problems = 0;
pages.forEach((page, index) => {
  const path = join(root, page.file);
  if (!existsSync(path)) {
    console.error(`missing source: ${page.file}`);
    problems++;
    return;
  }
  const { meta, body } = split(readFileSync(path, "utf8").replaceAll("<version>", version));
  const { html, headings } = render(body, page.file);
  const description = meta.description ?? (/<p>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, "").slice(0, 200);
  writeFileSync(join(dist, `${page.slug}.html`), layout({ page, index, html, headings, description, wide: meta.wide === "true" }));
});
if (existsSync(join(here, "assets"))) cpSync(join(here, "assets"), join(dist, "assets"), { recursive: true });
if (existsSync(join(here, "assets", "favicon.png"))) cpSync(join(here, "assets", "favicon.png"), join(dist, "favicon.ico")); // asked for at the root whatever the page says
writeFileSync(join(dist, ".nojekyll"), "");
writeFileSync(join(dist, "404.html"), readFileSync(join(dist, "index.html"), "utf8").replace(/<title>[^<]*<\/title>/, "<title>Page not found · Anime AI Companion</title>").replace(/<article class="doc">[\s\S]*<\/article>/, '<article class="doc"><h1>Page not found</h1><p>That page does not exist. <a href="index.html">Back to the start</a>.</p></article>'));
console.log(`built ${pages.length} pages into ${relative(root, dist)}`);
if (problems) process.exit(1);
