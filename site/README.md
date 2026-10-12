# The documentation site

The pages in `pages/` (and `docs/frame-packs.md`) are built into plain static HTML by `build.mjs`, and published with
GitHub Pages by `.github/workflows/pages.yml` whenever `site/**` changes on `main`.

```bash
npm run site                  # builds into site/dist (git-ignored); open site/dist/index.html
node site/shots.mjs           # retakes the screenshots in site/assets from a throwaway copy of the app
npm test                      # test/docs.test.ts: every slash command is documented, every link and picture exists,
                              # and nothing personal is in the built pages
```

- A page is a markdown file with an optional `description:` line between `---` lines. To add one, put it in `pages/`
  and list it in `build.mjs` (the order there is the order in the menu).
- Links between pages are written as file links (`[Work mode](work-mode.md)` or `(work-mode.html)`); a link to any
  other file in the repository becomes a link to it on GitHub.
- The screenshots come from a scratch copy of the app with its own data and a demo project, never from your own data.
  They show the drawn characters only: no third-party character.
