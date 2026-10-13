import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseStreamLine, permissionResponse, prettyModel, summarizeTool } from "../src/providers/claude-stream.ts";

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
  assert.deepEqual(items[0], { kind: "init", sessionId: "11111111-2222-3333-4444-555555555555", model: null });
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
    { kind: "compacted", auto: false, before: null, after: null },
  ]);
  const auto = line({ subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 105689, post_tokens: 19364 } });
  assert.deepEqual(parseStreamLine(auto), [{ kind: "compacted", auto: true, before: 105689, after: 19364 }]);
});

test("a result carries the conversation's cost and how much context the last request used", () => {
  const line = JSON.stringify({
    type: "result",
    is_error: false,
    result: "hi",
    total_cost_usd: 0.25,
    usage: { input_tokens: 2, cache_read_input_tokens: 2000, cache_creation_input_tokens: 500, output_tokens: 3 },
  });
  assert.deepEqual(parseStreamLine(line), [{ kind: "result", isError: false, text: "hi", costUsd: 0.25, contextTokens: 2502, contextWindow: null }]);
  const bare = parseStreamLine(JSON.stringify({ type: "result", result: "" }))[0];
  assert.deepEqual(bare, { kind: "result", isError: false, text: "", costUsd: null, contextTokens: null, contextWindow: null });
});

test("the footer's inputs: model on init, usage limits, and the context window", () => {
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: "system", subtype: "init", session_id: "s", model: "claude-sonnet-5-5" })), [
    { kind: "init", sessionId: "s", model: "claude-sonnet-5-5" },
  ]);
  assert.equal(prettyModel("claude-sonnet-5-5"), "Sonnet 5.5");
  assert.equal(prettyModel("llama3.2"), "llama3.2");
  const limits = {
    type: "rate_limit_event",
    rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.48, resetsAt: 100 }, seven_day: { utilization: 0.18, resetsAt: 200 } } },
  };
  assert.deepEqual(parseStreamLine(JSON.stringify(limits)), [
    { kind: "limits", session: { used: 0.48, resetsAt: 100 }, week: { used: 0.18, resetsAt: 200 } },
  ]);
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: {} })), []);
  const result = parseStreamLine(JSON.stringify({ type: "result", result: "", modelUsage: { "claude-haiku-5-5": { contextWindow: 1000000 } } }))[0];
  assert.equal((result as { contextWindow: number }).contextWindow, 1000000);
});

test("context use is the last request of a turn, not the sum of all its requests", () => {
  const request = (n: number) => ({ type: "message", input_tokens: 1, cache_read_input_tokens: n, cache_creation_input_tokens: 0 });
  const result = {
    type: "result",
    result: "",
    // three requests in one turn (two tool calls): the top level adds them up
    usage: { input_tokens: 3, cache_read_input_tokens: 300_000, cache_creation_input_tokens: 0, iterations: [request(90_000), request(100_000), request(110_000)] },
  };
  assert.equal((parseStreamLine(JSON.stringify(result))[0] as { contextTokens: number }).contextTokens, 110_001);
});

test("a change in background tasks carries the full list, empty when the last one ends", () => {
  const running = parseStreamLine(
    JSON.stringify({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "a1", task_type: "local_agent", description: "Review the draft" }] }),
  );
  assert.deepEqual(running, [{ kind: "background", tasks: [{ id: "a1", description: "Review the draft" }] }]);
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: "system", subtype: "background_tasks_changed", tasks: [] })), [{ kind: "background", tasks: [] }]);
});
