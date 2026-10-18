# Picture-pack archives

The app still shows a pack from a folder of pictures (`docs/frame-packs.md`). A pack that is already in
`data/frames/` or `packs/` is read exactly as before. A pack that is only in the index can be downloaded
into `data/frames/<id>/` the first time it is chosen (issue #8). The folders in `packs/` stay as plain frames.

## The index

`packs/index.json` is the list of packs that are hosted elsewhere. `parsePackIndex` (`src/pack-index.ts`) checks it.
`packs/index.schema.json` describes the same fields. One entry looks like this (the numbers here are an illustration
of the fields; the measured size of the pajamas pack is in the next section but one):

```json
{
  "format": 1,
  "packs": [
    {
      "id": "franzi-pajamas",
      "name": "Franzi (pajamas)",
      "version": "1",
      "description": "Franzi in a lavender pajama outfit. An original character; the pictures were made with AI.",
      "frameCount": 39,
      "sizes": {
        "width": 940,
        "height": 1070,
        "archiveBytes": 4400000,
        "framesBytes": 15142742
      },
      "hashes": {
        "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      },
      "url": "https://github.com/rhedak/anime_ai_companion/releases/download/pack-franzi-pajamas-1/franzi-pajamas-1.tar",
      "thumbnail": "thumbs/franzi-pajamas.webp",
      "credit": "Franzi (pajamas): an original character, pictures made with AI.",
      "aiMade": true
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `format` | `1`. A newer file is refused. |
| `id` | The folder name it installs as, under `data/frames/` and `packs/`. The same rules as a pack name. |
| `name` | The name shown in the gallery. |
| `version` | The pack's own version, `1` or `1.2.3`, not the app's. It changes when the archive bytes change. |
| `frameCount` | How many pictures the archive restores. |
| `sizes.width`, `sizes.height` | Every frame is this size, in pixels. |
| `sizes.archiveBytes` | The archive file, in bytes. |
| `sizes.framesBytes` | The plain WebP frames it was built from, in bytes. Text files are not counted. |
| `hashes.sha256` | SHA-256 of the archive file, 64 lowercase hex characters. |
| `url` | Where to download the archive. https, with no password in it. |
| `character` | Optional: `{ "id": "franzi", "name": "Franzi" }`, the character an outfit belongs to (the same id as the `character:` line of the pack's `look.txt`). The gallery puts a pack that is not downloaded yet into that character's row. |
| `description`, `thumbnail`, `credit`, `aiMade` | Optional. What a gallery can show before the pictures are on disk. `thumbnail` is `thumbs/<id>.webp` next to the index, or an https URL of that picture. |

A field the schema does not know is refused, so a typo does not pass.

The download URL is stored as itself. The address this project will publish is a GitHub Release asset:

`https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.tar`

GitHub Release assets are free to download, up to 2 GiB each, and need no login. If the files later move to a
separate packs repository, the same fields still work: only the URL changes.

## The archive

`node src/pack-archive-cli.ts build` reads a folder of lossless WebP frames and writes one uncompressed tar.
`restore` turns that tar back into a folder `readPack` already understands.

Stored whole, byte for byte:

- each emotion's rest frame (`neutral.webp`, `happy.webp`, and the rest of the keys in `emotions.json`)
- each pose (`wave-1.webp`, `wave-2.webp`, `cheer-1.webp`, `cheer-2.webp`)
- `credit.txt`, `NOTICE.md`, `PROCESS.md` and `look.txt` when the folder has them

`credit.txt` and `NOTICE.md` are required. The credit and the terms have to travel with the pictures.

Stored as a patch, over that emotion's rest frame:

- `<emotion>-blink.webp`
- `<emotion>-talk1.webp`, `-talk2`, `-talk3`

A patch is the smallest rectangle of pixels that differ from the rest frame, cut out of the variant. The rectangle
is the variant's own RGBA pixels (not a difference), encoded as a lossless WebP that keeps the colour of transparent
pixels, plus the rectangle's x and y. `manifest.json` inside the tar records the rectangle, which rest frame it
patches, and a sha256 of every stored blob. A blink that changes nothing stores an empty rectangle and no picture.

Restoring copies the whole files back unchanged, so those bytes match. For a patch it decodes the rest frame, paints
the rectangle on, and writes a new lossless WebP. The pixels match the original frame, including transparent pixels.
The bytes of that new WebP usually do not: lossless WebP does not turn one picture into only one byte string.

The tar is reproducible. Names are sorted and timestamps are zero, so the same folder builds the same archive and
the sha256 in the index stays put. A normal `tar -tf` can list it. Names that leave the archive (`..`, a link, an
absolute path) are refused, and so is a blob whose sha256 does not match the manifest.

A lossy WebP, a frame of a different size, a blink with no rest frame, and a file the pack format does not know are
refused at build time, so an archive is never a silent subset of the folder. Dotfiles are skipped, as they are when
a pack is shown.

The tool uses `sharp` to read and write the WebP. The installer uses the same codec when it restores a pack, so `sharp` is a dependency of the app.

```bash
node src/pack-archive-cli.ts build packs/franzi-pajamas -o franzi-pajamas.tar
node src/pack-archive-cli.ts report franzi-pajamas.tar
node src/pack-archive-cli.ts restore franzi-pajamas.tar -o /tmp/franzi-pajamas
node src/pack-archive-cli.ts index franzi-pajamas.tar \
  --name "Franzi (pajamas)" --version 1 --ai-made \
  --url https://github.com/rhedak/anime_ai_companion/releases/download/pack-franzi-pajamas-1/franzi-pajamas-1.tar
```

`npm run pack-archive -- build <folder> -o <archive.tar>` is the same command.

## Measured on franzi-pajamas

`packs/franzi-pajamas` is 39 lossless WebP frames at 940×1070 (7 emotions, each with a rest frame, a blink and three
mouth openings, plus wave and cheer). `test/pack-archive.test.ts` builds an archive from that folder and checks every
restored frame: the 11 rest and pose frames and the text files come back byte for byte, and each blink and talk frame
comes back with the same pixels. The sizes from that run:

| | Bytes |
| --- | --- |
| Plain WebP frames | 15,142,742 (15.1 MB) |
| Patch archive | 4,464,640 (4.5 MB, 3.4× smaller) |
| 11 rest and pose frames, stored whole | 4,320,020 |
| 28 blink and talk patches | 96,274 |
| `credit.txt`, `NOTICE.md`, `PROCESS.md` | 5,281 |

The text size is the LF copy git stores. A Windows checkout writes those files with CRLF (5,337 bytes). The archive keeps the bytes it was given. For these three files the extra CR bytes fit in the tar's padding, so the archive is still 4,464,640 bytes. The pictures are unchanged.

A blink's rectangle is about 145×60 pixels. Most of the archive is the frames that were stored whole.

## Thumbnails

Each pack has a preview, about 200 px wide, made from its neutral frame:

```bash
npm run pack-thumbs
# node src/pack-thumb-cli.ts packs -o packs/thumbs
```

The files are `packs/thumbs/<id>.webp`. They are previews (a small lossy WebP), not the frames the pack shows.
An index entry points at the same file with `"thumbnail": "thumbs/<id>.webp"`, which is resolved against the
index URL, so a list published at `https://example.github.io/anime_ai_companion-packs/index.json` loads
`https://example.github.io/anime_ai_companion-packs/thumbs/<id>.webp`. An https URL in `thumbnail` is also accepted.

`/pack-thumb/<id>` serves that preview. The gallery uses it even when the pack's frames are not on disk. A folder
that has no preview file still shows its neutral picture, as before. `packs/thumbs` is not itself a pack: it is
skipped unless it contains a `neutral` picture.

## Installing

`src/pack-install.ts` runs in the server. The browser never fetches the archive: a GitHub Release asset sends no
CORS header, and the page's images stay on this origin.

The index address is `COMPANION_PACK_INDEX`. When that variable is unset, the address is

`https://rhedak.github.io/anime_ai_companion-packs/index.json`

That is a **placeholder**. The sister repository's GitHub Pages site is not published yet, so the request fails and
the gallery only lists packs that are already on disk. Set the variable to another https URL to point somewhere
else, or to `off` to skip the request.

Choosing a pack that is not installed (Looks → Packs… shows its preview and **Download**, or `/frames <name>`) does this:

1. Fetch the index and find the entry. A network failure, a missing list, or a list that does not parse is reported
   and nothing is written. Packs already on disk keep working.
2. Download `url`. The size must be `sizes.archiveBytes` and the sha256 must be `hashes.sha256`. A mismatch is
   thrown away.
3. Restore into a temporary folder next to the destination. `credit.txt` and `NOTICE.md` have to be present and
   non-empty. Names that leave the folder are refused by the restore itself.
4. Rename that folder to `data/frames/<id>/`. A second install of the same sha256 does nothing. A folder that is
   already there and was not installed by this module (no `.pack-install.json`) is left as it is.

Progress is a `pack-progress` message (`index`, `download` with bytes, `verify`, `restore`, `done`). The archive is
not kept after the check.

## Still to publish

The format and the installer are in the app. Nothing is hosted yet:

- Create the sister repository and turn on GitHub Pages so the placeholder URL above serves `index.json`, with
  `thumbs/<id>.webp` beside it (or set `thumbnail` to an https URL).
- Publish each archive as a GitHub Release asset and fill `url`, `sizes.archiveBytes` and `hashes.sha256` from
  `node src/pack-archive-cli.ts index`.
- Moving the plain frame files out of this repository is a separate decision, including what to do about the copies
  already in git history. The previews in `packs/thumbs/` can stay.
