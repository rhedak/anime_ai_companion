import assert from "node:assert/strict";
import { test } from "node:test";
import { commandText, serverEnv } from "../src/studio/local-server.ts";

test("the server gets the app's environment without keys, tokens, secrets or passwords", () => {
  const env = serverEnv({ PATH: "/bin", HF_HUB_CACHE: "/hub", XAI_API_KEY: "a", HF_TOKEN: "b", MY_SECRET: "c", DB_PASSWORD: "d", GEMINI_API_KEY: "e" });
  assert.deepEqual(env, { PATH: "/bin", HF_HUB_CACHE: "/hub" });
});

test("the command is shown with a path that has a space quoted", () => {
  assert.equal(commandText("/v/bin/python", "/my dir/server.py", 7861, "mps"), `/v/bin/python "/my dir/server.py" --port 7861 --device mps`);
});

test("a server the app started ends with the app", async () => {
  const { spawn } = await import("node:child_process");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "anaico-leave-"));
  const child = join(dir, "child.js");
  await writeFile(child, `setInterval(() => {}, 1000); console.log("child pid " + process.pid);`);
  const parent = join(dir, "parent.ts");
  await writeFile(
    parent,
    `import { LocalServer } from ${JSON.stringify(new URL("../src/studio/local-server.ts", import.meta.url).href)};
     const s = new LocalServer(() => {});
     await s.start(process.execPath, ${JSON.stringify(child)}, 1, "cpu", async () => s.state.log.some((l) => l.startsWith("child pid")));
     console.log(s.state.log.find((l) => l.startsWith("child pid")));
     process.exit(0);`,
  );
  const out = await new Promise<string>((resolve) => {
    const p = spawn(process.execPath, [parent], { stdio: ["ignore", "pipe", "inherit"] });
    let text = "";
    p.stdout.on("data", (d) => (text += d));
    p.on("exit", () => resolve(text));
  });
  const pid = Number(/child pid (\d+)/.exec(out)?.[1]);
  assert.ok(pid > 0, out);
  await new Promise((r) => setTimeout(r, 500));
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, "the child is gone after the app exits");
});
