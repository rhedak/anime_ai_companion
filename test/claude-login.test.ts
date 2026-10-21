import { test } from "node:test";
import assert from "node:assert/strict";
import { describeAuthError, describeStatus, firstUrl, isAuthFailure, parseAuthStatus } from "../src/claude-login.ts";

test("auth failures are recognised and explained, other errors pass through", () => {
  const raw = "Failed to authenticate: OAuth session expired and could not be refreshed";
  assert.ok(isAuthFailure(raw));
  assert.match(describeAuthError(raw), /\/claude-login/);
  assert.match(describeAuthError(raw), /claude auth login/);
  assert.equal(describeAuthError("Rate limited"), "Rate limited");
});

test("claude auth status is parsed", () => {
  assert.deepEqual(parseAuthStatus('{"loggedIn":true,"authMethod":"claude.ai"}'), { loggedIn: true, method: "claude.ai" });
  assert.equal(parseAuthStatus("nonsense"), null);
  assert.equal(parseAuthStatus(null), null);
  assert.match(describeStatus({ loggedIn: false }), /\/claude-login/);
  assert.equal(firstUrl("Open https://claude.ai/oauth/x?a=1 now"), "https://claude.ai/oauth/x?a=1");
});
