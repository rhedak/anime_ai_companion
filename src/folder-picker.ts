import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * A browser cannot tell the server the real path of a folder, but the server runs on the user's own
 * machine, so it asks the operating system's own folder dialog instead. The start folder is passed as an
 * argument, never spliced into a command line or script.
 */

export interface PickerCommand {
  command: string;
  args: string[];
  /** Extra environment for the dialog's process (the Windows script reads its start folder from here). */
  env?: Record<string, string>;
}

const TITLE = "Choose the folder she works in";

// The Windows dialog is a PowerShell script (Windows Forms is part of every Windows). It is a fixed text, passed whole as -EncodedCommand (base64 of
// UTF-16), and reads the start folder from the environment: nothing the user or the project controls is part of the code. A hidden top-most window owns
// the dialog so that it opens in front of the browser or the app instead of behind it. Exit 0 and the path on stdout, or exit 1 for Cancel.
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Show()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '${TITLE}'
$dialog.ShowNewFolderButton = $true
if ($env:ANAICO_PICK_START) { $dialog.SelectedPath = $env:ANAICO_PICK_START }
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath); exit 0 }
exit 1
`;

/** The dialog command for this platform, or null if there is none we know. `has` says if a program is installed. */
export function pickerCommand(platform: string, startDir: string | null, has: (program: string) => boolean): PickerCommand | null {
  const start = startDir && existsSync(startDir) ? startDir : null;
  if (platform === "darwin") {
    // AppleScript reads the start folder from argv, so it cannot be mistaken for code.
    return {
      command: "osascript",
      args: [
        "-e", "on run argv",
        "-e", start
          ? `POSIX path of (choose folder with prompt "${TITLE}" default location (POSIX file (item 1 of argv)))`
          : `POSIX path of (choose folder with prompt "${TITLE}")`,
        "-e", "end run",
        ...(start ? [start] : []),
      ],
    };
  }
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64")],
      env: { ANAICO_PICK_START: start ?? "" },
    };
  }
  if (platform === "linux") {
    if (has("zenity")) return { command: "zenity", args: ["--file-selection", "--directory", `--title=${TITLE}`, ...(start ? [`--filename=${start}/`] : [])] };
    if (has("kdialog")) return { command: "kdialog", args: ["--title", TITLE, "--getexistingdirectory", start ?? "."] };
  }
  return null;
}

export function installed(program: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => dir && existsSync(join(dir, program)));
}

/** What a dialog printed, as a folder path (no trailing slash), or null if it was cancelled or printed nothing. Windows paths (`C:\x`, `\\host\share`) too. */
export function parsePickedPath(output: string): string | null {
  const text = output.trim();
  if (/^[A-Za-z]:[\\/]/.test(text)) return text.replace(/(?<=^[A-Za-z]:[\\/].*)[\\/]+$/, ""); // a drive root keeps its slash
  if (/^\\\\[^\\/]+[\\/][^\\/]/.test(text)) return text.replace(/\\+$/, "");
  const path = text.replace(/(?<=.)\/+$/, "");
  return path.startsWith("/") ? path : null;
}

export type PickResult = { path: string } | { cancelled: true } | { error: string };

export function pickFolder(startDir: string | null, platform = process.platform): Promise<PickResult> {
  const picker = pickerCommand(platform, startDir, installed);
  if (!picker) return Promise.resolve({ error: "This system has no folder dialog I can open. Type the folder's path instead." });
  return new Promise((resolve) => {
    const child = spawn(picker.command, picker.args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...picker.env }, windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ error: `Could not open the folder dialog: ${e.message}` }));
    child.on("close", (code) => {
      const path = code === 0 ? parsePickedPath(out) : null;
      if (path) resolve({ path });
      else if (code === 0 || /cancel|-128/i.test(err) || code === 1) resolve({ cancelled: true }); // zenity and kdialog exit 1 on cancel
      else resolve({ error: `The folder dialog failed: ${err.trim().slice(0, 200) || `exit ${code}`}` });
    });
  });
}
