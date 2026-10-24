# pack-crop

Cuts a figure off a flat background with soft alpha, and measures how clean the cut is. Used for packs made with
an image model (FLUX.2 klein cannot make transparency: it outputs RGB only).

- `cutout.py`: closed-form matting (`pymatting`, MIT). A rough mask from the flat colour (white, or magenta for video),
  a thin unknown band around it, then soft alpha and edge colours with the background taken out.
- `build_pack.py`: a folder of 896×1024 PNGs on white → lossless WebP. Face edits share one alpha per pose; gestures are cut on their own.
  Prints a seam score for each shared picture.
- `build_loop.py`: frames of an activity loop on magenta → `activity-<name>-N.webp` (lossy q90, lossless alpha).
- `check.py`: measures a folder of RGBA WebP files (see its docstring). Run it on a Grok pack too: that is the bar.

Needs numpy, scipy, Pillow and pymatting (`uv pip install pymatting scipy`).

Numbers measured on the Risa casual pack (edge tint = white or magenta pixels that show at the edge; soft edge = share of edge pixels with partial alpha):

| | edge tint | soft edge |
| --- | --- | --- |
| Grok pack, neutral | 1.25 % | 90 % |
| Our old hard key, neutral | 0.39 % | 0 % |
| Matting, neutral | 0.12 % | 99 % |
| Grok pack, dancing loop | 0.42 % | 96 % |
| Our old key, reading loop | 1.4 % | 0 % |
| Matting, reading loop | 0.43 % | 99.8 % |

`cutout.py` also clears faint ghost strands: alpha below about a quarter is set to zero and the rest stretched, but only away from the solid body (within 2 px of it the edge keeps its own soft alpha, otherwise the shoulders and skirt get a patchy outline) (`floor`: 0.3 for stills, 0.12 for a soft video, where more makes the hair edge jagged). Recolouring edge pixels with the nearest solid colour (`snap`) and zeroing pale pixels beside hair (`strands`) were tried and made it worse or did nothing, so both are off.

A seam score above 16 (`SEAM_MAX`) means a face edit still differs from its base at the edge of the area it changed: look at that picture.
The numbers do not replace looking at the edge at 3× on a dark and a white background.
