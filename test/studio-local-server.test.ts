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
