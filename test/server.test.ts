import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { OPENCODE_PIN, opencodeAsset } from "../src/install-opencode.ts";
import { Client, cannotRunServer, startServer, type RunningServer } from "./helpers/server.ts";
import { pathOf, systemPathDirs } from "./helpers/standin.ts";

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

/** A skip that is about the platform, not a missing piece: check.sh does not count it as something left untested. */
const platformSkip = () => (opencodeAsset() === null ? "the opencode one-click install exists for Windows only so far (platform only)" : false);
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

  test("with a picture pack on she is told what the pictures show, and sees her resting picture once; a new chat tells her again", async () => {
    const pack = join(server.dir, "data", "frames", "tester");
    mkdirSync(pack, { recursive: true });
    writeFileSync(join(pack, "neutral.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    writeFileSync(join(pack, "look.txt"), "Short silver hair and a green sleeveless dress.\n");
    const c = await server.client();
    await c.next("history");
    c.send({ type: "user", text: "/frames tester" });
    const shown = await c.next((e) => e.type === "notice", 8000);
    assert.match(shown.text, /Showing the pack "tester"/);
    await ask(c, "how do you look?");
    const first = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(first.text!, /fixed set of pictures/);
    assert.match(first.text!, /green sleeveless dress/, "the pack's look.txt reaches her");
    assert.equal(first.images, 1, "the resting picture rides on that first message");
    await ask(c, "and now?");
    const second = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.doesNotMatch(second.text!, /green sleeveless dress/);
    assert.equal(second.images, 0, "only once");
    c.send({ type: "reset" });
    await c.next("reset");
    await ask(c, "again");
    const fresh = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(fresh.text!, /green sleeveless dress/, "a new conversation does not know her look either");
    assert.equal(fresh.images, 1);
    c.send({ type: "user", text: "/frames off" });
    await c.next((e) => e.type === "notice" && /drawn avatar/.test(e.text), 8000);
  });

  test("the packs message says which character each pack belongs to, so the gallery can group outfits", async () => {
    const frames = join(server.dir, "data", "frames");
    mkdirSync(join(frames, "characters"), { recursive: true });
    writeFileSync(join(frames, "characters", "ann.txt"), "Ann\nA tall young woman with short red hair.\n");
    const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    for (const pack of ["ann-coat", "ann-swim", "solo"]) {
      mkdirSync(join(frames, pack), { recursive: true });
      writeFileSync(join(frames, pack, "neutral.png"), tiny);
    }
    writeFileSync(join(frames, "ann-coat", "look.txt"), "character: ann\nYou wear a coat.\n");
    writeFileSync(join(frames, "ann-swim", "look.txt"), "character: ann\nYou wear a swimsuit.\n");
    const c = await server.client();
    await c.next("history");
    c.send({ type: "pack-catalog" });
    const packs = await c.next((e) => e.type === "packs" && e.names.includes("ann-coat"), 8000);
    assert.deepEqual(packs.characters, { "ann-coat": { id: "ann", name: "Ann" }, "ann-swim": { id: "ann", name: "Ann" } });
    assert.ok(!packs.names.includes("characters"), "the characters folder is not a pack");
  });

  test("she can change into another outfit of her character with [outfit name]; an outfit that is not there changes nothing", async () => {
    const frames = join(server.dir, "data", "frames");
    mkdirSync(join(frames, "characters"), { recursive: true });
    writeFileSync(join(frames, "characters", "ann.txt"), "Ann\nA tall young woman with short red hair.\n");
    const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    for (const [pack, wear] of [["ann-coat", "You wear a coat."], ["ann-swim", "You wear a swimsuit."]]) {
      mkdirSync(join(frames, pack), { recursive: true });
      writeFileSync(join(frames, pack, "neutral.png"), tiny);
      writeFileSync(join(frames, pack, "look.txt"), `character: ann\n${wear}\n`);
    }
    const c = await server.client();
    await c.next("history");
    c.send({ type: "user", text: "/frames ann-coat" });
    await c.next((e) => e.type === "notice" && /Showing the pack "ann-coat"/.test(e.text), 8000);
    await ask(c, "hello");
    const told = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(told.text!, /\[outfit <name>\]/);
    assert.match(told.text!, /coat \(you wear this now\), swim/, "she is told which outfits she has");

    // she changes: the page is told the new pack, and she is told what she wears now
    const from = c.mark;
    await ask(c, "please OUTFIT swim");
    const packMsg = await c.next((e) => e.type === "pack" && e.pack?.name === "ann-swim", 8000, from);
    assert.equal(packMsg.pack.name, "ann-swim");
    assert.equal(packMsg.pack.character, "ann", "the page can tell an outfit change from a change of character");
    await ask(c, "and now?");
    const after = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(after.text!, /You wear a swimsuit/, "the new outfit's description reaches her");
    assert.equal(JSON.parse(server.data("settings.json")!).framePack, "ann-swim");

    // an outfit she does not have: nothing changes, and she is told her outfits
    await ask(c, "please OUTFIT tuxedo");
    await new Promise((r) => setTimeout(r, 300));
    await ask(c, "again");
    const nope = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(nope.text!, /no outfit called "tuxedo"/);
    assert.equal(JSON.parse(server.data("settings.json")!).framePack, "ann-swim");
    // a manual switch to another outfit of the same character says only the change; the credit and terms were said at the first one
    const manual = c.mark;
    c.send({ type: "user", text: "/frames ann-coat" });
    const again = await c.next((e) => e.type === "notice" && /Showing the pack "ann-coat"/.test(e.text), 8000, manual);
    assert.equal(again.text, 'Showing the pack "ann-coat".');
    c.send({ type: "user", text: "/frames off" });
    await c.next((e) => e.type === "notice" && /drawn avatar/.test(e.text), 8000);
  });

  test("the page names its icon, and the server serves it as a PNG (no 404 for a favicon)", async () => {
    const html = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
    assert.match(html, /rel="icon"[^>]*href="favicon\.png"/);
    const icon = await fetch(`http://127.0.0.1:${server.port}/favicon.png`);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get("content-type"), "image/png");
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/favicon.ico`)).status, 200, "browsers that ask for /favicon.ico get the picture, not a 404");
  });

  test("Reset look only restores the look: the conversation stays, and she is told on her next message", async () => {
    const c = await server.client();
    await c.next("history");
    await fresh(c);
    await ask(c, "before the reset");
    const from = c.mark;
    c.send({ type: "reset-look" });
    const change = await c.next((e) => e.type === "avatar" && e.applied?.[0] === "back to the original look", 5000, from);
    assert.equal(change.applied[0], "back to the original look");
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!c.since(from).some((e) => e.type === "reset"), "the chat was not cleared");
    const late = await server.client();
    const kinds = (await late.next("history")).items.map((i: any) => i.type);
    assert.deepEqual(kinds.slice(0, 2), ["user", "bot"], "what was said is still there");
    await ask(c, "after the reset");
    await waitFor(() => inputs(server).some((t) => /after the reset/.test(t)));
    assert.match(inputs(server).at(-1)!, /reset your look/i, "she is told, as for any look change from the menu");
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

  test("a note written as [remember]…[/remember] by a small model is offered like the exact tag", async () => {
    const c = await server.client();
    await c.next("history");
    const from = c.mark;
    c.say("LOOSEREMEMBER the cat");
    const offer = await c.next("memory-offer", 8000, from);
    assert.equal(offer.fact, "Their cat is called Momo");
    c.send({ type: "memory-reply", id: offer.id, choice: "skip" });
    await c.next("memory-resolved", 5000, from);
    assert.ok(!(server.data("memory.md") ?? "").includes("Momo"), "declined: nothing saved");
    await fresh(c); // a declined note is not offered again in that conversation: leave it so the next test starts clean
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
      if (req.url === "/api/tags") return void res.end(JSON.stringify({ models: [{ name: "qwen3-coder:30b" }, { name: "qwen3-small:3b" }, { name: "llama2:7b" }] }));
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
    assert.equal(modes.at(-1)!.canUseTools, false, "the settled state: no tools for llama2");
  });

  test("switching between two models that both take tools: a page is never told the old answer for the new model, and hears the new answer first", async () => {
    const c = await server.client();
    await c.next("history");
    let from = c.mark;
    c.send({ type: "provider", provider: "ollama", model: "qwen3-coder:30b" });
    await c.next((e) => e.type === "mode" && e.ollamaModel === "qwen3-coder:30b" && e.canUseTools === true, 8000, from);
    await new Promise((r) => setTimeout(r, 300));
    from = c.mark;
    c.send({ type: "provider", provider: "ollama", model: "qwen3-small:3b" });
    await c.next((e) => e.type === "mode" && e.ollamaModel === "qwen3-small:3b" && e.canUseTools === true, 8000, from);
    await new Promise((r) => setTimeout(r, 500));
    const tools = c.since(from).filter((e) => e.type === "mode" && e.ollamaModel === "qwen3-small:3b").map((e) => e.canUseTools);
    assert.equal(tools.at(-1), true, "settled: tools");
    assert.ok(!tools.includes(false), `the page hears the new model's answer, never "no tools" first: ${JSON.stringify(tools)}`);
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
      assert.ok(!c.events.some((e) => e.type === "install-offer"), "OPENCODE_BIN is the user's own choice, so no install is offered");
    } finally {
      await server.stop();
    }
  });

  // Where a pinned opencode build exists (Windows), a missing opencode comes with an offer to install it, shown to the person at the computer.
  test("opencode missing and not chosen by the user: the page is offered the install, with what it will do", { skip: skip || platformSkip() }, async () => {
    const server = await startServer({});
    try {
      const c = await server.client();
      await c.next("mode");
      const from = c.mark;
      c.send({ type: "provider", provider: "opencode" });
      const notice = await c.next((e) => e.type === "notice" && e.text.includes("opencode"), 5000, from);
      assert.match(notice.text, /not installed, so she stays on claude[^]*install it for you/);
      const offer = await c.next("install-offer", 5000, from);
      assert.deepEqual([offer.brain, offer.host, offer.version], ["opencode", "github.com", OPENCODE_PIN.version]);
      assert.ok(offer.megabytes > 10 && String(offer.folder).includes("opencode-" + OPENCODE_PIN.version));
      assert.ok(!c.since(from).some((e) => e.type === "reset"), "nothing changes until the user says yes");
    } finally {
      await server.stop();
    }
  });
});

describe("basic mode: no brain installed", { skip }, () => {
  /** No `claude` (or any other brain) on the server's PATH: only Node and the system. */
  const noBrains = () => ({ PATH: pathOf(dirname(process.execPath), ...systemPathDirs()), CURSOR_AGENT: "/nonexistent/cursor-agent", OPENCODE_BIN: "/nonexistent/opencode" });

  // With no brain at all, a machine that has a pinned opencode build gets the install offered as soon as the page connects; one who set OPENCODE_BIN does not.
  test("a page that connects is offered the opencode install (where a build exists), unless OPENCODE_BIN was set", { skip: skip || platformSkip() }, async () => {
    const { OPENCODE_BIN: _chosen, ...free } = noBrains();
    const open = await startServer({ env: free });
    try {
      const c = await open.client();
      assert.equal((await c.next("install-offer")).brain, "opencode");
    } finally {
      await open.stop();
    }
    const chosen = await startServer({ env: noBrains() });
    try {
      const c = await chosen.client();
      await c.done(0);
      assert.ok(!c.events.some((e) => e.type === "install-offer"));
    } finally {
      await chosen.stop();
    }
  });

  test("she opens by saying she is a script and how to get a brain, answers from the script, and has no work mode", async () => {
    const server = await startServer({ env: noBrains() });
    try {
      const c = await server.client();
      const mode = await c.next("mode");
      assert.equal(mode.basic, true);
      assert.equal(mode.provider, "basic");
      assert.equal(mode.canUseTools, false);
      await c.done(0);
      const greeting = c.since(0).filter((e) => e.type === "delta").map((e) => e.text).join("");
      assert.match(greeting, /no brain is installed yet, so right now I only follow a small script/);
      assert.match(greeting, /opencode/);
      assert.match(greeting, /npm install -g opencode-ai/);
      assert.match(greeting, /brains\.html/);

      const said = await ask(c, "make your hair blue and put on glasses");
      assert.match(said, /Okay! Blue hair and glasses\./);
      assert.ok(c.since(0).some((e) => e.type === "avatar" && e.applied?.some((a: string) => a.includes("hair_color"))), "the look changed");

      const joke = await ask(c, "tell me a joke");
      assert.match(joke, /no language model connected[^]*opencode/);

      const from = c.mark;
      c.send({ type: "mode", mode: "work" });
      const notice = await c.next((e) => e.type === "notice", 5000, from);
      assert.match(notice.text, /Work mode needs a brain/);
      assert.equal(server.data("settings.json") && JSON.parse(server.data("settings.json")!).provider, "claude", "nothing was saved about it");
    } finally {
      await server.stop();
    }
  });

  test("a conversation with the script is saved as one, so a real brain installed later starts a clean log", async () => {
    const first = await startServer({ env: noBrains() });
    try {
      const c = await first.client();
      await c.done(0);
      await new Promise((r) => setTimeout(r, 500)); // the log is saved a moment after
      assert.equal(JSON.parse(first.data("transcript.json") ?? "{}").provider, "basic");
    } finally {
      await first.stop();
    }
  });

  test("a first start with no settings uses a reachable Ollama before falling back to the script, and saves nothing", async () => {
    const fake = createServer((req, res) => {
      if (req.url === "/api/tags") return void res.end(JSON.stringify({ models: [{ name: "llama3.2:3b" }] }));
      res.end(JSON.stringify({ capabilities: ["completion"] }));
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    const server = await startServer({ firstStart: true, env: { ...noBrains(), OLLAMA_HOST: `http://127.0.0.1:${(fake.address() as AddressInfo).port}` } });
    try {
      const c = await server.client();
      const mode = await c.next("mode");
      assert.equal(mode.provider, "ollama");
      assert.equal(mode.basic, false);
      assert.equal(server.data("settings.json"), null, "nothing is saved until the user changes something");
    } finally {
      await server.stop();
      fake.close();
    }
  });

  test("a first start with nothing at all runs the script; installing a brain the user then picks ends it with a new conversation", async () => {
    const fake = createServer((req, res) => res.end(JSON.stringify(req.url === "/api/tags" ? { models: [] } : { capabilities: ["completion"] })));
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    const host = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    const server = await startServer({ firstStart: true, env: { ...noBrains(), OLLAMA_HOST: host } });
    try {
      const c = await server.client();
      assert.equal((await c.next("mode")).basic, true);
      await c.done(0);
      // Ollama now has a model: choosing it leaves basic mode.
      (fake as any).removeAllListeners("request");
      fake.on("request", (req, res) => res.end(JSON.stringify(req.url === "/api/tags" ? { models: [{ name: "llama3.2:3b" }] } : { capabilities: ["completion"] })));
      const from = c.mark;
      c.send({ type: "provider", provider: "ollama" });
      const mode = await c.next((e) => e.type === "mode" && e.provider === "ollama", 5000, from);
      assert.equal(mode.basic, false);
      assert.ok(c.since(from).some((e) => e.type === "reset"), "a new conversation");
    } finally {
      await server.stop();
      fake.close();
    }
  });
});

describe("[outfit bikini] is the bikini of the character she is wearing", { skip }, () => {
  let server: RunningServer;
  const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  before(async () => {
    const files: Record<string, string | Buffer> = {};
    for (const [id, name, dress, bikini] of [
      ["risa", "Risa", "You wear a green dress.", "You wear Risa's bikini."],
      ["franzi", "Franzi", "You wear a dirndl.", "You wear Franzi's bikini."],
    ] as const) {
      files[`frames/characters/${id}.txt`] = `${name}\nA woman.\ndefault: ${id}-dress\n`;
      files[`frames/${id}-dress/neutral.png`] = tiny;
      files[`frames/${id}-dress/look.txt`] = `character: ${id}\n${dress}\n`;
      files[`frames/${id}-bikini/neutral.png`] = tiny;
      files[`frames/${id}-bikini/look.txt`] = `character: ${id}\n${bikini}\n`;
    }
    server = await startServer({ dataFiles: files });
  });
  after(async () => {
    await server?.stop();
  });

  test("while Risa is on, bikini is risa-bikini; while Franzi is on, the same tag is franzi-bikini", async () => {
    const c = await server.client();
    await c.next("history");
    c.send({ type: "pack-catalog" });
    const listed = await c.next((e) => e.type === "packs" && e.names.includes("risa-bikini"), 8000);
    assert.equal(listed.characters["risa-bikini"].id, "risa");
    assert.equal(listed.characters["franzi-bikini"].id, "franzi");
    assert.equal(listed.characters["risa-dress"].default, "risa-dress");
    assert.notEqual(listed.characters["risa-bikini"].id, listed.characters["franzi-bikini"].id);

    c.send({ type: "user", text: "/frames risa-dress" });
    await c.next((e) => e.type === "notice" && /Showing the pack "risa-dress"/.test(e.text), 8000);
    await ask(c, "hello");
    const told = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(told.text!, /bikini/);
    assert.match(told.text!, /dress \(you wear this now\)/);
    assert.doesNotMatch(told.text!, /franzi/i, "Franzi's bikini is not one of Risa's outfits");

    const from = c.mark;
    await ask(c, "please OUTFIT bikini");
    const packMsg = await c.next((e) => e.type === "pack" && e.pack?.name === "risa-bikini", 8000, from);
    assert.equal(packMsg.pack.name, "risa-bikini");
    assert.equal(packMsg.pack.character, "risa");
    assert.equal(JSON.parse(server.data("settings.json")!).framePack, "risa-bikini");
    await ask(c, "and now?");
    const after = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(after.text!, /You wear Risa's bikini/);
    assert.doesNotMatch(after.text!, /Franzi/);

    c.send({ type: "user", text: "/frames franzi-dress" });
    await c.next((e) => e.type === "notice" && /Showing the pack "franzi-dress"/.test(e.text), 8000);
    const franzi = c.mark;
    await ask(c, "please OUTFIT bikini");
    const hers = await c.next((e) => e.type === "pack" && e.pack?.name === "franzi-bikini", 8000, franzi);
    assert.equal(hers.pack.name, "franzi-bikini");
    assert.equal(hers.pack.character, "franzi");
    assert.equal(JSON.parse(server.data("settings.json")!).framePack, "franzi-bikini");
    await ask(c, "which bikini?");
    const franziTold = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(franziTold.text!, /You wear Franzi's bikini/);
    assert.doesNotMatch(franziTold.text!, /Risa's bikini/);
  });
});

describe("[outfit uniform] is the uniform of the character she is wearing", { skip }, () => {
  let server: RunningServer;
  const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  before(async () => {
    const files: Record<string, string | Buffer> = {};
    for (const [id, name, first, uniform] of [
      ["risa", "Risa", ["risa-dress", "You wear a green dress."], "You wear Risa's school uniform."],
      ["draconia", "Draconia Malfoid", ["draconia-vest", "You wear a grey vest."], "You wear Draconia's Slytherin-style uniform."],
    ] as const) {
      files[`frames/characters/${id}.txt`] = `${name}\nA woman.\ndefault: ${first[0]}\n`;
      files[`frames/${first[0]}/neutral.png`] = tiny;
      files[`frames/${first[0]}/look.txt`] = `character: ${id}\n${first[1]}\n`;
      files[`frames/${id}-uniform/neutral.png`] = tiny;
      files[`frames/${id}-uniform/look.txt`] = `character: ${id}\n${uniform}\n`;
    }
    server = await startServer({ dataFiles: files });
  });
  after(async () => {
    await server?.stop();
  });

  test("while Risa is on, uniform is risa-uniform; while Draconia is on, the same tag is draconia-uniform", async () => {
    const c = await server.client();
    await c.next("history");
    c.send({ type: "pack-catalog" });
    const listed = await c.next((e) => e.type === "packs" && e.names.includes("risa-uniform"), 8000);
    assert.equal(listed.characters["risa-uniform"].id, "risa");
    assert.equal(listed.characters["draconia-uniform"].id, "draconia");
    assert.notEqual(listed.characters["risa-uniform"].id, listed.characters["draconia-uniform"].id);

    c.send({ type: "user", text: "/frames risa-dress" });
    await c.next((e) => e.type === "notice" && /Showing the pack "risa-dress"/.test(e.text), 8000);
    await ask(c, "hello");
    const told = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(told.text!, /uniform/);
    assert.doesNotMatch(told.text!, /draconia/i, "Draconia's uniform is not one of Risa's outfits");

    const from = c.mark;
    await ask(c, "please OUTFIT uniform");
    const packMsg = await c.next((e) => e.type === "pack" && e.pack?.name === "risa-uniform", 8000, from);
    assert.equal(packMsg.pack.character, "risa");
    assert.equal(JSON.parse(server.data("settings.json")!).framePack, "risa-uniform");
    await ask(c, "and now?");
    const after = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(after.text!, /You wear Risa's school uniform/);
    assert.doesNotMatch(after.text!, /Slytherin/);

    c.send({ type: "user", text: "/frames draconia-vest" });
    await c.next((e) => e.type === "notice" && /Showing the pack "draconia-vest"/.test(e.text), 8000);
    const draconia = c.mark;
    await ask(c, "please OUTFIT uniform");
    const hers = await c.next((e) => e.type === "pack" && e.pack?.name === "draconia-uniform", 8000, draconia);
    assert.equal(hers.pack.character, "draconia");
    assert.equal(JSON.parse(server.data("settings.json")!).framePack, "draconia-uniform");
    await ask(c, "which uniform?");
    const draconiaTold = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(draconiaTold.text!, /Slytherin-style uniform/);
    assert.doesNotMatch(draconiaTold.text!, /Risa's school uniform/);
  });
});

describe("a picture pack chosen in an earlier run", { skip }, () => {
  let server: RunningServer;
  const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  before(async () => {
    server = await startServer({
      settings: { framePack: "ann-coat" },
      dataFiles: {
        "frames/characters/ann.txt": "Ann\nA tall young woman with short red hair.\n",
        "frames/ann-coat/neutral.png": tiny,
        "frames/ann-coat/look.txt": "character: ann\nYou wear a coat.\n",
        "frames/ann-swim/neutral.png": tiny,
        "frames/ann-swim/look.txt": "character: ann\nYou wear a swimsuit.\n",
      },
    });
  });
  after(async () => {
    await server?.stop();
  });

  test("at a server start she is still told her outfits with her first message, and can change into one", async () => {
    const c = await server.client();
    await c.next("history");
    await ask(c, "hello");
    const first = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(first.text!, /You wear a coat/);
    assert.match(first.text!, /\[outfit <name>\]/, "the instructions are there even though the pack list was not read when the server started");
    assert.match(first.text!, /coat \(you wear this now\), swim/);
    const from = c.mark;
    await ask(c, "please OUTFIT swim");
    await c.next((e) => e.type === "pack" && e.pack?.name === "ann-swim", 8000, from);
  });
});

describe("whose voice she speaks in: custom, then the character of the pack that is on, then the default", { skip }, () => {
  const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const frames = (voice: boolean) => ({
    "frames/characters/ann.txt": `Ann\nA tall young woman with short red hair.\n${voice ? "voice: a gruff sailor who says arr a lot.\n" : ""}`,
    "frames/ann-coat/neutral.png": tiny,
    "frames/ann-coat/look.txt": "character: ann\nYou wear a coat.\n",
  });
  const promptOf = async (server: RunningServer) => {
    const c = await server.client();
    await c.next("history");
    await ask(c, "hello");
    return server.systemPrompt();
  };

  test("with a pack whose character has a voice, her prompt is that character's, with the expression protocol after it", async () => {
    const server = await startServer({ settings: { framePack: "ann-coat" }, dataFiles: frames(true) });
    try {
      const prompt = await promptOf(server);
      assert.match(prompt, /You are Ann, an anime-style AI companion/);
      assert.match(prompt, /How you speak: a gruff sailor who says arr a lot\./);
      assert.doesNotMatch(prompt, /cheerful, warm and slightly mischievous/);
      assert.match(prompt, /Expression protocol \(important\):/);
    } finally {
      await server.stop();
    }
  });

  test("a name the user gave her wins over the character's: the prompt and the pack note say Hana, the voice is still the character's", async () => {
    const server = await startServer({ settings: { framePack: "ann-coat", name: "Hana", nameSet: true }, dataFiles: frames(true) });
    try {
      const c = await server.client();
      await c.next("history");
      await ask(c, "hello");
      const prompt = server.systemPrompt();
      assert.match(prompt, /You are Hana, an anime-style AI companion/);
      assert.match(prompt, /How you speak: a gruff sailor who says arr a lot\./);
      const first = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
      assert.match(first.text!, /You are Hana\. A tall young woman with short red hair/);
      assert.match(first.text!, /Speak as Hana from now on, in her own voice: a gruff sailor/);
      assert.doesNotMatch(first.text!, /You are Ann\./);
    } finally {
      await server.stop();
    }
  });

  test("a character without a voice leaves the default persona alone", async () => {
    const server = await startServer({ settings: { framePack: "ann-coat" }, dataFiles: frames(false) });
    try {
      const prompt = await promptOf(server);
      assert.match(prompt, /You are Ann, a cheerful, warm and slightly mischievous/, "the default persona, under the character's name (she has no name of her own)");
      assert.doesNotMatch(prompt, /gruff sailor|How you speak/);
    } finally {
      await server.stop();
    }
  });

  test("the user's own data/persona.md beats the character, and the protocol is still ours", async () => {
    const server = await startServer({ settings: { framePack: "ann-coat" }, dataFiles: { ...frames(true), "persona.md": "You are a dry-witted librarian.\n" } });
    try {
      const prompt = await promptOf(server);
      assert.match(prompt, /You are a dry-witted librarian\./);
      assert.doesNotMatch(prompt, /gruff sailor/);
      assert.match(prompt, /Expression protocol \(important\):/);
    } finally {
      await server.stop();
    }
  });
});

describe("her own persona: she proposes, the user keeps", { skip }, () => {
  let server: RunningServer;
  before(async () => {
    server = await startServer({ delay: 50 });
  });
  after(async () => {
    await server?.stop();
  });

  test("a proposal is a card with the whole text, written to data/persona.md only on Keep (the old file kept), and told to her; she is told about the tag once", async () => {
    const c = await server.client();
    await c.next("history");
    let from = c.mark;
    c.say("PERSONA make yourself a sailor");
    const offer = await c.next("persona-offer", 8000, from);
    assert.match(offer.text, /^You are a gruff sailor who says arr a lot and keeps replies short\./);
    assert.doesNotMatch(offer.text, /\[emotion|\[persona/, "her own tags are cleaned out of the text");
    assert.match(offer.replaces, /the default/);
    assert.equal(server.data("persona.md"), null, "nothing is written before Keep");
    const intro = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(intro.text!, /\[persona <the complete new description/, "the first message of the conversation tells her how to propose a change");
    from = c.mark;
    c.send({ type: "persona-reply", id: offer.id, choice: "keep" });
    await c.next("persona-resolved", 5000, from);
    assert.equal(server.data("persona.md"), `${offer.text}\n`);
    await ask(c, "hello again");
    const told = server.claudeLog().filter((e) => e.kind === "in").at(-1)!;
    assert.match(told.text!, /The user kept your new persona[^]*gruff sailor/, "the conversation that is running is told");
    assert.doesNotMatch(told.text!, /\[persona <the complete/, "the how-to is said once per conversation");
    // a second proposal replaces the file and keeps the first as persona.md.bak
    await ask(c, "PERSONA another one");
    const second = await c.next((e) => e.type === "persona-offer" && e.id !== offer.id, 8000);
    assert.match(second.replaces, /your own: data\/persona\.md/);
  });

  test("Not now writes nothing and she is told; /persona says whose voice it is, shows it, and reset removes the file (kept as .bak)", async () => {
    const c = await server.client();
    await c.next("history");
    await fresh(c);
    const from = c.mark;
    c.say("PERSONA again please");
    const offer = await c.next("persona-offer", 8000, from);
    c.send({ type: "persona-reply", id: offer.id, choice: "skip" });
    await c.next("persona-resolved", 5000, from);
    await ask(c, "ok never mind");
    assert.match(server.claudeLog().filter((e) => e.kind === "in").at(-1)!.text!, /declined your persona proposal/);
    const said = async (text: string): Promise<string> => {
      const mark = c.mark;
      c.say(text);
      return (await c.next("notice", 5000, mark)).text;
    };
    assert.match(await said("/persona"), /Her voice: your own: data\/persona\.md/);
    assert.match(await said("/persona show"), /gruff sailor/);
    assert.match(await said("/persona reset"), /removed \(kept as persona\.md\.bak\)/);
    assert.equal(server.data("persona.md"), null);
    assert.ok(server.data("persona.md.bak"), "the removed persona is still there as a backup");
    assert.match(await said("/persona"), /Her voice: the default/);
  });

  test("in work mode she cannot propose: the user is told why and no card appears", async () => {
    const c = await server.client();
    await c.next("history");
    c.send({ type: "mode", mode: "work", projectDir: server.project });
    await c.next((e) => e.type === "mode" && e.mode === "work");
    const from = c.mark;
    c.say("PERSONA from work mode");
    const notice = await c.next((e) => e.type === "notice" && /change her persona/.test(e.text), 8000, from);
    assert.match(notice.text, /chat mode only/);
    assert.equal(c.since(from).some((e) => e.type === "persona-offer"), false);
    c.send({ type: "mode", mode: "chat" });
  });
});

describe("her name: the user's own, else the character's of the pack that is on", { skip }, () => {
  const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  let server: RunningServer;
  before(async () => {
    server = await startServer({
      settings: { framePack: "ann-coat" },
      dataFiles: { "frames/characters/ann.txt": "Ann\nA tall young woman with short red hair.\n", "frames/ann-coat/neutral.png": tiny, "frames/ann-coat/look.txt": "character: ann\nYou wear a coat.\n" },
    });
  });
  after(async () => {
    await server?.stop();
  });

  test("with a pack on and no name of her own she goes by the character's; /rename is the user's and wins; /rename reset goes back; the pack off gives the default", async () => {
    const c = await server.client();
    assert.equal((await c.next("mode")).name, "Ann");
    const said = async (text: string): Promise<string> => {
      const mark = c.mark;
      c.say(text);
      return (await c.next("notice", 5000, mark)).text;
    };
    assert.match(await said("/rename"), /She is called Ann \(the name of the character of the pack that is on\)/);
    let from = c.mark;
    c.say("/rename Hana");
    assert.equal((await c.next((e) => e.type === "mode" && e.name === "Hana", 5000, from)).name, "Hana");
    assert.match((await c.next("notice", 5000, from)).text, /She is called Hana now\. \/rename reset goes back\./, "a rename is confirmed in the chat, as a reset is");
    from = c.mark;
    c.say("/frames off");
    assert.equal((await c.next((e) => e.type === "mode", 5000, from)).name, "Hana", "the user's name stays when the pack goes");
    from = c.mark;
    c.say("/frames ann-coat");
    assert.equal((await c.next((e) => e.type === "mode", 5000, from)).name, "Hana", "and a pack does not take it over");
    await c.next("packs", 5000, from);
    from = c.mark;
    c.say("/rename reset");
    assert.equal((await c.next((e) => e.type === "mode", 5000, from)).name, "Ann", "reset: the character's name again");
    assert.equal(server.data("settings.json")?.includes('"nameSet": false'), true);
    from = c.mark;
    c.say("/frames off");
    assert.equal((await c.next((e) => e.type === "mode", 5000, from)).name, "Risa", "no pack: the default");
  });
});
