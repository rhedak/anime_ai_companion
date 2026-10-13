// A plain JavaScript check that runs before any TypeScript does: on a Node too old to run .ts files directly, `node src/server.ts`
// fails with "unknown file extension", which says nothing about the real problem. This says it.

/** The oldest Node that runs the TypeScript sources directly (type stripping on by default). */
export const MIN_NODE = "22.18.0";

/** True when `version` ("22.5.1") is older than `min`. */
export function tooOld(version, min = MIN_NODE) {
  const a = String(version).split(".").map(Number);
  const b = String(min).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

export function oldNodeMessage(version = process.versions.node) {
  return `This needs Node.js ${MIN_NODE} or newer (it runs the TypeScript sources directly, with no build step), and this is Node ${version}.\nInstall a newer Node from https://nodejs.org, or with a version manager (nvm, fnm, mise), and try again.`;
}

if (tooOld(process.versions.node)) {
  console.error(oldNodeMessage());
  process.exit(1);
}
