// What test/render-ops.test.ts and scripts/refresh-render-ops-fixture.ts share: how a fixture case is read (its `{"$character": name}` references
// expanded) and how a reply is kept (SVGs and a patched character as a SHA-256 and a length, a base character as a reference).
import { createHash } from "node:crypto";
import type { Creator } from "../../src/render-ops.ts";

export function fixtureTools(creator: Creator, characters: Map<string, unknown>) {
  const dumps = (value: unknown): string => creator.dumps(value);
  const sha = (text: string): Map<string, unknown> => {
    const bytes = Buffer.from(text, "utf8");
    return new Map<string, unknown>([["sha256", createHash("sha256").update(bytes).digest("hex")], ["len", new creator.PyInt(bytes.length)]]);
  };
  const structuredCopy = (value: unknown): unknown => {
    if (value instanceof Map) return new Map([...value].map(([k, v]) => [k, structuredCopy(v)]));
    if (Array.isArray(value)) return value.map(structuredCopy);
    return value;
  };
  /** A request with its {"$character": name} references replaced by the characters. */
  const expand = (value: unknown): unknown => {
    if (value instanceof Map) {
      if (value.size === 1 && value.has("$character")) return structuredCopy(characters.get(value.get("$character") as string));
      return new Map([...value].map(([k, v]) => [k, expand(v)]));
    }
    if (Array.isArray(value)) return value.map(expand);
    return value;
  };
  /** What the fixture keeps of a reply: SVGs and a patched character shortened, a base character as a reference. */
  const shorten = (request: unknown, reply: unknown): unknown => {
    if (!(reply instanceof Map)) return reply;
    const out = new Map(reply);
    const svgs = out.get("svgs");
    if (Array.isArray(svgs)) out.set("svgs", svgs.map((s) => (typeof s === "string" ? sha(s) : s)));
    const op = request instanceof Map ? request.get("op") : undefined;
    if (out.has("character")) {
      if (op === "patch") out.set("character", sha(dumps(out.get("character"))));
      else if (op === "base") {
        const name = (request as Map<string, unknown>).get("name") as string;
        if (dumps(out.get("character")) === dumps(characters.get(name))) out.set("character", new Map([["$character", name]]));
      }
    }
    return out;
  };
  return { dumps, sha, expand, shorten };
}
