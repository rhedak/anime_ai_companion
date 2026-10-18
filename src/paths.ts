import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The app's own folder. */
export const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * Where the user's own files live (settings, chat log, her look, custom.css) and the folder she works in when no project is set.
 * `data/` and `workspace/` next to the code unless ANAICO_DATA / ANAICO_WORKSPACE say otherwise. The Mac app sets them to a folder under
 * ~/Library/Application Support, because anything inside the app bundle is replaced by the next update.
 */
export const dataDir = process.env.ANAICO_DATA ? resolve(process.env.ANAICO_DATA) : join(appRoot, "data");
export const workspaceDir = process.env.ANAICO_WORKSPACE ? resolve(process.env.ANAICO_WORKSPACE) : join(appRoot, "workspace");
