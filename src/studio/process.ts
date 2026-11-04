import type { FrameRecord } from "./build.ts";

/**
 * PROCESS.md: how a pack was made, written next to its NOTICE.md when a pack is installed (a port of local_models `studio/export.py`'s `_process`).
 * It names the settings the pictures were made with, a checklist to go through by eye, and one row per picture: its tries, its seed and what the checks still flagged.
 * It says nothing about the owner: no name of a person and no contact address.
 */
export function processText(job: { name: string; outfit: string; source: string; sourceKind?: string }, model: string, records: Record<string, FrameRecord>): string {
  const rows = Object.entries(records).map(
    ([name, r]) => `| ${name} | seed ${r.seed}, ${r.attempts + 1} ${r.attempts === 0 ? "try" : "tries"} | ${r.flags.length ? `flags: ${r.flags.join("; ")}` : "no flags"} |`,
  );
  const checks = [
    "Every picture is the same character, framing and outfit (look at the pictures side by side)",
    "No magenta or violet left at the edges of the hair or body",
    "No duplicated parts (eyebrows, chin, arms) from a paste-back or a pose",
    "No part of the figure cut away",
    "Pictures with flags above have been looked at by eye",
    "Terms are right for publishing (NOTICE.md), and credit.txt is right",
  ];
  return `# How the ${job.name} pack was made

Made on this computer with the pack studio of the companion app, from ${job.sourceKind === "upload" ? "a picture the user uploaded" : "the \`" + job.source + "\` pack"}, in a new outfit: ${job.outfit}.
The pictures were generated locally or by the image maker the user chose; see NOTICE.md for what that means.

## Review checklist

${checks.map((c) => `- [ ] ${c}`).join("\n")}

## Settings

- Image maker: ${model}.
- Each picture starts from the base picture of the pack, with a seed derived from the pack's seed. A retry uses the next seed.
- A picture is retried (up to three tries) when a check flags it: a background that is no longer the key colour, a lower body that changed, a face edit that ran into its box,
  or a picture the blur check finds very blurry. The try with the fewest flags is kept.
- Export: lossless WebP, 940 x 1070.

## Pictures

| picture | details |
| --- | --- |
${rows.length ? rows.join("\n") : "| (none recorded) | |"}
`;
}
