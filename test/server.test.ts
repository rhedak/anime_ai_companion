import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { Client, cannotRunServer, startServer, type RunningServer } from "./helpers/server.ts";

// These start a throwaway copy of the whole app (its own data/, a random port) with a stand-in `claude`: no login, no real brain.
// They are the safety net for changing server.ts: what the page is told, in what order, for the things people actually do.
const skip = cannotRunServer() ?? false;

/** A new conversation, so a test does not depend on the one before it. */
async function fresh(c: Client): Promise<void> {
  const from = c.mark;
  c.say("/clear");
  await c.next("reset", 5000, from);
}

/** Says something and waits for the whole reply; returns what she said. */
async function ask(c: Client, text: string): Promise<string> {
  const from = c.mark;
  c.say(text);
  await c.done(from);
  return c.since(from).filter((e) => e.type === "delta").map((e) => e.text).join("");
}

/** Waits for something the stand-in writes to its log (it is a separate process, so the log trails the page by a moment). */
async function waitFor(condition: () => boolean, ms = 5000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > ms) throw new Error("timed out waiting for the stand-in's log");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const inputs = (server: RunningServer) => server.claudeLog().filter((e) => e.kind === "in").map((e) => e.text!);

describe("chatting", { skip }, () => {
  let server: RunningServer;
  before(async () => {
    server = await startServer({ delay: 100 });
  });
  after(async () => {
    await server?.stop();
  });

  test("a new page gets the hello, the mode and an empty history", async () => {
    const c = await server.client();
    await c.next("hello");
    assert.deepEqual((await c.next("history")).items, []);
    const mode = await c.next("mode");
    assert.equal(mode.mode, "chat");
    assert.equal(mode.provider, "claude");
    assert.equal(mode.permissionMode, "manual");
  });

  test("a message gets a reply with its tags, which is saved and shown to a page that connects later", async () => {
    const c = await server.client();
    await c.next("history");
    const said = await ask(c, "hello there");
    assert.match(said, /\[emotion:happy\] echo: hello there/);
    const late = await server.client();
    assert.deepEqual((await late.next("history")).items.map((i: any) => i.type), ["user", "bot"]);
  });

  test("only the app's own origin may connect: a website, or no origin at all, is refused", async () => {
    await assert.rejects(server.client("http://evil.example"), /socket hang up|refused/);
    await assert.rejects(server.client(null), /socket hang up|refused/);
    await assert.rejects(server.client("http://127.0.0.1:1"), /socket hang up|refused/);
  });

  test("a reply that starts without being asked (a finished helper) is shown, and the helper line follows it", async () => {
    const c = await server.client();
    await c.next("history");
    await fresh(c);
    const from = c.mark;
    c.say("SUBAGENT please");
    await c.next((e) => e.type === "auto-turn", 8000, from);
    await c.next((e) => e.type === "delta" && /The review is back/.test(e.text), 8000, from);
    await c.next((e) => e.type === "done", 8000, c.events.findIndex((e, i) => i >= from && e.type === "auto-turn"));
    const helpers = c.since(from).filter((e) => e.type === "background").map((e) => e.tasks.map((t: any) => t.description));
    assert.deepEqual(helpers, [["Review the draft"], []], "one running, then none");
    // It is saved like any reply.
    const items = (await (await server.client()).next("history")).items;
    assert.match(items.at(-1).text, /The review is back/);
  });

  test("the page is served with a strict content-security-policy and no framing", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type")!, /text\/html/);
    const csp = res.headers.get("content-security-policy")!;
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, new RegExp(`connect-src 'self' ws://127\\.0\\.0\\.1:${server.port}`));
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    const script = await fetch(`http://127.0.0.1:${server.port}/app.js`);
    assert.match(script.headers.get("content-type")!, /text\/javascript/);
    assert.ok(script.headers.get("content-security-policy"), "every file carries it, not only the page");
  });

  test("only the page's own files are served: nothing above public/, nothing unknown, and her pictures only by id", async () => {
    const base = `http://127.0.0.1:${server.port}`;
    assert.equal((await fetch(`${base}/package.json`)).status, 404, "the repository's files are not the page's files");
    assert.equal((await fetch(`${base}/src/server.ts`)).status, 404);
    assert.equal((await fetch(`${base}/nope.js`)).status, 404);
    for (const path of ["/../package.json", "/..%2f..%2fpackage.json", "/%2e%2e/package.json", "/public/../../package.json"]) {
      const res = await fetch(`${base}${path}`);
      assert.notEqual(res.status, 200, path);
      assert.doesNotMatch(await res.text(), /anime-ai-companion/, `${path} must not leak package.json`);
    }
    assert.equal((await fetch(`${base}/frames/nothing/neutral.png`)).status, 404);
    assert.equal((await fetch(`${base}/shown/00000000-0000-4000-8000-000000000000`)).status, 404);
    assert.equal((await fetch(`${base}/shown/not-an-id`)).status, 404);
    assert.equal((await fetch(`${base}/pack-thumb/nothing`)).status, 404);
  });

  test("the user's own stylesheet is an empty sheet when there is none, and their file when there is", async () => {
    const url = `http://127.0.0.1:${server.port}/custom.css`;
    const none = await fetch(url);
    assert.equal(none.status, 200);
    assert.match(none.headers.get("content-type")!, /text\/css/);
    assert.equal(await none.text(), "");
    writeFileSync(join(server.dir, "data", "custom.css"), ":root { --accent: #123456; }");
    assert.match(await (await fetch(url)).text(), /#123456/);
  });

  test("a message to a slash command that does not exist says so, and the model is not asked", async () => {
    const c = await server.client();
    await c.next("history");
    const before = inputs(server).length;
    const from = c.mark;
    c.say("/nosuchcommand");
    const notice = await c.next((e) => e.type === "notice" && /Unknown command/.test(e.text), 5000, from);
    assert.match(notice.text, /\/nosuchcommand/);
    assert.equal(inputs(server).length, before);
  });

  test("/permissions names the mode the way the documentation does: ask, not manual", async () => {
    const c = await server.client();
    await c.next("history");
    const from = c.mark;
    c.say("/permissions");
    const notice = await c.next((e) => e.type === "notice" && /^Permissions:/.test(e.text), 5000, from);
    assert.match(notice.text, /^Permissions: ask\./);
    assert.doesNotMatch(notice.text, /manual/);
  });

  test("a slash command with a picture attached still runs as a command, and says the picture was not sent", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const c = await server.client();
    await c.next("history");
    const before = inputs(server).length;
    const from = c.mark;
    c.send({ type: "user", text: "/nosuchcommand", images: [{ mediaType: "image/png", data: png }] });
    await c.next((e) => e.type === "notice" && /Unknown command/.test(e.text), 5000, from);
    await c.next((e) => e.type === "notice" && /picture was not sent/.test(e.text), 5000, from);
    assert.equal(inputs(server).length, before, "the model was not asked");
  });
});

describe("a long conversation that went cold", { skip }, () => {
  async function startCold(): Promise<RunningServer> {
    return startServer({ delay: 50, coldConversation: true });
  }

  test("the message is held back and the question asked (to every page); a second message waits for the answer; 'send' sends it", async () => {
    const server = await startCold();
    try {
      const c = await server.client();
      await c.next("history");
      const from = c.mark;
      c.say("my question after the break");
      const card = await c.next("cold-cache", 5000, from);
      assert.equal(card.tokens, "150k");
      assert.match(card.idle, /2 h|120 min/);
      assert.equal(card.text, "my question after the break");
      assert.equal(inputs(server).length, 0, "nothing was sent to the model yet");

      const other = await server.client();
      const again = await other.next("cold-cache");
      assert.equal(again.text, "my question after the break", "a page that opens now sees the question too");

      const blocked = c.mark;
      c.say("another thing");
      await c.next((e) => e.type === "notice" && /Decide what to do with your earlier message/.test(e.text), 5000, blocked);
      assert.equal(inputs(server).length, 0);

      const answered = c.mark;
      c.send({ type: "cold-reply", choice: "send" });
      await c.next((e) => e.type === "cold-resolved" && e.choice === "send", 5000, answered);
      await c.done(answered);
      assert.match(inputs(server).at(-1)!, /my question after the break/);
      assert.equal(c.since(answered).filter((e) => e.type === "user").length, 1);

      // The conversation is warm again: the next message goes straight out.
      const next = c.mark;
      c.say("and now");
      await c.done(next);
      assert.ok(!c.since(next).some((e) => e.type === "cold-cache"));
    } finally {
      await server.stop();
    }
  });

  test("'summarise' runs /compact first and sends the message after it; the summary is shown in the log", async () => {
    const server = await startCold();
    try {
      const c = await server.client();
      await c.next("history");
      const from = c.mark;
      c.say("question after summary");
      await c.next("cold-cache", 5000, from);
      c.send({ type: "cold-reply", choice: "summarise" });
      await c.next((e) => e.type === "user" && e.text === "question after summary", 15000, from);
      await waitFor(() => inputs(server).length >= 2);
      const sent = inputs(server);
      assert.equal(sent[0], "/compact", "the summary goes first, without a note in front of it");
      assert.match(sent[1], /question after summary/);
    } finally {
      await server.stop();
    }
  });

  test("'don't send' drops the message and keeps nothing waiting", async () => {
    const server = await startCold();
    try {
      const c = await server.client();
      await c.next("history");
      const from = c.mark;
      c.say("never mind this");
      await c.next("cold-cache", 5000, from);
      c.send({ type: "cold-reply", choice: "cancel" });
      await c.next((e) => e.type === "cold-resolved" && e.choice === "cancel", 5000, from);
      assert.equal(inputs(server).length, 0);
      const late = await server.client();
      await late.next("history");
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(!late.events.some((e) => e.type === "cold-cache"), "no question is left open");
    } finally {
      await server.stop();
    }
  });
});

describe("typing while she answers", { skip }, () => {
  let server: RunningServer;
  before(async () => {
    server = await startServer({ delay: 700 });
  });
  after(async () => {
    await server?.stop();
  });

  test("messages queue, go out in order one reply at a time, and one can be taken back out", async () => {
    const c = await server.client();
    await c.next("history");
    await fresh(c);
    const from = c.mark;
    c.say("A");
    await c.next((e) => e.type === "user" && e.text === "A", 5000, from);
    c.say("B");
    c.say("C");
    c.say("D");
    const queued = await c.next((e) => e.type === "queue" && e.items.length === 3, 5000, from);
    assert.deepEqual(queued.items.map((i: any) => i.text), ["B", "C", "D"]);
    c.send({ type: "unqueue", id: queued.items[1].id });
    await c.next((e) => e.type === "user" && e.text === "D", 15000, from);
    await c.done(c.events.findIndex((e, i) => i >= from && e.type === "user" && e.text === "D"), 8000);
    assert.deepEqual(c.since(from).filter((e) => e.type === "user").map((e) => e.text), ["A", "B", "D"]);
    assert.deepEqual(inputs(server).slice(-3).map((t) => t.replace(/^[^]*\n\n/, "")), ["A", "B", "D"]);
  });

  test("stopping her puts the waiting messages back in the box instead of sending them", async () => {
    const c = await server.client();
    await c.next("history");
    await fresh(c);
    const from = c.mark;
    c.say("first");
    await c.next((e) => e.type === "user", 5000, from);
    c.say("second, waiting");
    await c.next((e) => e.type === "queue" && e.items.length === 1, 5000, from);
    c.send({ type: "stop" });
    const back = await c.next((e) => e.type === "queue" && e.returned?.length > 0, 5000, from);
    assert.deepEqual(back.returned, ["second, waiting"]);
    assert.deepEqual(back.items, []);
    await c.done(from);
    assert.ok(!inputs(server).some((t) => t.includes("second, waiting")), "it was never sent");
  });
});

describe("her notes about you", { skip }, () => {
  let server: RunningServer;
  before(async () => {
    server = await startServer({ delay: 50 });
  });
  after(async () => {
    await server?.stop();
  });

  test("she asks first: nothing is saved until the user keeps it, then it is told to her in the next conversation, and forgetting removes it", async () => {
    const c = await server.client();
    await c.next("history");
    const from = c.mark;
    c.say("REMEMBER the cat");
    const offer = await c.next("memory-offer", 8000, from);
    assert.equal(offer.fact, "Their cat is called Momo");
    assert.ok(!(server.data("memory.md") ?? "").includes("Momo"), "asking is not saving");
    c.send({ type: "memory-reply", id: offer.id, choice: "keep" });
    const kept = await c.next("memory-resolved", 5000, from);
    assert.equal(kept.choice, "keep");
    assert.match(server.data("memory.md") ?? "", /^- Their cat is called Momo$/m);
    await ask(c, "what do your notes say");
    assert.match(inputs(server).at(-1)!, /Added to the user's notes[^]*- Their cat is called Momo/, "she is told it was kept");

    await fresh(c);
    await ask(c, "hello again");
    const last = inputs(server).at(-1)!;
    assert.match(last, /Notes the user keeps about themselves/);
    assert.match(last, /- Their cat is called Momo/);
    assert.match(last, /\[remember </, "and how to add one");

    const gone = c.mark;
    c.say("/memory forget 1");
    await c.next((e) => e.type === "notice" && /Forgotten/.test(e.text), 5000, gone);
    assert.doesNotMatch(server.data("memory.md") ?? "", /Momo/);
  });

  test("a note the user turns down is not saved and not offered again in that conversation, only in a new one", async () => {
    const c = await server.client();
    await c.next("history");
    await fresh(c);
    let from = c.mark;
    c.say("REMEMBER the cat");
    const offer = await c.next("memory-offer", 8000, from);
    c.send({ type: "memory-reply", id: offer.id, choice: "skip" });
    assert.equal((await c.next("memory-resolved", 5000, from)).choice, "skip");
    assert.ok(!(server.data("memory.md") ?? "").includes("Momo"));

    from = c.mark;
    await ask(c, "REMEMBER the cat again");
    assert.equal(c.since(from).filter((e) => e.type === "memory-offer").length, 0, "she does not ask the same thing twice");
    assert.match(inputs(server).at(-1)!, /NOT saved: the user declined "Their cat is called Momo"/, "she is told it was not kept");
    await ask(c, "and another thing");
    assert.doesNotMatch(inputs(server).at(-1)!, /NOT saved/, "once, not on every message");

    await fresh(c);
    from = c.mark;
    c.say("REMEMBER the cat");
    await c.next("memory-offer", 8000, from);
    c.say("/clear"); // leave nothing pending for the next test
    await c.next((e) => e.type === "memory-resolved", 5000, from);
  });

  test("a note still waiting for an answer is reported to her once as not saved, so she does not say she saved it", async () => {
    const c = await server.client();
    await c.next("history");
    await fresh(c);
    const from = c.mark;
    c.say("REMEMBER the cat");
    await c.next("memory-offer", 8000, from);
    await ask(c, "did you save that?");
    assert.match(inputs(server).at(-1)!, /not saved yet: "Their cat is called Momo"[^]*do not tell them you saved it/);
    await ask(c, "and now?");
    assert.doesNotMatch(inputs(server).at(-1)!, /not saved yet/, "once, not on every message");
    await fresh(c);
  });

  test("a card that waits is shown again to a page that reloads, and answering a stale one does nothing", async () => {
    const c = await server.client();
    await c.next("history");
    await fresh(c);
    const from = c.mark;
    c.say("REMEMBER the cat");
    const offer = await c.next("memory-offer", 8000, from);
    const again = await server.client();
    const shown = await again.next("memory-offer", 5000);
    assert.equal(shown.id, offer.id);
    assert.equal(shown.fact, offer.fact);
    c.send({ type: "memory-reply", id: "not-an-offer", choice: "keep" });
    c.send({ type: "memory-reply", id: offer.id, choice: "maybe" });
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(!(server.data("memory.md") ?? "").includes("Momo"));
    again.close();
    await fresh(c);
  });

  test("with asking turned off she saves it by herself and shows an Undo that takes it out again; the choice is kept", async () => {
    const c = await server.client();
    await c.next("history");
    await fresh(c);
    let from = c.mark;
    c.say("/memory auto");
    await c.next((e) => e.type === "notice" && /by herself/.test(e.text), 5000, from);
    assert.equal(JSON.parse(server.data("settings.json") ?? "{}").memorySaving, "auto");

    from = c.mark;
    c.say("REMEMBER the cat");
    const saved = await c.next("memory-saved", 8000, from);
    assert.equal(saved.fact, "Their cat is called Momo");
    assert.match(saved.text, /Remembered/);
    assert.match(server.data("memory.md") ?? "", /Momo/);
    assert.equal(c.since(from).filter((e) => e.type === "memory-offer").length, 0);

    await ask(c, "and now?");
    assert.match(inputs(server).at(-1)!, /Added to the user's notes[^]*Momo/, "she is told it was saved");
    c.send({ type: "memory-undo", fact: saved.fact });
    await c.next((e) => e.type === "notice" && /Forgotten/.test(e.text), 5000, from);
    assert.doesNotMatch(server.data("memory.md") ?? "", /Momo/);
    await ask(c, "after the undo");
    assert.match(inputs(server).at(-1)!, /Removed from the user's notes[^]*Momo/, "she is told it is gone");

    c.say("/memory ask");
    await c.next((e) => e.type === "notice" && /ask before/.test(e.text), 5000, c.mark);
    assert.equal(JSON.parse(server.data("settings.json") ?? "{}").memorySaving, "ask");
  });

  test("with notes switched off nothing is offered or saved, and she is told", async () => {
    const c = await server.client();
    await c.next("history");
    await fresh(c);
    await ask(c, "settle");
    c.say("/memory off");
    await c.next((e) => e.type === "notice" && /not save notes/.test(e.text), 5000, c.mark);
    const from = c.mark;
    await ask(c, "REMEMBER the cat");
    assert.match(inputs(server).slice(-1)[0], /switched off saving notes/);
    assert.ok(c.since(from).some((e) => e.type === "notice" && /Saving notes is switched off/.test(e.text)), "the user is told why she did not save it");
    assert.equal(c.since(from).filter((e) => e.type === "memory-offer" || e.type === "memory-saved").length, 0);
    assert.ok(!(server.data("memory.md") ?? "").includes("Momo"));

    await fresh(c);
    await ask(c, "hello");
    assert.match(inputs(server).at(-1)!, /switched off saving notes/, "a new conversation hears it from the start");
    c.say("/memory ask");
    await c.next((e) => e.type === "notice" && /ask before/.test(e.text), 5000, c.mark);
  });

  test("an edit by hand is picked up with her next message, as a change", async () => {
    const c = await server.client();
    await c.next("history");
    await ask(c, "settle");
    writeFileSync(join(server.dir, "data", "memory.md"), "- Lives in Berlin\n");
    await ask(c, "after the edit");
    const last = inputs(server).at(-1)!;
    assert.match(last, /Added to the user's notes[^]*- Lives in Berlin/);
  });
});

describe("character cards", { skip }, () => {
  let server: RunningServer;
  let file: string;
  before(async () => {
    server = await startServer({ delay: 50 });
    file = join(server.dir, "card.json");
    writeFileSync(
      file,
      JSON.stringify({
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
          name: "Aiko",
          description: "{{char}} is a shy bookworm.",
          personality: "shy",
          scenario: "a library",
          mes_example: "",
          first_mes: "Hello {{user}}, I'm {{char}}!",
          system_prompt: "ALWAYS-END-WITH-MEOW",
          creator_notes: "Keep replies short.",
          character_book: { entries: [{ keys: ["library"], content: "The library has a cat called Pip." }] },
        },
      }),
    );
  });
  after(async () => {
    await server?.stop();
  });

  test("a card is previewed with its choices; nothing changes until it is applied; the orders are off by default", async () => {
    const c = await server.client();
    await c.next("history");
    const from = c.mark;
    c.say(`/card import ${file}`);
    const offer = await c.next("card-offer", 5000, from);
    assert.equal(offer.name, "Aiko");
    assert.deepEqual(offer.options.map((o: any) => [o.id, o.on]), [["greeting", true], ["lore", true], ["orders", false]]);
    assert.match(offer.options[2].detail, /STRONG WARNING/);
    assert.match(offer.notes, /Keep replies short/);
    assert.equal(server.data("character.json"), null, "nothing is saved before the user agrees");
    c.send({ type: "card-reply", choice: "cancel" });
    await c.next("card-resolved", 5000, from);
    assert.equal(server.data("character.json"), null);
  });

  test("applied with her greeting and the lorebook: new chats open with the greeting, lore arrives once, the orders stay out", async () => {
    const c = await server.client();
    await c.next("history");
    const imported = c.mark;
    c.say(`/card import ${file}`);
    await c.next("card-offer", 5000, imported);
    c.send({ type: "card-reply", choice: "apply", use: { greeting: true, lore: true, orders: false } });
    await c.next((e) => e.type === "notice" && /character now comes from the card/.test(e.text), 5000, imported);
    assert.equal(JSON.parse(server.data("character.json")!).use.orders, false);
    assert.equal((await c.next((e) => e.type === "mode" && e.name === "Aiko", 5000, imported)).name, "Aiko");

    const from = c.mark;
    c.say("/clear");
    const greeting = await c.next((e) => e.type === "delta", 5000, from);
    assert.equal(greeting.text, "[emotion:happy] Hello you, I'm Aiko!");

    await ask(c, "tell me about the library");
    assert.match(inputs(server).at(-1)!, /cat called Pip/);
    assert.match(inputs(server).at(-1)!, /you opened this conversation by saying/);
    await ask(c, "the library again");
    assert.doesNotMatch(inputs(server).at(-1)!, /Pip/, "each entry goes out once per conversation");

    assert.match(server.systemPrompt(), /shy bookworm/);
    assert.doesNotMatch(server.systemPrompt(), /ALWAYS-END-WITH-MEOW/);
    assert.match(server.systemPrompt(), /Expression protocol \(important\):/);
  });

  test("with the author's own instructions chosen they are in her prompt, before the protocol; resetting brings persona.md back", async () => {
    const c = await server.client();
    await c.next("history");
    const from = c.mark;
    c.say(`/card import ${file}`);
    await c.next("card-offer", 5000, from);
    c.send({ type: "card-reply", choice: "apply", use: { greeting: false, lore: false, orders: true } });
    await c.next((e) => e.type === "card-resolved" && e.choice === "apply", 5000, from);
    await fresh(c);
    await ask(c, "hi");
    const prompt = server.systemPrompt();
    assert.match(prompt, /ALWAYS-END-WITH-MEOW/);
    assert.ok(prompt.indexOf("ALWAYS-END-WITH-MEOW") < prompt.indexOf("Expression protocol (important):"), "the protocol still comes last");

    const reset = c.mark;
    c.say("/card reset");
    await c.next((e) => e.type === "notice" && /back to the character in persona\.md/.test(e.text), 5000, reset);
    assert.equal(server.data("character.json"), null);
    await fresh(c);
    await ask(c, "hi again");
    assert.doesNotMatch(server.systemPrompt(), /shy bookworm|ALWAYS-END/);
  });

  test("a file that is not a card is refused with a reason", async () => {
    const c = await server.client();
    await c.next("history");
    const from = c.mark;
    c.say(`/card import ${join(server.dir, "persona.md")}`); // text, not JSON
    const notice = await c.next((e) => e.type === "notice" && /not a character card/.test(e.text), 5000, from);
    assert.ok(notice);
    assert.equal(server.data("character.json"), null);
  });
});

describe("work mode", { skip }, () => {
  let server: RunningServer;
  before(async () => {
    server = await startServer({ delay: 50, userSkills: ["pinecone"] });
    mkdirSync(join(server.project, ".claude", "skills", "local"), { recursive: true });
    writeFileSync(join(server.project, ".claude", "skills", "local", "SKILL.md"), "---\nname: local\n---\n");
  });
  after(async () => {
    await server?.stop();
  });

  async function enterWork(c: Client): Promise<number> {
    const from = c.mark;
    c.send({ type: "mode", mode: "work", projectDir: server.project });
    await c.next((e) => e.type === "mode" && e.mode === "work", 8000, from);
    return from;
  }

  test("a folder with its own skills says they stay off, and offers the user's own", async () => {
    const c = await server.client();
    await c.next("history");
    const from = await enterWork(c);
    const notice = await c.next((e) => e.type === "notice" && /This folder has 1 skill/.test(e.text), 5000, from);
    assert.match(notice.text, /\/setup on/);
    assert.match(notice.text, /You have 1 skill in ~\/\.claude\/skills[^]*\/skills on/);
  });

  test("when she reaches for a skill that is not loaded the user is asked once, and 'load' restarts her with their skills and no hooks", async () => {
    const c = await server.client();
    await c.next("history");
    await enterWork(c);
    await fresh(c);
    const from = c.mark;
    c.say("TOOLFAIL please");
    const offer = await c.next("skills-offer", 8000, from);
    assert.ok(offer);
    await c.done(from);
    c.send({ type: "skills-reply", choice: "load" });
    await c.next("skills-resolved", 5000, from);
    await c.next((e) => e.type === "mode" && e.claudeSkills === true, 5000, from);
    await ask(c, "again");
    const args = server.claudeLog().filter((e) => e.kind === "argv").at(-1)!.args!;
    assert.equal(args[args.indexOf("--setting-sources") + 1], "user");
    assert.equal(args[args.indexOf("--settings") + 1], '{"disableAllHooks":true}');
    const asked = c.since(from).filter((e) => e.type === "skills-offer").length;
    assert.equal(asked, 1, "asked once, not on every failure");
  });

  test("she cannot save a note in work mode, and the user can add one by hand", async () => {
    const c = await server.client();
    await c.next("history");
    await enterWork(c);
    await fresh(c);
    const from = c.mark;
    c.say("REMEMBER the cat");
    const notice = await c.next((e) => e.type === "notice" && /not saved in work mode/.test(e.text), 8000, from);
    assert.match(notice.text, /\/memory add/);
    assert.ok(!(server.data("memory.md") ?? "").includes("Momo"));
    c.say("/memory add Likes green tea");
    await c.next((e) => e.type === "notice" && /Noted/.test(e.text), 5000, from);
    assert.match(server.data("memory.md") ?? "", /Likes green tea/);
  });

  test("asked to remember something in work mode, the user is told once that notes are chat only and not Claude's memory, and she is told to say so", async () => {
    const c = await server.client();
    await c.next("history");
    await enterWork(c);
    await fresh(c);
    let from = c.mark;
    await ask(c, "you might want to remember that I like pink");
    const told = c.since(from).filter((e) => e.type === "notice" && /chat mode only/.test(e.text));
    assert.equal(told.length, 1);
    assert.match(told[0].text, /\/memory add/);
    assert.match(told[0].text, /not Claude's memory feature/);
    assert.match(inputs(server).at(-1)!, /cannot save notes in work mode[^]*do not promise to remember/);

    from = c.mark;
    await ask(c, "please remember my cat too");
    assert.equal(c.since(from).filter((e) => e.type === "notice" && /chat mode only/.test(e.text)).length, 0, "said once per conversation");
    assert.match(inputs(server).at(-1)!, /do not promise to remember/, "but she is told every time");

    // The two reasons are told separately: switching notes off in the same conversation gets its own notice.
    c.say("/chat");
    await c.next("mode", 5000, c.mark);
    c.say("/memory off");
    await c.next((e) => e.type === "notice" && /not save notes/.test(e.text), 5000, c.mark);
    from = c.mark;
    await ask(c, "please remember my dog too");
    assert.equal(c.since(from).filter((e) => e.type === "notice" && /Saving notes is switched off/.test(e.text)).length, 1);
    c.say("/memory ask");
    await c.next((e) => e.type === "notice" && /ask before/.test(e.text), 5000, c.mark);

    from = c.mark;
    await ask(c, "remember to run the tests");
    assert.equal(c.since(from).filter((e) => e.type === "notice" && /chat mode only/.test(e.text)).length, 0);
    assert.doesNotMatch(inputs(server).at(-1)!, /do not promise to remember/, "a code task is not a request for a note");
  });

  test("!command runs in the project folder, without a card, and shows its output", async () => {
    const c = await server.client();
    await c.next("history");
    await enterWork(c);
    const from = c.mark;
    c.say("!echo from-the-shell");
    const started = await c.next("shell", 5000, from);
    assert.equal(started.command, "echo from-the-shell");
    const done = await c.next("shell-done", 8000, from);
    assert.match(done.output, /from-the-shell/);
    assert.equal(done.code, 0);
  });

  test("the loose permission modes are refused for a brain that does not have them, and Ask stays the default", async () => {
    const c = await server.client();
    await c.next("history");
    await enterWork(c);
    const from = c.mark;
    c.send({ type: "permission-mode", value: "everything" });
    const notice = await c.next((e) => e.type === "notice" && /Run everything is a Cursor or opencode mode/.test(e.text), 5000, from);
    assert.ok(notice);
    const mode = [...c.events].reverse().find((e) => e.type === "mode")!;
    assert.equal(mode.permissionMode, "manual");
  });
});

describe("the shell opt-out", { skip }, () => {
  let server: RunningServer;
  before(async () => {
    server = await startServer({ delay: 50, env: { COMPANION_NO_SHELL: "1" } });
  });
  after(async () => {
    await server?.stop();
  });

  test("COMPANION_NO_SHELL refuses !command and tells the page", async () => {
    const c = await server.client();
    await c.next("history");
    const from = c.mark;
    c.send({ type: "mode", mode: "work", projectDir: server.project });
    const mode = await c.next((e) => e.type === "mode" && e.mode === "work", 8000, from);
    assert.equal(mode.shellOff, true);
    c.say("!echo should-not-run");
    const notice = await c.next((e) => e.type === "notice" && /turned off on this server/.test(e.text), 5000, from);
    assert.ok(notice);
    assert.ok(!c.since(from).some((e) => e.type === "shell"), "nothing ran");
  });
});

describe("a local model with tools (Ollama)", { skip }, () => {
  let server: RunningServer;
  let fake: ReturnType<typeof createServer>;
  const chats: any[] = [];
  before(async () => {
    fake = createServer(async (req: IncomingMessage, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/api/tags") return void res.end(JSON.stringify({ models: [{ name: "qwen3-coder:30b" }, { name: "llama2:7b" }] }));
      if (req.url === "/api/show") return void res.end(JSON.stringify({ capabilities: body.model.startsWith("qwen3") ? ["completion", "tools", "vision"] : ["completion"] }));
      chats.push(body);
      const last = body.messages.at(-1);
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      const line = (m: object) => res.write(JSON.stringify({ message: { role: "assistant", content: "", ...m }, done: false }) + "\n");
      if (last.role === "user" && body.tools && /read/.test(last.content)) line({ tool_calls: [{ function: { name: "read_file", arguments: { path: "notes.txt" } } }] });
      else if (last.role === "user" && body.tools && /run/.test(last.content)) line({ tool_calls: [{ function: { name: "bash", arguments: { command: "echo made > made.txt" } } }] });
      else if (last.role === "tool") line({ content: "[emotion:happy] Done: " + String(last.content).trim().slice(0, 30) });
      else line({ content: "[emotion:happy] hello" });
      res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    server = await startServer({ delay: 50, env: { OLLAMA_HOST: `http://127.0.0.1:${(fake.address() as AddressInfo).port}` } });
    writeFileSync(join(server.project, "notes.txt"), "the answer is 42\n");
  });
  after(async () => {
    await server?.stop();
    fake?.close();
  });

  test("work mode is offered only for a model that reports tools; reads run, a command waits for the card", async () => {
    const c = await server.client();
    await c.next("history");

    // A model without tools: no work mode.
    let from = c.mark;
    c.send({ type: "provider", provider: "ollama", model: "llama2:7b" });
    await c.next((e) => e.type === "mode" && e.provider === "ollama", 8000, from);
    from = c.mark;
    c.send({ type: "mode", mode: "work", projectDir: server.project });
    const refused = await c.next((e) => e.type === "notice" && /does not report that llama2:7b can use tools/.test(e.text), 8000, from);
    assert.match(refused.text, /COMPANION_OLLAMA_TOOLS/);

    // One with tools: work mode, with the warning, and a menu of Ask and Plan only.
    from = c.mark;
    c.send({ type: "provider", provider: "ollama", model: "qwen3-coder:30b" });
    await c.next((e) => e.type === "mode" && e.canUseTools === true, 8000, from);
    from = c.mark;
    c.send({ type: "mode", mode: "work", projectDir: server.project });
    const warning = await c.next((e) => e.type === "notice" && /Work mode with a local model is experimental/.test(e.text), 8000, from);
    assert.match(warning.text, /you are responsible for the result/);
    c.send({ type: "permission-mode", value: "auto" });
    await c.next((e) => e.type === "notice" && /A local model here has Ask and Plan/.test(e.text), 5000, from);

    // A read needs no card.
    from = c.mark;
    c.say("please read the notes");
    await c.done(from);
    assert.ok(c.since(from).some((e) => e.type === "tool" && e.name === "Read" && e.status === "done"));
    assert.ok(!c.since(from).some((e) => e.type === "permission"));

    // A command waits for the user, and does not run until they allow it.
    from = c.mark;
    c.say("please run it");
    const card = await c.next("permission", 8000, from);
    assert.equal(card.request.tool, "Bash");
    assert.deepEqual(card.request.input, { command: "echo made > made.txt" });
    assert.equal(existsSync(join(server.project, "made.txt")), false, "not before the user says yes");
    c.send({ type: "permission-reply", id: card.request.id, decision: "allow" });
    await c.done(from);
    assert.equal(readFileSync(join(server.project, "made.txt"), "utf8").trim(), "made");
  });
  test("a model Ollama says cannot see pictures turns the attach button off, and one that can does not", async () => {
    const c = await server.client();
    await c.next("history");
    let from = c.mark;
    c.send({ type: "provider", provider: "ollama", model: "llama2:7b" });
    const blind = await c.next((e) => e.type === "mode" && e.provider === "ollama" && e.cannotSeePictures === true, 8000, from);
    assert.equal(blind.ollamaModel, "llama2:7b");
    from = c.mark;
    c.send({ type: "provider", provider: "ollama", model: "qwen3-coder:30b" });
    await c.next((e) => e.type === "mode" && e.canUseTools === true, 8000, from);
    await new Promise((r) => setTimeout(r, 400)); // the vision answer comes with the tools one
    const last = c.since(from).filter((e) => e.type === "mode").at(-1)!;
    assert.equal(last.cannotSeePictures, false);
  });

  test("switching from a model with tools to one without never announces tools for the new model", async () => {
    const c = await server.client();
    await c.next("history");
    let from = c.mark;
    c.send({ type: "provider", provider: "ollama", model: "qwen3-coder:30b" });
    await c.next((e) => e.type === "mode" && e.canUseTools === true, 8000, from);
    await new Promise((r) => setTimeout(r, 300));
    from = c.mark;
    c.send({ type: "provider", provider: "ollama", model: "llama2:7b" });
    await new Promise((r) => setTimeout(r, 800));
    const modes = c.since(from).filter((e) => e.type === "mode");
    assert.ok(modes.length > 0);
    for (const m of modes) {
      assert.ok(!(m.ollamaModel === "llama2:7b" && m.canUseTools === true), `tools announced for llama2: ${JSON.stringify({ model: m.ollamaModel, tools: m.canUseTools })}`);
      assert.ok(!(m.ollamaModel === "qwen3-coder:30b" && m.provider === "ollama" && m.canUseTools === false), "the old model was reported as having lost its tools");
    }
    assert.equal(modes.at(-1).canUseTools, false, "the settled state: no tools for llama2");
  });

  test("the experimental warning is said once on entering work mode, not again when the folder is set", async () => {
    const c = await server.client();
    await c.next("history");
    let from = c.mark;
    c.send({ type: "provider", provider: "ollama", model: "qwen3-coder:30b" });
    await c.next((e) => e.type === "mode" && e.canUseTools === true, 8000, from);
    c.send({ type: "mode", mode: "chat" });
    await c.next((e) => e.type === "mode" && e.mode === "chat", 5000, from);
    from = c.mark;
    c.send({ type: "mode", mode: "work", projectDir: server.project });
    await c.next((e) => e.type === "notice" && /experimental/.test(e.text), 8000, from);
    c.send({ type: "mode", mode: "work", projectDir: server.project }); // the page sends it again when the folder is chosen
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(c.since(from).filter((e) => e.type === "notice" && /experimental/.test(e.text)).length, 1);
  });
});

describe("starting with Ollama as the brain and no model named", { skip }, () => {
  let fake: ReturnType<typeof createServer>;
  const chats: any[] = [];
  let installed: { name: string }[] = [{ name: "qwen2.5:0.5b" }, { name: "llama3.2:3b" }];
  before(async () => {
    fake = createServer(async (req: IncomingMessage, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/api/tags") return void res.end(JSON.stringify({ models: installed }));
      if (req.url === "/api/show") return void res.end(JSON.stringify({ capabilities: ["completion"] }));
      chats.push(body);
      if (!body.model) {
        res.writeHead(400);
        return void res.end(JSON.stringify({ error: "model is required" }));
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(JSON.stringify({ message: { role: "assistant", content: "[emotion:happy] hello" }, done: false }) + "\n");
      res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  });
  after(() => fake?.close());
  const host = () => `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  test("the first installed model is used, as the documentation says, without being saved as the user's choice", async () => {
    installed = [{ name: "qwen2.5:0.5b" }, { name: "llama3.2:3b" }];
    chats.length = 0;
    const server = await startServer({ settings: { provider: "ollama" }, env: { OLLAMA_HOST: host() } });
    try {
      const c = await server.client();
      const mode = await c.next((e) => e.type === "mode" && e.provider === "ollama");
      assert.equal(mode.ollamaModel, "qwen2.5:0.5b");
      const from = c.mark;
      c.say("hello there");
      await c.done(from);
      assert.equal(chats.length, 1);
      assert.equal(chats[0].model, "qwen2.5:0.5b", "the model was named in the request");
      assert.ok(!c.since(from).some((e) => e.type === "error"));
      assert.equal(JSON.parse(readFileSync(join(server.dir, "data", "settings.json"), "utf8")).ollamaModel ?? null, null, "a default, not a choice");
    } finally {
      await server.stop();
    }
  });

  test("with no model installed a message is not sent and not kept, and she says what to do", async () => {
    installed = [];
    chats.length = 0;
    const server = await startServer({ settings: { provider: "ollama" }, env: { OLLAMA_HOST: host() } });
    try {
      const c = await server.client();
      await c.next("history");
      for (let i = 0; i < 2; i++) {
        const from = c.mark;
        c.say("hello?");
        const notice = await c.next((e) => e.type === "notice" && /Ollama has no models yet/.test(e.text), 5000, from);
        assert.match(notice.text, /ollama pull llama3\.2/);
        assert.ok(!c.since(from).some((e) => e.type === "user"), "the message is not shown as sent");
      }
      assert.equal(chats.length, 0, "Ollama was never asked");
      const again = await server.client();
      const history = await again.next("history");
      assert.equal(history.items.filter((i: any) => i.type === "user").length, 0, "nothing was saved");
    } finally {
      await server.stop();
    }
  });
});

describe("Ollama answering the tool check before the server is ready", { skip }, () => {
  test("the server still comes up when /api/show is answered long before /api/tags", async () => {
    // The tool check starts at the top of server.ts and its callback broadcasts to the page, which
    // only exists further down. A slow model list makes the check come back first.
    const fake = createServer(async (req: IncomingMessage, res) => {
      for await (const _ of req) void _;
      if (req.url === "/api/tags") await new Promise((r) => setTimeout(r, 600));
      if (req.url === "/api/tags") return void res.end(JSON.stringify({ models: [{ name: "qwen2.5:3b" }] }));
      if (req.url === "/api/show") return void res.end(JSON.stringify({ capabilities: ["completion", "tools"] }));
      res.writeHead(404);
      res.end("{}");
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    const host = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    try {
      const server = await startServer({ settings: { provider: "ollama", ollamaModel: "qwen2.5:3b" }, env: { OLLAMA_HOST: host } });
      try {
        const c = await server.client();
        const mode = await c.next((e) => e.type === "mode" && e.provider === "ollama");
        assert.equal(mode.ollamaModel, "qwen2.5:3b");
      } finally {
        await server.stop();
      }
    } finally {
      fake.close();
    }
  });
});

describe("switching to a brain whose program is missing", { skip }, () => {
  test("she stays on the current brain and is told, for every command-line brain", async () => {
    const server = await startServer({ env: { CURSOR_AGENT: "/nonexistent/cursor-agent", OPENCODE_BIN: "/nonexistent/opencode" } });
    try {
      const c = await server.client();
      await c.next("mode");
      for (const [brain, program] of [["cursor", "cursor-agent"], ["opencode", "opencode"]]) {
        const from = c.mark;
        c.send({ type: "provider", provider: brain });
        const notice = await c.next((e) => e.type === "notice" && e.text.includes(program), 5000, from);
        assert.match(notice.text, /not installed or not on PATH, so she stays on claude/);
        assert.ok(!c.since(from).some((e) => e.type === "reset"), "no new conversation");
      }
      assert.equal(JSON.parse(server.data("settings.json") ?? "{}").provider, "claude");
    } finally {
      await server.stop();
    }
  });
});
