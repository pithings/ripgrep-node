// Bench: exec native rg vs programmatic ripgrep() API
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { bench, boxplot, run } from "mitata";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const nativeBin = resolve(root, "dist/rg-aarch64-apple-darwin");
const searchDir = resolve(root, "vendor/ripgrep/crates");
const pattern = "fn main";
const rgArgs = [pattern, searchDir, "--no-config"];

// Suppress stdout helper (rg writes to process.stdout via WASI fd_write)
const _stdoutWrite = process.stdout.write.bind(process.stdout);
const muteStdout = () => { process.stdout.write = () => true; };
const unmuteStdout = () => { process.stdout.write = _stdoutWrite; };

// Pre-import and warm up wasm module
const { ripgrep } = await import("../lib/index.mjs");
muteStdout();
await ripgrep(["--version"], { preopens: { ".": "/" }, nodeWasi: false });
unmuteStdout();

boxplot(() => {
  bench("`exec(rg)` native", () => {
    try {
      execFileSync(nativeBin, rgArgs, { stdio: ["pipe", "pipe", "pipe"] });
    } catch {}
  });

  bench("`ripgrep()` API", async () => {
    muteStdout();
    await ripgrep(rgArgs, { preopens: { ".": "/" }, nodeWasi: false });
    unmuteStdout();
  });
});

await run();
