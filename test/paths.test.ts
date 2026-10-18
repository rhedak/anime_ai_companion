import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const run = (env: Record<string, string>) =>
  JSON.parse(
    execFileSync(process.execPath, ["-e", `import("${new URL("../src/paths.ts", import.meta.url).href}").then(m => console.log(JSON.stringify([m.dataDir, m.workspaceDir, m.appRoot])))`], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...env },
    }),
  ) as string[];

test("data/ and workspace/ sit next to the code unless ANAICO_DATA and ANAICO_WORKSPACE say otherwise (the Mac app keeps them outside the bundle)", () => {
  const root = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
  const [data, workspace, appRoot] = run({});
  assert.equal(appRoot.replace(/[\\/]$/, ""), root);
  assert.equal(data, `${root}${process.platform === "win32" ? "\\" : "/"}data`);
  assert.ok(workspace.endsWith("workspace"));
  const [moved, movedWorkspace] = run({ ANAICO_DATA: "/tmp/anaico-x/data", ANAICO_WORKSPACE: "/tmp/anaico-x/work" });
  assert.match(moved, /anaico-x[\\/]data$/);
  assert.match(movedWorkspace, /anaico-x[\\/]work$/);
});
