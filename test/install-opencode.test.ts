import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { InstallError, OPENCODE_PIN, cleanInstallLeftovers, installOpencode, managedOpencode, opencodeAsset, opencodeFolder, opencodeUrl, type InstallProgress, type OpencodeAsset } from "../src/install-opencode.ts";
import { brainProgram } from "../src/programs.ts";

let root = "";
before(() => {
  root = mkdtempSync(join(tmpdir(), "anaico-install-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

// A stand-in release file: its own bytes and hash, so nothing is downloaded and the real pin is not touched.
const bytes = Buffer.from("not really a zip, but it hashes the same every time".repeat(2000));
const asset: OpencodeAsset = { name: "opencode-test.zip", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, program: "opencode.exe" };
const fakeFetch = (body: Buffer, status = 200): typeof fetch =>
  (async () => new Response(status === 200 ? new Blob([new Uint8Array(body)]).stream() : null, { status })) as unknown as typeof fetch;
const fakeExtract = async (_archive: string, into: string) => writeFileSync(join(into, "opencode.exe"), "program");
const says = (version: string) => async () => `opencode ${version}`;
const leftovers = () => readdirSync(join(root, "tools")).filter((n) => n.startsWith(".installing-"));

describe("the pin", () => {
  test("is one release, with a checksum and a size for every file", () => {
    assert.match(OPENCODE_PIN.version, /^\d+\.\d+\.\d+$/);
    for (const [key, a] of Object.entries(OPENCODE_PIN.assets)) {
      assert.match(key, /^(win32)-(x64|arm64)$/);
      assert.match(a.sha256, /^[0-9a-f]{64}$/, key);
      assert.ok(a.bytes > 1_000_000 && a.bytes < 500_000_000, key);
      assert.ok(a.name.endsWith(".zip"), key);
    }
  });

  test("Windows x64 gets the baseline build (it needs no AVX2); machines with no pinned build get null", () => {
    assert.equal(opencodeAsset("win32", "x64")?.name, "opencode-windows-x64-baseline.zip");
    assert.equal(opencodeAsset("win32", "arm64")?.name, "opencode-windows-arm64.zip");
    assert.equal(opencodeAsset("linux", "x64"), null);
    assert.equal(opencodeAsset("darwin", "arm64"), null);
  });

  test("the download address is the pinned tag on GitHub, never 'latest'", () => {
    const url = opencodeUrl(opencodeAsset("win32", "x64")!);
    assert.equal(url, `https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_PIN.version}/opencode-windows-x64-baseline.zip`);
    assert.ok(!url.includes("latest"));
  });
});

describe("installing", () => {
  test("downloads, checks the hash, unpacks, tries the program and puts it in its own folder; progress is reported", async () => {
    const seen: InstallProgress[] = [];
    const program = await installOpencode({ root, platform: "win32", arch: "x64", asset, fetchFn: fakeFetch(bytes), extract: fakeExtract, versionOf: says(OPENCODE_PIN.version), onProgress: (p) => seen.push(p) });
    assert.equal(program, join(opencodeFolder(root), "opencode.exe"));
    assert.ok(existsSync(program));
    assert.equal(managedOpencode(root, "win32", "x64"), program);
    assert.deepEqual(seen.map((p) => p.stage).filter((s, i, all) => all.indexOf(s) === i), ["download", "unpack", "check"]);
    assert.equal(seen.filter((p) => p.stage === "download").at(-1)?.received, bytes.length);
    assert.deepEqual(leftovers(), [], "the scratch folder is gone");
    assert.deepEqual(readdirSync(opencodeFolder(root)), ["opencode.exe"], "the zip itself is not kept");
  });

  test("a second install replaces the first", async () => {
    await installOpencode({ root, platform: "win32", arch: "x64", asset, fetchFn: fakeFetch(bytes), extract: fakeExtract, versionOf: says(OPENCODE_PIN.version) });
    assert.ok(managedOpencode(root, "win32", "x64"));
    assert.deepEqual(leftovers(), []);
  });

  describe("and when it goes wrong, nothing is left installed and the message says why", () => {
    const fresh = () => mkdtempSync(join(tmpdir(), "anaico-install-bad-"));
    const run = (r: string, over: Parameters<typeof installOpencode>[0]) => installOpencode({ root: r, platform: "win32", arch: "x64", asset, extract: fakeExtract, versionOf: says(OPENCODE_PIN.version), ...over });

    test("a file with a different hash is thrown away", async () => {
      const r = fresh();
      const other = Buffer.from(bytes.toString().replace("zip", "zzz"));
      await assert.rejects(run(r, { fetchFn: fakeFetch(other), asset: { ...asset, bytes: other.length } }), (e: Error) => e instanceof InstallError && /checksum differs/.test(e.message));
      assert.equal(managedOpencode(r, "win32", "x64"), null);
      assert.deepEqual(readdirSync(join(r, "tools")), []);
      rmSync(r, { recursive: true, force: true });
    });

    test("a download that runs past the expected size is stopped", async () => {
      const r = fresh();
      await assert.rejects(run(r, { fetchFn: fakeFetch(Buffer.alloc(3 * 1024 * 1024)), asset: { ...asset, bytes: 1000 } }), /larger than expected/);
      assert.deepEqual(readdirSync(join(r, "tools")), []);
      rmSync(r, { recursive: true, force: true });
    });

    test("GitHub answering with an error", async () => {
      const r = fresh();
      await assert.rejects(run(r, { fetchFn: fakeFetch(bytes, 404) }), /GitHub answered 404/);
      rmSync(r, { recursive: true, force: true });
    });

    test("no network", async () => {
      const r = fresh();
      const down = (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;
      await assert.rejects(run(r, { fetchFn: down }), /Could not reach GitHub: fetch failed/);
      rmSync(r, { recursive: true, force: true });
    });

    test("a program that says another version, or nothing, is not installed", async () => {
      const r = fresh();
      await assert.rejects(run(r, { fetchFn: fakeFetch(bytes), versionOf: says("0.0.1") }), /did not start properly/);
      await assert.rejects(run(r, { fetchFn: fakeFetch(bytes), versionOf: async () => Promise.reject(new Error("crash")) }), /did not start properly/);
      assert.equal(managedOpencode(r, "win32", "x64"), null);
      assert.deepEqual(readdirSync(join(r, "tools")), []);
      rmSync(r, { recursive: true, force: true });
    });

    test("an archive without the program", async () => {
      const r = fresh();
      await assert.rejects(run(r, { fetchFn: fakeFetch(bytes), extract: async () => {} }), /did not contain opencode\.exe/);
      rmSync(r, { recursive: true, force: true });
    });

    test("stopping it by the user", async () => {
      const r = fresh();
      const abort = new AbortController();
      const slow = (async (_url: string, init?: RequestInit) => {
        const stream = new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(1000));
            abort.abort();
            if (init?.signal?.aborted) controller.error(new DOMException("aborted", "AbortError"));
          },
        });
        return new Response(stream, { status: 200 });
      }) as unknown as typeof fetch;
      await assert.rejects(run(r, { fetchFn: slow, signal: abort.signal }), /Stopped/);
      assert.deepEqual(readdirSync(join(r, "tools")), []);
      rmSync(r, { recursive: true, force: true });
    });

    test("a machine with no pinned build says how to install it by hand", async () => {
      const r = fresh();
      await assert.rejects(installOpencode({ root: r, platform: "linux", arch: "x64" }), /opencode\.ai/);
      rmSync(r, { recursive: true, force: true });
    });
  });

  test("scratch folders left by a closed app are cleaned up, a finished install is not touched", async () => {
    const r = mkdtempSync(join(tmpdir(), "anaico-install-left-"));
    await installOpencode({ root: r, platform: "win32", arch: "x64", asset, fetchFn: fakeFetch(bytes), extract: fakeExtract, versionOf: says(OPENCODE_PIN.version) });
    const stray = join(r, "tools", ".installing-abc123");
    writeFileSync(join(r, "tools", "keep.txt"), "x");
    await import("node:fs/promises").then((fs) => fs.mkdir(stray));
    await cleanInstallLeftovers(r);
    assert.ok(!existsSync(stray));
    assert.ok(managedOpencode(r, "win32", "x64"));
    assert.ok(existsSync(join(r, "tools", "keep.txt")));
    rmSync(r, { recursive: true, force: true });
  });
});

describe("finding the program", () => {
  test("nothing installed by us: the plain name; the user's own OPENCODE_BIN always wins", () => {
    assert.equal(managedOpencode(join(root, "nowhere"), "win32", "x64"), null);
    assert.equal(brainProgram("opencode", { OPENCODE_BIN: "C:\\mine\\opencode.exe" }), "C:\\mine\\opencode.exe");
  });
});
