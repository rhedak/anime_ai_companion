# Picture-pack archives

The app still shows a pack from a folder of pictures (`docs/frame-packs.md`). Nothing here changes that.
This is the download format for later, when a pack can live outside the repository and be fetched the first time
someone uses it (issue #8). The running app does not read an index or an archive yet, and the packs in `packs/`
stay as plain frames.

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
      "thumbnail": "https://github.com/rhedak/anime_ai_companion/releases/download/pack-franzi-pajamas-1/franzi-pajamas-thumb.webp",
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
| `description`, `thumbnail`, `credit`, `aiMade` | Optional. What a gallery can show before the pictures are on disk. `thumbnail` is an https URL. |

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
- `credit.txt`, `NOTICE.md`, and `PROCESS.md` when the folder has them

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

The tool uses `sharp` (a devDependency) to read and write the WebP. The server does not load it. The later installer
will need this same codec at runtime.

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

A blink's rectangle is about 145×60 pixels. Most of the archive is the frames that were stored whole.

## Not in this step

The app still does not download anything. Left for later:

- A server-side installer: fetch the index, download the archive, verify `hashes.sha256`, extract only allowed file
  names, require `NOTICE.md` and `credit.txt`, stage into a temporary directory, then rename into `data/frames/<id>/`.
  Downloads have to run in Node. A GitHub Release asset sends no CORS header, so the browser cannot fetch it.
- Offering a remote pack from `/frames <name>` and the gallery, and downloading it the first time it is chosen.
  Installed packs keep working offline. A remote one that is not installed shows as unavailable.
- Publishing the archives as GitHub Release assets (or, once there are many, from a sister repository) and publishing
  `packs/index.json` for real.
- Moving the plain frame files out of this repository, which is a separate decision from the format, and would include
  what to do about the copies already in git history.
