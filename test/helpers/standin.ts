import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Stand-in programs for the tests: a fake `claude`, `opencode` or `cursor-agent` that is a Node script. The app starts these by name from the
 * PATH, like the real ones, so a stand-in has to be something the operating system can start by name.
 *
 * macOS and Linux: the script itself, with a `#!node` first line and the executable bit.
 * Windows: a script cannot be started by name, and a `.cmd` shim cannot carry the long, multi-line arguments the app gives `claude`, so the stand-in
 * is a real `<name>.exe`: a tiny launcher (compiled once with the C# compiler every Windows has) that starts `node <name>.js` with the same
 * arguments and the same stdin and stdout, and exits with its code.
 */

const LAUNCHER_SOURCE = `
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

static class Launcher {
  static string Quote(string s) {
    if (s.Length > 0 && s.IndexOfAny(new[] { ' ', '\\t', '\\n', '\\v', '"' }) < 0) return s;
    var sb = new StringBuilder("\\"");
    int backslashes = 0;
    foreach (char c in s) {
      if (c == '\\\\') backslashes++;
      else if (c == '"') { sb.Append('\\\\', backslashes * 2 + 1); sb.Append('"'); backslashes = 0; }
      else { sb.Append('\\\\', backslashes); backslashes = 0; sb.Append(c); }
    }
    sb.Append('\\\\', backslashes * 2);
    sb.Append('"');
    return sb.ToString();
  }

  static int Main(string[] args) {
    string self = System.Reflection.Assembly.GetExecutingAssembly().Location;
    string[] target = File.ReadAllLines(self + ".target");   // line 1: node.exe, line 2: the script
    var line = new StringBuilder(Quote(target[1]));
    foreach (string a in args) { line.Append(' '); line.Append(Quote(a)); }
    var info = new ProcessStartInfo(target[0], line.ToString()) { UseShellExecute = false };
    using (var p = Process.Start(info)) { p.WaitForExit(); return p.ExitCode; }
  }
}
`;

/** The compiled launcher, built once per machine (the file name carries a hash of the source, so a changed source builds a new one). */
function launcher(): string {
  const hash = createHash("sha256").update(LAUNCHER_SOURCE).digest("hex").slice(0, 12);
  const dir = join(tmpdir(), "anaico-test-launcher");
  const exe = join(dir, `launcher-${hash}.exe`);
  if (existsSync(exe)) return exe;
  mkdirSync(dir, { recursive: true });
  // Several test files start at once and may all get here: each builds its own file and renames it into place, so nobody sees a half-written exe.
  const unique = `${process.pid}-${Date.now()}`;
  const source = join(dir, `launcher-${unique}.cs`);
  const building = join(dir, `launcher-${unique}.exe`);
  writeFileSync(source, LAUNCHER_SOURCE);
  const csc = join(process.env.windir ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  try {
    execFileSync(csc, ["/nologo", "/optimize", `/out:${building}`, source], { stdio: "pipe" });
    if (!existsSync(exe)) renameSync(building, exe);
  } finally {
    rmSync(source, { force: true });
    rmSync(building, { force: true });
  }
  return exe;
}

/**
 * Writes the stand-in `name` into `dir` (which then goes on the PATH) and returns the path of the program. `script` is a Node script's text; a
 * `#!` first line is fine, it is only used on macOS and Linux.
 */
export function writeStandIn(dir: string, name: string, script: string): string {
  mkdirSync(dir, { recursive: true });
  if (process.platform !== "win32") {
    const program = join(dir, name);
    writeFileSync(program, script.startsWith("#!") ? script : `#!${process.execPath}\n${script}`);
    chmodSync(program, 0o755);
    return program;
  }
  const js = join(dir, `${name}.js`);
  writeFileSync(js, script.replace(/^#![^\n]*\n/, ""));
  const program = join(dir, `${name}.exe`);
  copyFileSync(launcher(), program);
  writeFileSync(`${program}.target`, `${process.execPath}\n${js}\n`);
  return program;
}

/** The directories the server needs on its PATH besides the stand-ins and Node: the system ones. */
export function systemPathDirs(): string[] {
  return process.platform === "win32" ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32")] : ["/usr/bin", "/bin"];
}

/** A PATH made of exactly these directories. */
export const pathOf = (...dirs: string[]): string => dirs.join(delimiter);

/**
 * The few variables a Windows process needs to work at all (sockets fail without SystemRoot, `cmd.exe` and programs are found through ComSpec and
 * PATHEXT, `os.tmpdir()` and `os.homedir()` read TEMP and USERPROFILE), for tests that start a process with an environment of their own.
 */
export function baseEnv(home?: string): Record<string, string> {
  if (process.platform !== "win32") return home ? { HOME: home } : {};
  const keep = ["SystemRoot", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "SystemDrive"] as const;
  const env: Record<string, string> = {};
  for (const key of keep) if (process.env[key]) env[key] = process.env[key]!;
  if (home) Object.assign(env, { HOME: home, USERPROFILE: home });
  return env;
}
