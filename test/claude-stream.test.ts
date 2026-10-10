import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseStreamLine, permissionResponse, summarizeTool } from "../src/providers/claude-stream.ts";

// Lines recorded from `claude -p --input-format stream-json --output-format stream-json
// --permission-prompt-tool stdio`, trimmed and with paths anonymised.
const lines = readFileSync(new URL("./fixtures/claude-stream.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean);
const items = lines.flatMap(parseStreamLine);

test("parses the events the app relies on, in order", () => {
  assert.deepEqual(
    items.map((i) => i.kind),
    ["init", "delta", "tool-start", "permission", "permission-cancel", "tool-result", "tool-result", "result", "result"],
  );
});

test("init carries the session id and deltas carry text", () => {
  assert.deepEqual(items[0], { kind: "init", sessionId: "11111111-2222-3333-4444-555555555555" });
  assert.deepEqual(items[1], { kind: "delta", text: "[emotion:thinking] Let me check." });
});

test("a permission request keeps the exact input and the suggestions", () => {
  const p: any = items.find((i) => i.kind === "permission");
  assert.equal(p.requestId, "req-1");
  assert.equal(p.tool, "Bash");
  assert.equal(p.input.command, "touch created.txt && ls -la created.txt");
  assert.equal(p.suggestions.length, 2);
});

test("tool results report errors", () => {
  const results = items.filter((i) => i.kind === "tool-result");
  assert.deepEqual(results.map((r: any) => [r.id, r.isError]), [["toolu_01", true], ["toolu_02", false]]);
});

test("result distinguishes success from error", () => {
  const results: any[] = items.filter((i) => i.kind === "result");
  assert.deepEqual(results.map((r) => [r.isError, r.text]), [[false, "All done."], [true, "Something broke"]]);
});

test("summaries are single-line and truncated", () => {
  assert.equal(summarizeTool("Bash", { command: "touch  a\n&& ls" }), "touch a && ls");
  assert.equal(summarizeTool("Read", { file_path: "/a/b.ts" }), "/a/b.ts");
  assert.ok(summarizeTool("Bash", { command: "x".repeat(500) }).length <= 120);
  assert.equal(summarizeTool("Unknown", {}), "");
});

const suggestions = [
  { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "ls" }], behavior: "allow", destination: "localSettings" },
  { type: "setMode", mode: "acceptEdits", destination: "session" },
];
const parse = (s: string) => JSON.parse(s).response;

test("allow echoes the input back", () => {
  assert.deepEqual(parse(permissionResponse("r", "allow", { command: "ls" }, suggestions)), {
    subtype: "success",
    request_id: "r",
    response: { behavior: "allow", updatedInput: { command: "ls" } },
  });
});

test("allow-session remembers the rule for the session only, never in project settings", () => {
  const body = parse(permissionResponse("r", "allow-session", { command: "ls" }, suggestions)).response;
  assert.equal(body.updatedPermissions.length, 1);
  assert.equal(body.updatedPermissions[0].destination, "session");
  assert.deepEqual(body.updatedPermissions[0].rules, [{ toolName: "Bash", ruleContent: "ls" }]);
});

test("deny carries a message the model can read", () => {
  const body = parse(permissionResponse("r", "deny", { command: "ls" }, suggestions, "Not now")).response;
  assert.deepEqual(body, { behavior: "deny", message: "Not now" });
});

// Recorded from a real `/compact` sent over stream-json (ids shortened).
test("/compact progress shows as status events and a compaction notice", () => {
  const line = (o: object) => JSON.stringify({ type: "system", session_id: "s", ...o });
  assert.deepEqual(parseStreamLine(line({ subtype: "status", status: "compacting" })), [
    { kind: "status", text: "Compacting the conversation…" },
  ]);
  assert.deepEqual(parseStreamLine(line({ subtype: "status", status: null, compact_result: "success" })), [
    { kind: "status", text: null },
  ]);
  assert.deepEqual(parseStreamLine(line({ subtype: "compact_boundary", compact_metadata: { trigger: "manual" } })), [
    { kind: "compacted" },
  ]);
});
