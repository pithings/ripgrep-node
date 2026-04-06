#!/usr/bin/env node

try {
  const { enableCompileCache } = await import("node:module");
  enableCompileCache?.();
} catch {
  // Some Node-compatible hosts implement enough ESM to run us but not enough
  // of Node's module compile cache internals to make this safe.
}

const { ripgrep } = await import("./index.mjs");
let argv = process.argv.slice(2);
const { code } = await ripgrep(argv);
process.exit(code ?? 0);
