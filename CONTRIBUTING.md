# Contributing

First: **you do not have to do any of this.** The project is MIT-licensed, so you can use it,
change it and keep your changes to yourself. This page is only a friendly request.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## The request

If you make something better, in this repo or in your checkout of
[anime-character-creator](https://github.com/rhedak/anime-character-creator), please consider
opening a pull request. Other people get the improvement, and you get review, fixes from others
and no private fork to keep in sync. Small, focused pull requests are the easiest to say yes to. Please open them against the
**`dev` branch**: `main` is only updated by a release, which gets a new version number.

## Running the checks

```bash
npm install
npm run typecheck
npm test
```

`./check.sh` runs what CI runs (lockfile, typecheck, tests) and refuses to pass with uncommitted files, a creator that is not at
the pinned tag, or skipped tests. `./check.sh --full` adds the oldest Node and the docs site and demo builds, for a release.
`./check.sh --install-hook` makes git run it before every push.

The tests that need the character renderer look for the creator's TypeScript in `../anime-character-creator/ts/src` (or
`CREATOR_SRC`, which is that folder) and skip with a message if it is missing. No Python is needed to run them.

## Good first changes

- New or better emotions in `emotions.json` (the brows are subtle, so lids and mouth matter)
- Persona tweaks in `persona.md`
- A new provider behind `src/providers/types.ts` (Ollama, others)
- Bugs and rough edges you hit while using it

## Things to keep

- **Local only:** the server binds to `127.0.0.1`. Please do not add anything that serves other
  people or handles Claude credentials; see "Using it with your Claude account" in the README.
- **No telemetry:** nothing phones home.
- Changes to the character drawing itself belong in
  [anime-character-creator](https://github.com/rhedak/anime-character-creator), which has its
  own conventions in its `CLAUDE.md`.

Thank you!
