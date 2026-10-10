/**
 * Parsing of `claude -p --output-format stream-json` lines, kept free of any
 * process handling so it can be tested against recorded output. The CLI's event
 * format is not a stable API; the fixtures in test/fixtures show what we rely on.
 */

/** How much of a usage window is used (0 to 1) and when it resets (unix seconds). */
export interface Limit {
  used: number;
  resetsAt: number | null;
}

export type StreamItem =
  | { kind: "init"; sessionId: string; model: string | null }
  | { kind: "limits"; session: Limit | null; week: Limit | null }
  | { kind: "delta"; text: string }
  | { kind: "tool-start"; id: string; name: string; input: Record<string, unknown> }
  | { kind: "tool-result"; id: string; isError: boolean }
  | {
      kind: "permission";
      requestId: string;
      tool: string;
      input: Record<string, unknown>;
      description?: string;
      suggestions: any[];
    }
  | { kind: "permission-cancel"; requestId: string }
  | { kind: "status"; text: string | null }
  | { kind: "compacted" }
  | { kind: "result"; isError: boolean; text: string; costUsd: number | null; contextTokens: number | null; contextWindow: number | null };

export function parseStreamLine(line: string): StreamItem[] {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init" && msg.session_id) {
        return [{ kind: "init", sessionId: msg.session_id, model: typeof msg.model === "string" ? msg.model : null }];
      }
      // `/compact` reports progress as status events: "compacting", then null when done.
      if (msg.subtype === "status") return [{ kind: "status", text: msg.status === "compacting" ? "Compacting the conversation…" : null }];
      if (msg.subtype === "compact_boundary") return [{ kind: "compacted" }];
      return [];

    case "rate_limit_event": {
      // Subscription limits: the five-hour "session" window and the seven-day "week" window.
      const windows = msg.rate_limit_info?.unifiedWindows ?? {};
      const limit = (w: any): Limit | null =>
        typeof w?.utilization === "number" ? { used: w.utilization, resetsAt: typeof w.resetsAt === "number" ? w.resetsAt : null } : null;
      const session = limit(windows.five_hour);
      const week = limit(windows.seven_day);
      // An event without the windows says nothing new: keep what we know rather than blank it.
      return session || week ? [{ kind: "limits", session, week }] : [];
    }

    case "stream_event": {
      const delta = msg.event?.delta;
      if (msg.event?.type === "content_block_delta" && delta?.type === "text_delta") {
        return [{ kind: "delta", text: delta.text }];
      }
      return [];
    }

    case "assistant":
      return blocks(msg)
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ kind: "tool-start", id: b.id, name: b.name, input: b.input ?? {} }) as StreamItem);

    case "user":
      return blocks(msg)
        .filter((b) => b.type === "tool_result")
        .map((b) => ({ kind: "tool-result", id: b.tool_use_id, isError: Boolean(b.is_error) }) as StreamItem);

    case "control_request":
      if (msg.request?.subtype === "can_use_tool") {
        return [
          {
            kind: "permission",
            requestId: msg.request_id,
            tool: msg.request.tool_name,
            input: msg.request.input ?? {},
            description: msg.request.description,
            suggestions: msg.request.permission_suggestions ?? [],
          },
        ];
      }
      return [];

    case "control_cancel_request":
      return [{ kind: "permission-cancel", requestId: msg.request_id }];

    case "result":
      return [
        {
          kind: "result",
          isError: Boolean(msg.is_error),
          text: String(msg.result ?? ""),
          // Cumulative over the claude process, not per turn.
          costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : null,
          contextTokens: contextTokensOf(msg.usage),
          contextWindow: contextWindowOf(msg.modelUsage),
        },
      ];

    default:
      return [];
  }
}

/**
 * What the last request of the turn sent: roughly how full the context window is. A turn with tool
 * calls makes several requests and the top-level usage adds them all up, which would overstate it
 * many times over; the per-request `iterations` list has the real figure.
 */
function contextTokensOf(usage: any): number | null {
  if (!usage) return null;
  const sent = (u: any) => (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const requests = Array.isArray(usage.iterations) ? usage.iterations.filter((i: any) => i && i.type !== "compaction") : [];
  return sent(requests.length ? requests[requests.length - 1] : usage);
}

/** "claude-sonnet-5-5" -> "Sonnet 5.5"; anything else is shown as it is. */
export function prettyModel(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id);
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}` : id;
}

/** The context window of the model that answered (the first one listed if several did). */
function contextWindowOf(modelUsage: any): number | null {
  const first: any = modelUsage && typeof modelUsage === "object" ? Object.values(modelUsage)[0] : null;
  return typeof first?.contextWindow === "number" ? first.contextWindow : null;
}

function blocks(msg: any): any[] {
  const content = msg.message?.content;
  return Array.isArray(content) ? content : [];
}

/** A short, single-line description of a tool call for the UI. */
export function summarizeTool(name: string, input: Record<string, unknown>): string {
  const pick = (...keys: string[]) => keys.map((k) => input[k]).find((v) => typeof v === "string") as string | undefined;
  const text = pick("command", "file_path", "path", "pattern", "url", "query", "description") ?? "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? oneLine.slice(0, 117) + "..." : oneLine;
}

/** The control_response line that answers a permission request. */
export function permissionResponse(
  requestId: string,
  decision: "allow" | "allow-session" | "deny",
  input: Record<string, unknown>,
  suggestions: any[],
  message = "The user declined this action.",
): string {
  let response: Record<string, unknown>;
  if (decision === "deny") {
    response = { behavior: "deny", message };
  } else {
    response = { behavior: "allow", updatedInput: input };
    if (decision === "allow-session") {
      // Remember the suggested rule for this session only, never in the project's settings files.
      const rule = suggestions.find((s) => s.type === "addRules");
      if (rule) response.updatedPermissions = [{ ...rule, destination: "session" }];
    }
  }
  return JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: requestId, response },
  });
}
