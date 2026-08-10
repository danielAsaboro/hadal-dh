#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

// Keep managed-mode process spawning independent of package-manager bin-link
// permissions while still executing the official QVAC CLI implementation.
// The AI SDK provider generates a models-only temporary config and passes it to
// the CLI. Merge our bounded registry retry policy into that private file so a
// multi-gigabyte managed download receives the same fail-loud behavior.
const configFlag = process.argv.findIndex((value) => value === "--config" || value === "-c");
const configPath = configFlag < 0 ? undefined : process.argv[configFlag + 1];
if (configPath !== undefined) {
  const generated = JSON.parse(readFileSync(configPath, "utf8"));
  const runtime = JSON.parse(readFileSync(new URL("../qvac.config.json", import.meta.url), "utf8"));
  writeFileSync(configPath, `${JSON.stringify({ ...runtime, ...generated }, null, 2)}\n`, "utf8");
}
await import("@qvac/cli");
