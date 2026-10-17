import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { parsePickedPath, pickerCommand } from "../src/folder-picker.ts";

const none = () => false;

test("macOS: the start folder travels as an argument, never inside the script", () => {
  const nasty = tmpdir(); // exists, so it is used
  const command = pickerCommand("darwin", nasty, none)!;
  assert.equal(command.command, "osascript");
  assert.equal(command.args.at(-1), nasty);
  assert.ok(!command.args.slice(0, -1).some((a) => a.includes(nasty)));
  const without = pickerCommand("darwin", "/does/not/exist/\" & quit", none)!;
  assert.ok(!without.args.join(" ").includes("does/not/exist"));
});

test("Linux uses zenity or kdialog when present; other systems get nothing", () => {
  assert.equal(pickerCommand("linux", null, (p) => p === "zenity")!.command, "zenity");
  assert.equal(pickerCommand("linux", null, (p) => p === "kdialog")!.command, "kdialog");
  assert.equal(pickerCommand("linux", null, none), null);
  assert.equal(pickerCommand("freebsd", null, () => true), null);
});

test("Windows: a fixed PowerShell script, and the start folder travels in the environment, never inside the code", () => {
  const nasty = tmpdir() + "'; Remove-Item -Recurse C:\\ #"; // does not exist, so it is dropped
  const dropped = pickerCommand("win32", nasty, none)!;
  assert.equal(dropped.command, "powershell.exe");
  assert.equal(dropped.env?.ANAICO_PICK_START, "");
  const real = pickerCommand("win32", tmpdir(), none)!;
  assert.equal(real.env?.ANAICO_PICK_START, tmpdir());
  const encoded = real.args[real.args.indexOf("-EncodedCommand") + 1];
  const script = Buffer.from(encoded, "base64").toString("utf16le");
  assert.ok(!script.includes(tmpdir()), "the start folder is not in the script");
  assert.equal(script, Buffer.from(dropped.args[dropped.args.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le"), "the script is the same text every time");
  assert.match(script, /FolderBrowserDialog/);
});

test("dialog output becomes a plain folder path", () => {
  assert.equal(parsePickedPath("/Users/me/project/\n"), "/Users/me/project");
  assert.equal(parsePickedPath("/"), "/");
  assert.equal(parsePickedPath(""), null);
  assert.equal(parsePickedPath("relative/dir"), null);
});

test("dialog output on Windows: drive paths and network shares, a drive root keeps its slash", () => {
  assert.equal(parsePickedPath("C:\\Users\\me\\project\r\n"), "C:\\Users\\me\\project");
  assert.equal(parsePickedPath("C:\\Users\\me\\project\\"), "C:\\Users\\me\\project");
  assert.equal(parsePickedPath("D:\\"), "D:\\");
  assert.equal(parsePickedPath("\\\\server\\share\\dir\\"), "\\\\server\\share\\dir");
  assert.equal(parsePickedPath("C:relative"), null);
});
