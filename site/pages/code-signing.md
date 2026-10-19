---
description: How the Windows installer is signed (or will be), who signs it, and what the program does on the network.
---

# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

This applies from the first Windows installer that carries a SignPath signature. Earlier installers, and all macOS and Linux files, are not signed
(see the [Download page](download.html) for the warnings that causes and how to get past them).

## What is signed

The Windows installer (`Anime.AI.Companion.Setup.<version>.exe`) and the program inside it, built from the source in
[this repository](https://github.com/rhedak/anime_ai_companion) by the [release workflow](https://github.com/rhedak/anime_ai_companion/blob/main/.github/workflows/release.yml)
on GitHub's own runners when a version tag is pushed. Nothing is built or signed on a personal computer. The product name and version in the file
properties come from the same source, and every file in the installer is open source (MIT, or the licence of the open-source library it is).

## Who does what

- **Committers and reviewers:** the owner, [@rhedak](https://github.com/rhedak). Pull requests from others are reviewed by the owner before they are merged.
- **Approvers:** the owner. Every release is approved by hand before it is signed.

The team has two-factor authentication on GitHub and on SignPath.

## Privacy

This program does not send anything to other systems unless you ask it to, or the person installing and running it does. In detail: it talks to the
brain you choose (Claude Code, Cursor, opencode or Ollama, which have their own policies), it can download a picture pack, opencode or the character
drawing code from GitHub after asking you first, and it can ask GitHub once a day for the newest version number, but only if you said yes in a dialog.
Nothing you type is collected or sent to the project. See [Safety and privacy](safety.html).
