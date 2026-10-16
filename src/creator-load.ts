/**
 * Loads the creator's TypeScript under Node: imports its modules by path from the `ts/src` folder (src/creator.ts says where that is) and
 * hands them to `creatorFromModules` (src/render-ops.ts). The browser demo does the same with modules imported from URLs
 * (demo/render-bridge.js); this file is the Node-only half, so src/render-ops.ts has no `node:` import and compiles for the browser.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { creatorFromModules, type Creator } from "./render-ops.ts";

/** Imports the creator's TypeScript from its `ts/src` folder, at run time, by path. */
export async function loadCreator(creatorSrc: string): Promise<Creator> {
  const load = (file: string): Promise<any> => import(pathToFileURL(join(creatorSrc, file)).href);
  return creatorFromModules({
    render: await load("render.ts"),
    presets: await load("presets.ts"),
    head: await load("core-head.ts"),
    body: await load("body.ts"),
    model: await load("model.ts"),
    urlstate: await load("urlstate.ts"),
    pynum: await load("pynum.ts"),
    pyjson: await load("pyjson.ts"),
    pyjsonload: await load("pyjsonload.ts"),
    pyvalue: await load("pyvalue.ts"),
  });
}
