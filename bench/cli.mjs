// Bench: native rg binary vs node CLI wrapper (cold-start)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { bench, boxplot, run } from "mitata";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const nativeBin = resolve(root, "dist/rg-aarch64-apple-darwin");
const nodeCli = resolve(root, "lib/rg.mjs");
const searchDir = resolve(root, "vendor/ripgrep/crates");
const pattern = "fn main";
const rgArgs = [pattern, searchDir, "--no-config"];

boxplot(() => {
  bench("native `rg`", () => {
    try {
      execFileSync(nativeBin, rgArgs, { stdio: ["pipe", "pipe", "pipe"] });
    } catch {}
  });

  bench("`node lib/rg.mjs`", () => {
    try {
      execFileSync("node", [nodeCli, ...rgArgs], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {}
  });
});

await run();
