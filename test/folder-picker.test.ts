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
  assert.equal(pickerCommand("win32", null, () => true), null);
});

test("dialog output becomes a plain folder path", () => {
  assert.equal(parsePickedPath("/Users/me/project/\n"), "/Users/me/project");
  assert.equal(parsePickedPath("/"), "/");
  assert.equal(parsePickedPath(""), null);
  assert.equal(parsePickedPath("relative/dir"), null);
});
