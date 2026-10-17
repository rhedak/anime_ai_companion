// electron-builder never copies a node_modules folder through extraResources, whatever the filter says, so the app's production packages
// (staged by scripts/stage.mjs) are put into the packed app here, before the installer is made from it.
const { cpSync, existsSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const from = path.join(__dirname, "..", "stage", "anaico-app", "node_modules");
  const to = path.join(context.appOutDir, "resources", "anaico-app", "node_modules");
  if (!existsSync(from)) throw new Error("run `npm run stage` first: " + from + " is missing");
  cpSync(from, to, { recursive: true });
};
