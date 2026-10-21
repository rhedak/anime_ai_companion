import { readFile } from "node:fs/promises";

/**
 * Whether the user said yes, in the desktop app's first-start dialog, to checking for updates on their own once a day (`auto`) and to including the
 * picture-pack list in that (`packs`). The desktop shell keeps the answer in `updates.json` and gives the server its path in `ANAICO_UPDATES_FILE`;
 * it is read each time so that changing it under File, Options takes effect without a restart. Without the variable (`npm start`, `anaico`) there
 * is no such question, so this is off: those runs only look for pack updates when the user opens the gallery or picks a pack.
 */
export async function packUpdateChecksOn(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const file = env.ANAICO_UPDATES_FILE;
  if (!file) return false;
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as { auto?: unknown; packs?: unknown };
    return saved.auto === true && saved.packs === true;
  } catch {
    return false;
  }
}
