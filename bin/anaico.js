#!/usr/bin/env node
// The `anaico` command. A thin JavaScript launcher so that an old Node says what is wrong (see check-node.js) before the
// TypeScript starts; everything else is in src/cli.ts.
import "./check-node.js";
await import("../src/cli.ts");
