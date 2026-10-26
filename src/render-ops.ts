/**
 * What the renderer can be asked, as plain functions: schema, base, patch, frames.
 *
 * This is python/render_ops.py in TypeScript, on the creator's TypeScript drawing code (the creator's `ts/src` folder). A request is
 * one JSON object and so is the reply, as in src/render-worker.ts:
 *   {"id": 1, "op": "schema"}
 *   {"id": 2, "op": "base", "name": "linnea"}
 *   {"id": 3, "op": "patch", "character": {...}, "set": {"hair_color": "#ff0000"}}
 *   {"id": 4, "op": "frames", "character": {...}, "face": {...}, "mouth": [0, 0.3, 0.6]}
 * Every reply is {"ok": true, ...} or {"ok": false, "error": "ClassName: text"}, and carries the request's `id`.
 *
 * test/render-ops.test.ts replays about three thousand requests that Python answered (test/fixtures/render-ops.json, made by
 * scripts/gen-render-ops-fixtures.py) and compares: the replies are the same JSON, down to the error text.
 *
 * The creator is only loaded, never modified and never imported statically (the app's typecheck must not read its sources):
 * a caller imports its modules at run time and `creatorFromModules` below turns them into a `Creator`, the small part of it this file uses.
 * This file is also compiled for the browser demo (tsconfig.demo.json, `demo/stage.mjs`), so it imports nothing at all, and nothing from
 * `node:`. `loadCreator` (src/creator-load.ts) is what imports the creator by path under Node.
 *
 * How values are carried. A request is read with the creator's `loadsText`, which is Python's `json.loads`: an object is a `Map`, an int a
 * `PyInt` and every other number a plain float, so `1` and `1.0` stay different, as they did in Python. A reply is written with the creator's
 * `dumps` (Python's `json.dumps`). The Python behaviours this file reproduces on purpose (the `float()` parser, `str.strip`, the text of
 * a KeyError) are named where they are.
 */
type FieldSpec = { readonly name: string; readonly type: string; readonly nullable: boolean; readonly default: unknown };
type PyIntLike = { readonly value: number | bigint };

/** The part of the creator's TypeScript this file uses. */
export interface Creator {
  PRESETS: Record<string, unknown>;
  HAIRSTYLES: Record<string, unknown>;
  BODY_TYPES: Record<string, unknown>;
  FIELDS: Record<"CharacterParams" | "Outfit" | "FaceStyle", readonly FieldSpec[]>;
  renderCharacter(p: unknown): string;
  paramsFromDict(input: unknown): unknown;
  paramsToJson(p: unknown): unknown;
  /** Python's `dict(x)`. */
  pyDict(value: unknown): Map<unknown, unknown>;
  loadsText(text: string): unknown;
  dumps(value: unknown): string;
  PyInt: new (value: number) => PyIntLike;
  pyRound(x: number): number;
  pyRepr(x: number): string;
  truthy(v: unknown): boolean;
  pyValueRepr(v: unknown): string;
  pyStr(v: unknown): string;
  pyTypeName(v: unknown): string;
  pyStrReprFull(s: string): string;
}

/**
 * The creator's modules, as `import()` hands them over. A caller that has imported them (the server's worker by path, in
 * src/creator-load.ts; the browser demo by URL, in demo/render-bridge.js) passes the namespaces here and gets a `Creator`. Each name is the
 * creator's file (render.ts is `render`); a namespace is typed `any` because the creator is never read by this app's typecheck.
 */
export interface CreatorModules {
  render: any;
  presets: any;
  head: any; // core-head
  body: any;
  model: any;
  urlstate: any;
  pynum: any;
  pyjson: any;
  pyjsonload: any;
  pyvalue: any;
}

/** Builds a `Creator` from the creator's already-imported modules. This is the only place that knows which module holds which name. */
export function creatorFromModules(m: CreatorModules): Creator {
  return {
    PRESETS: m.presets.PRESETS,
    HAIRSTYLES: m.head.HAIRSTYLES,
    BODY_TYPES: m.body.BODY_TYPES,
    FIELDS: m.model.FIELDS,
    renderCharacter: (p) => m.render.renderCharacter(p),
    paramsFromDict: m.urlstate.paramsFromDict,
    paramsToJson: m.urlstate.paramsToJson,
    pyDict: m.urlstate.pyDict,
    loadsText: m.pyjsonload.loadsText,
    dumps: (value) => m.pyjson.dumps(value),
    PyInt: m.pyjson.PyInt,
    pyRound: m.pynum.pyRound,
    pyRepr: m.pynum.pyRepr,
    truthy: m.pynum.truthy,
    pyValueRepr: m.pyvalue.pyValueRepr,
    pyStr: m.pyvalue.pyStr,
    pyTypeName: m.pyvalue.pyTypeName,
    pyStrReprFull: m.pyvalue.pyStrReprFull,
  };
}

/** A Python exception: `message` is "ClassName: text", as the worker has always put it in an error reply. */
class PyException extends Error {
  readonly pyType: string;
  constructor(pyType: string, text: string) {
    super(`${pyType}: ${text}`);
    this.pyType = pyType;
  }
}

const hasPyType = (e: unknown): e is Error & { pyType: string } => e instanceof Error && typeof (e as { pyType?: unknown }).pyType === "string";

/** `f"{type(exc).__name__}: {exc}"`. */
function errorText(e: unknown): string {
  if (hasPyType(e)) return e.message;
  return e instanceof Error ? `${e.name}: ${e.message}` : `Error: ${String(e)}`;
}

/** `str(exc)`: the text after "ClassName: ". */
function bareText(e: unknown): string {
  if (hasPyType(e)) return e.message.slice(e.pyType.length + 2);
  return e instanceof Error ? e.message : String(e);
}

/** Python's `str.isspace` set, which `str.strip()` removes. JavaScript's `trim()` differs (it strips U+FEFF, not U+001C to U+001F or U+0085). */
const STRIP = /^[\t\n\v\f\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
const pyStrip = (s: string): string => s.replace(STRIP, "");

/** The value of a decimal digit in any script (`float("\u0663")` is 3.0): its offset within its run of ten. */
function digitValue(ch: string): number {
  const cp = ch.codePointAt(0) as number;
  if (cp < 128) return cp - 48;
  let start = cp;
  while (start > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(start - 1)) && cp - start < 60) start--;
  return (cp - start) % 10;
}

const DIGITS = "[0-9]+(?:_[0-9]+)*";
const FLOAT_TEXT = new RegExp(`^([+-]?)(?:(inf|infinity)|(nan)|((?:${DIGITS}(?:\\.(?:${DIGITS})?)?|\\.${DIGITS})(?:e[+-]?${DIGITS})?))$`, "i");

export function createRenderOps(c: Creator) {
  const SECTIONS = ["face", "outfit"] as const;
  const specs = (fields: readonly FieldSpec[]): Map<string, FieldSpec> => new Map(fields.map((f) => [f.name, f]));
  const FIELDS: Record<string, Map<string, FieldSpec>> = {
    "": specs(c.FIELDS.CharacterParams.filter((f) => !(SECTIONS as readonly string[]).includes(f.name))),
    face: specs(c.FIELDS.FaceStyle),
    outfit: specs(c.FIELDS.Outfit),
  };
  const TOP = FIELDS[""];
  const own = (table: object, key: string): boolean => Object.hasOwn(table, key);

  const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  // Free-text values (wristband_text, hair_clip, ...) end up inside the SVG, and the creator does
  // not escape them, so only plain words are accepted: no markup characters, quotes or slashes.
  const PLAIN_TEXT = /^[A-Za-z0-9_.,!?' -]{1,40}$/;

  const err = (type: string, text: string): PyException => new PyException(type, text);
  const typeName = (v: unknown): string => c.pyTypeName(v);
  const keyRepr = (k: unknown): string => c.pyValueRepr(k);

  // ---- Python's own operations on a loaded request, with the errors Python raises ----

  /** `obj[key]` for a str key. */
  function getItem(obj: unknown, key: string): unknown {
    if (obj instanceof Map) {
      if (!obj.has(key)) throw err("KeyError", keyRepr(key));
      return obj.get(key);
    }
    if (Array.isArray(obj)) throw err("TypeError", "list indices must be integers or slices, not str");
    if (typeof obj === "string") throw err("TypeError", "string indices must be integers, not 'str'");
    throw err("TypeError", `'${typeName(obj)}' object is not subscriptable`);
  }

  /** The dict a method is called on: anything else has no such attribute. */
  function dictFor(obj: unknown, method: string): Map<unknown, unknown> {
    if (obj instanceof Map) return obj;
    throw err("AttributeError", `'${typeName(obj)}' object has no attribute '${method}'`);
  }

  /** `for x in value`: a list's items, a str's characters, a dict's keys. */
  function iterate(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return Array.from(value);
    if (value instanceof Map) return [...value.keys()];
    throw err("TypeError", `'${typeName(value)}' object is not iterable`);
  }

  /** `value[0]`. */
  function first(value: unknown): unknown {
    if (Array.isArray(value)) {
      if (value.length === 0) throw err("IndexError", "list index out of range");
      return value[0];
    }
    if (typeof value === "string") {
      if (value.length === 0) throw err("IndexError", "string index out of range");
      return Array.from(value)[0];
    }
    if (value instanceof Map) throw err("KeyError", "0");
    throw err("TypeError", `'${typeName(value)}' object is not subscriptable`);
  }

  /** `key in table` for a dict with str keys: a list or a dict cannot be looked up. */
  function inTable(table: object, key: unknown): boolean {
    if (Array.isArray(key) || key instanceof Map) throw err("TypeError", `unhashable type: '${typeName(key)}'`);
    return typeof key === "string" && own(table, key);
  }

  /** `json.loads(json.dumps(x))`: a deep copy. */
  function copy(value: unknown): unknown {
    if (value instanceof Map) return new Map([...value].map(([k, v]) => [k, copy(v)]));
    if (Array.isArray(value)) return value.map(copy);
    return value;
  }

  /** A request that was not read by `loadsText` (a plain object, from a caller in this process) as the same tree. */
  function normalize(value: unknown): unknown {
    if (value === null || typeof value !== "object" || value instanceof Map || value instanceof c.PyInt) return value;
    if (Array.isArray(value)) return value.map(normalize);
    return new Map(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  }

  // ---- coerce ----

  /** Python's `float(raw)` for a loaded JSON value. */
  function toFloat(raw: unknown): number {
    if (typeof raw === "number") return raw;
    if (typeof raw === "boolean") return raw ? 1 : 0;
    if (raw instanceof c.PyInt) {
      const n = Number(raw.value);
      if (!Number.isFinite(n)) throw err("OverflowError", "int too large to convert to float");
      return n;
    }
    if (typeof raw === "string") {
      const t = pyStrip(raw).replace(/\p{Nd}/gu, (ch) => String(digitValue(ch)));
      const m = FLOAT_TEXT.exec(t);
      if (!m) throw err("ValueError", `could not convert string to float: ${c.pyStrReprFull(raw)}`);
      const sign = m[1] === "-" ? -1 : 1;
      if (m[2] !== undefined) return sign * Infinity;
      if (m[3] !== undefined) return NaN;
      return sign * Number((m[4] as string).replace(/_/g, ""));
    }
    throw err("TypeError", `float() argument must be a string or a real number, not '${typeName(raw)}'`);
  }

  /** Turn the model's text value into the dataclass field's type. */
  function coerce(name: string, spec: FieldSpec, rawIn: unknown): unknown {
    let raw = rawIn;
    if (typeof raw === "string") raw = pyStrip(raw);
    if (typeof raw === "string" && ["none", "null", "off"].includes(raw.toLowerCase())) {
      if (spec.nullable) return null;
      throw err("ValueError", "cannot be removed");
    }
    const base = spec.type;
    if (base === "bool") {
      const word = c.pyStr(raw).toLowerCase();
      if (["true", "yes", "on", "1"].includes(word)) return true;
      if (["false", "no", "0"].includes(word)) return false;
      throw err("ValueError", "expected true or false");
    }
    if (base === "float" || base === "int") {
      const x = toFloat(raw);
      if (!Number.isFinite(x) || Math.abs(x) > 20) throw err("ValueError", "number out of range");
      return base === "int" ? new c.PyInt(c.pyRound(x)) : x;
    }
    if (base === "str") {
      let text = c.pyStr(raw);
      if (name.endsWith("_color") || name === "skin_tone") {
        if (!HEX.test(text)) throw err("ValueError", "expected a hex colour like #ff88cc");
        if (text.length === 4) text = "#" + [...text.slice(1)].map((ch) => ch + ch).join("");
        return text.toLowerCase();
      }
      if (name === "hairstyle" && !own(c.HAIRSTYLES, text)) throw err("ValueError", `hairstyle must be one of ${Object.keys(c.HAIRSTYLES).join(", ")}`);
      if (name === "body" && !own(c.BODY_TYPES, text)) throw err("ValueError", `body must be one of ${Object.keys(c.BODY_TYPES).join(", ")}`);
      if (!PLAIN_TEXT.test(text)) throw err("ValueError", "text may only use letters, digits and simple punctuation (up to 40 characters)");
      return text;
    }
    throw err("ValueError", `unsupported field type ${base}${spec.nullable ? " | None" : ""}`);
  }

  /** 'outfit.hat_color' or bare 'hat_color' -> (section, field name). */
  function locate(key: unknown): [string, string] {
    if (typeof key !== "string") throw err("TypeError", `argument of type '${typeName(keyValue(key))}' is not iterable`);
    if (key.includes(".")) {
      const at = key.indexOf(".");
      const section = key.slice(0, at);
      const name = key.slice(at + 1);
      if ((SECTIONS as readonly string[]).includes(section) && FIELDS[section]?.has(name)) return [section, name];
      throw err("ValueError", `unknown field '${key}'`);
    }
    for (const section of ["", "face", "outfit"]) { // names do not overlap between the three
      if (FIELDS[section]?.has(key)) return [section, key];
    }
    throw err("ValueError", `unknown field '${key}'`);
  }

  /**
   * A dict key that is not a str (only a list of pairs can make one, `{"set": [[1, 2]]}`) as the value it was. The creator's `pyDict` keeps its
   * `repr`; every hashable JSON value has one of these: an int, a float, true, false or null.
   */
  function keyValue(key: unknown): unknown {
    const repr = (key as { repr?: string } | null)?.repr ?? "";
    if (/^-?\d+$/.test(repr)) return new c.PyInt(Number(repr));
    if (repr === "True" || repr === "False") return repr === "True";
    if (repr === "None") return null;
    return repr === "nan" ? NaN : repr === "inf" ? Infinity : repr === "-inf" ? -Infinity : Number(repr);
  }

  // What the model may and may not do to her own look. The drawn figure is an adult, so she
  // cannot be drawn younger, and she keeps at least one covering garment: the creator always
  // draws underwear, and nothing the model sends takes her down to just that.
  const MODEL_LOCKED: Record<string, string> = { face_age: "her age is fixed; she is always drawn as an adult" };
  // Bodies that accept `hair_tip_color` and show nothing (a copy of BODIES_WITHOUT_HAIR_TIPS in public/hair-tips.js, which this file cannot import; a test keeps them equal).
  const NO_HAIR_TIPS = ["adult_female"];
  const COVERING = ["tunic_color", "coat_color", "robe_color", "skirt_color", "trouser_color"];

  /** Raise ValueError if the model may not make this change to this character. */
  function checkAllowed(character: unknown, section: string, name: string, value: unknown): void {
    if (own(MODEL_LOCKED, name)) throw err("ValueError", MODEL_LOCKED[name] as string);
    if (name === "hair_tip_color" && value !== null && NO_HAIR_TIPS.includes(getItem(character, "body") as string)) throw err("ValueError", "this body does not draw hair tips yet");
    if (name === "height" && (value as number) < 1.0) throw err("ValueError", "height must be 1.0 or more");
    if (section === "outfit" && COVERING.includes(name) && value === null) {
      const outfit = dictFor(getItem(character, "outfit"), "get");
      if (!COVERING.some((other) => other !== name && c.truthy(outfit.has(other) ? outfit.get(other) : null))) {
        throw err("ValueError", "she keeps at least one covering garment on");
      }
    }
  }

  /** A value as the model wrote it: true, false, none, #rrggbb. */
  function show(value: unknown): string {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value === null) return "none";
    if (typeof value === "number") return c.pyRepr(value);
    if (value instanceof c.PyInt) return String(value.value);
    return String(value);
  }

  const render = (character: unknown): string => c.renderCharacter(c.paramsFromDict(character));

  function opSchema(): Map<string, unknown> {
    const describe = (section: string): Map<string, unknown> => {
      const out = new Map<string, unknown>();
      for (const [name, f] of FIELDS[section] as Map<string, FieldSpec>) {
        out.set(name, new Map<string, unknown>([["type", f.nullable ? `${f.type} | None` : f.type], ["default", typed(f, f.default)]]));
      }
      return out;
    };
    return new Map<string, unknown>([
      ["presets", Object.keys(c.PRESETS)],
      ["hairstyles", Object.keys(c.HAIRSTYLES)],
      ["bodies", Object.keys(c.BODY_TYPES)],
      ["top", describe("")],
      ["face", describe("face")],
      ["outfit", describe("outfit")],
    ]);
  }

  /** A registry default as Python's JSON writes it: an `int` field's default is an int, a `float` field's a float. */
  function typed(f: FieldSpec, value: unknown): unknown {
    if (f.type === "int" && typeof value === "number") return new c.PyInt(value);
    return value;
  }

  // She is drawn beside picture packs, and the creator's soft finish (gradients, tinted lines, tone in the hair) is what
  // closes most of the gap between a drawn figure and a painted one, so every starting character is soft. It is only a
  // starting value: `finish` and `highlight_strength` are ordinary fields she or the user can change (`[avatar finish=flat]`),
  // and a creator older than the soft finish has neither field, so then nothing is set.
  // A character with no `finish` at all (a look saved before the field existed, in the app or in a visitor's browser) has made no
  // choice, so it is drawn with the default too; one that says `flat` stays flat.
  const DEFAULT_FINISH = "soft";

  /** The creator's preset as a character, with the companion's default finish. */
  function startingLook(name: string): Map<string, unknown> {
    const character = c.paramsToJson(c.PRESETS[name]) as Map<string, unknown>;
    if (TOP.has("finish")) character.set("finish", DEFAULT_FINISH);
    return character;
  }

  function opBase(req: unknown): Map<string, unknown> {
    const name = getItem(req, "name");
    if (Array.isArray(name) || name instanceof Map) throw err("TypeError", `unhashable type: '${typeName(name)}'`);
    if (typeof name !== "string" || !own(c.PRESETS, name)) throw err("KeyError", keyRepr(name));
    return new Map([["character", startingLook(name)]]);
  }

  function opPatch(req: unknown): Map<string, unknown> {
    let character = copy(getItem(req, "character"));
    const applied: string[] = [];
    const rejected: Map<string, unknown>[] = [];
    const items = c.pyDict(getItem(req, "set"));
    const base = items.has("base") ? items.get("base") : null;
    items.delete("base");
    if (base !== null) {
      if (inTable(c.PRESETS, base)) {
        character = startingLook(base as string);
        applied.push(`base=${base as string}`);
      } else {
        rejected.push(new Map<string, unknown>([["key", "base"], ["reason", `unknown preset '${c.pyStr(base)}'`]]));
      }
    }
    for (const [key, raw] of items) {
      try {
        const [section, name] = locate(key);
        const value = coerce(name, (FIELDS[section] as Map<string, FieldSpec>).get(name) as FieldSpec, raw);
        checkAllowed(character, section, name, value);
        const target = dictFor(section ? getItem(character, section) : character, "get");
        const previous = target.has(name) ? target.get(name) : null;
        target.set(name, value);
        try {
          render(character);
        } catch (e) {
          target.set(name, previous);
          throw err("ValueError", `rendering failed (${bareText(e)})`);
        }
        applied.push(`${key as string}=${show(value)}`);
      } catch (e) {
        if (hasPyType(e) && (e.pyType === "ValueError" || e.pyType === "TypeError")) {
          rejected.push(new Map<string, unknown>([["key", typeof key === "string" ? key : keyValue(key)], ["reason", bareText(e)]]));
        } else {
          throw e;
        }
      }
    }
    return new Map<string, unknown>([["character", character], ["applied", applied], ["rejected", rejected]]);
  }

  function opFrames(req: unknown): Map<string, unknown> {
    const character = dictFor(copy(getItem(req, "character")), "setdefault");
    if (TOP.has("finish") && !character.has("finish")) character.set("finish", DEFAULT_FINISH);
    const face = dictFor(getItem(character, "face"), "update");
    const override = req instanceof Map && req.has("face") ? req.get("face") : new Map();
    for (const [k, v] of c.pyDict(override)) face.set(k, v);
    // Eyes are open in every frame but the blink, unless the request says `eyes_shut` (a happy drawn with its eyes closed). A face's own `eyes_closed` stays ignored, as recorded.
    const held = req instanceof Map && req.get("eyes_shut") === true;
    if (req instanceof Map && req.has("poses")) {
      // one frame per pose (a pose overrides top-level fields such as right_arm_out), mouth at rest
      face.set("mouth_open", first(getItem(req, "mouth")));
      face.set("eyes_closed", held);
      const out: string[] = [];
      for (const pose of iterate(req.get("poses"))) {
        const posed = new Map<unknown, unknown>(character);
        for (const [k, v] of dictFor(pose, "items")) if (typeof k === "string" && TOP.has(k)) posed.set(k, v);
        out.push(render(posed));
      }
      return new Map([["svgs", out]]);
    }
    const svgs: string[] = [];
    const mouth = getItem(req, "mouth");
    for (const open of iterate(mouth)) {
      face.set("mouth_open", open);
      face.set("eyes_closed", held);
      svgs.push(render(character));
    }
    // one extra frame for blinking: eyes shut, mouth as at rest
    face.set("mouth_open", first(getItem(req, "mouth")));
    face.set("eyes_closed", true);
    svgs.push(render(character));
    return new Map([["svgs", svgs]]);
  }

  const OPS: Record<string, (req: unknown) => Map<string, unknown>> = Object.assign(Object.create(null), {
    schema: opSchema,
    base: opBase,
    patch: opPatch,
    frames: opFrames,
  });

  /** One request in, one reply out. Never raises: a failure is a reply with ok false, so the caller stays alive. */
  function handle(requestIn: unknown): Map<string, unknown> {
    const req = normalize(requestIn);
    let reply: Map<string, unknown>;
    try {
      const op = getItem(req, "op");
      if (Array.isArray(op) || op instanceof Map) throw err("TypeError", `unhashable type: '${typeName(op)}'`);
      const run = typeof op === "string" ? OPS[op] : undefined;
      if (!run) throw err("KeyError", keyRepr(op));
      reply = new Map<string, unknown>([["ok", true], ...run(req)]);
    } catch (e) { // keep the worker alive whatever one request does
      reply = new Map<string, unknown>([["ok", false], ["error", errorText(e)]]);
    }
    reply.set("id", req instanceof Map && req.has("id") ? req.get("id") : null);
    return reply;
  }

  /** One line of JSON text in, one line out (without the newline): what the worker does for each message. */
  function handleLine(line: string): string {
    let reply: Map<string, unknown>;
    try {
      reply = handle(c.loadsText(line));
    } catch (e) {
      reply = new Map<string, unknown>([["ok", false], ["error", errorText(e)], ["id", null]]);
    }
    return c.dumps(reply);
  }

  return { handle, handleLine, DEFAULT_FINISH };
}

export type RenderOps = ReturnType<typeof createRenderOps>;
