import assert from "node:assert/strict";
import { spawn, type SpawnOptions } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handOff, PARENT_RESTARTS, readDaemonPid, RESTART_EXIT } from "../src/restart.ts";

test("a waiting parent is asked to start the server again, and nothing is spawned", () => {
  let code = -1;
  handOff({
    execPath: process.execPath,
    argv: [process.execPath, "src/server.ts", "--chat"],
    env: { [PARENT_RESTARTS]: "1" },
    cwd: process.cwd(),
    pidFile: join(tmpdir(), "anaico-restart-missing.pid"),
    logFile: join(tmpdir(), "anaico-restart-missing.log"),
    ownPid: process.pid,
    exit: (next) => {
      code = next;
    },
    spawnProcess: () => {
      throw new Error("a parent that is waiting should start the new server itself");
    },
  });
  assert.equal(code, RESTART_EXIT);
});

test("a daemon starts the new process itself and the pid file follows it", () => {
  const dir = mkdtempSync(join(tmpdir(), "anaico-restart-"));
  const pidFile = join(dir, "server.pid");
  writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port: 3737 }));
  let code = -1;
  let options: SpawnOptions | undefined;
  let args: string[] | undefined;
  try {
    handOff({
      execPath: process.execPath,
      argv: [process.execPath, "src/server.ts"],
      env: {},
      cwd: dir,
      pidFile,
      logFile: join(dir, "server.log"),
      ownPid: process.pid,
      exit: (next) => {
        code = next;
      },
      spawnProcess: ((file: string, argv: readonly string[], opts: SpawnOptions) => {
        assert.equal(file, process.execPath);
        args = [...argv];
        options = opts;
        return { pid: 4242, unref() {} } as ReturnType<typeof spawn>;
      }) as typeof spawn,
    });
    assert.equal(code, 0);
    assert.deepEqual(args, ["src/server.ts"]);
    assert.equal(options?.detached, true);
    assert.deepEqual(options?.stdio?.[0], "ignore");
    assert.equal(typeof options?.stdio?.[1], "number", "a daemon keeps its log");
    assert.deepEqual(readDaemonPid(pidFile), { pid: 4242, port: 3737 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the desktop shell uses the same exit code and the same parent flag", () => {
  const shell = readFileSync(new URL("../app/main.cjs", import.meta.url), "utf8");
  assert.match(shell, new RegExp(PARENT_RESTARTS));
  assert.match(shell, /code === 75/);
  assert.equal(RESTART_EXIT, 75);
});
