#!/usr/bin/env node

import { main } from "../lib/cli.js";

main().catch((error) => {
  console.error(`dependency-guard: ${error.message}`);
  process.exitCode = 2;
});
