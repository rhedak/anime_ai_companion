#!/usr/bin/env node
// Builds the documentation site and puts the browser demo in it at demo/, the way the pages workflow does, then serves the result so the
// site and the link to the demo can be looked at before a release.
//
//   npm run site:preview [port]        default port 8766, http://127.0.0.1:8766/
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, stage } from "../demo/stage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [join(root, "site/build.mjs")], { stdio: "inherit" });
const dist = join(root, "site/dist");
const done = await stage(join(dist, "demo"));
console.log(`staged the demo into site/dist/demo (${done.files} compiled files)`);
serve(dist, Number(process.argv[2]) || 8766);
