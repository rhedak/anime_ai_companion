/**
 * Parsing of `claude -p --output-format stream-json` lines, kept free of any
 * process handling so it can be tested against recorded output. The CLI's event
 * format is not a stable API; the fixtures in test/fixtures show what we rely on.
 */

export type StreamItem =
  | { kind: "init"; sessionId: string }
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
  | { kind: "result"; isError: boolean; text: string };

export function parseStreamLine(line: string): StreamItem[] {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  switch (msg.type) {
    case "system":
      return msg.subtype === "init" && msg.session_id ? [{ kind: "init", sessionId: msg.session_id }] : [];

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
      return [{ kind: "result", isError: Boolean(msg.is_error), text: String(msg.result ?? "") }];

    default:
      return [];
  }
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
