// electron-builder never copies a node_modules folder through extraResources, whatever the filter says, so the app's production packages
// (staged by scripts/stage.mjs) are put into the packed app here, before the installer is made from it.
const { cpSync, existsSync, rmSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const from = path.join(__dirname, "..", "stage", "anaico-app", "node_modules");
  // macOS keeps resources inside the bundle; Windows next to the exe.
  const resources = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, context.packager.appInfo.productFilename + ".app", "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  const to = path.join(resources, "anaico-app", "node_modules");
  if (!existsSync(from)) throw new Error("run `npm run stage` first: " + from + " is missing");
  cpSync(from, to, { recursive: true });
  // .bin only holds links to command-line tools nothing here runs, and their relative targets break the macOS code signature.
  rmSync(path.join(to, ".bin"), { recursive: true, force: true });
};
