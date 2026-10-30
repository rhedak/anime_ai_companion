import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRequestHandler } from "../src/http-routes.ts";

/** Runs one request through the handler, with a socket from the given address, and says what came back. */
async function request(address: string, path: string, publicDir: string) {
  const handler = createRequestHandler({
    host: "127.0.0.1",
    port: 3737,
    publicDir,
    customCssPath: join(publicDir, "missing.css"),
    lan: () => false,
    lanToken: () => "",
    transcript: { findShown: () => undefined },
    packDirs: [],
    emotionNames: () => [],
    activePack: () => null,
  });
  const req = { url: path, method: "GET", headers: { host: "127.0.0.1:3737" }, socket: { remoteAddress: address } } as any;
  let status = 0;
  let body: Buffer | string = "";
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    setHeader() {},
    end(chunk?: Buffer | string) {
      body = chunk ?? "";
    },
  } as any;
  await handler(req, res);
  return { status, body: String(body) };
}

test("the full pack studio's page is for this computer only: a phone is told there is no such page", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-page-"));
  try {
    await writeFile(join(dir, "studio-full.html"), "<!doctype html><title>Pack studio</title>");
    await writeFile(join(dir, "studio-full.js"), "export {};");
    const here = await request("127.0.0.1", "/studio-full.html", dir);
    assert.equal(here.status, 200);
    assert.match(here.body, /Pack studio/);
    assert.equal((await request("127.0.0.1", "/studio-full.js", dir)).status, 200);
    const phone = await request("192.168.1.20", "/studio-full.html", dir);
    assert.notEqual(phone.status, 200, "another device gets no page");
    assert.equal((await request("192.168.1.20", "/studio-full.js", dir)).status, 401);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
