import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";

export const rgPath = fileURLToPath(new URL("./rg.mjs", import.meta.url));

export async function ripgrep(args = [], options = {}) {
  const {
    env = process.env,
    preopens = { ".": process.cwd() },
    returnOnExit = true,
    nodeWasi = getDefaultNodeWasi(),
  } = options;

  // ripgrep's TTY auto-detection doesn't work through WASI preview1, so it
  // defaults to --color=never. If the host stdout is a TTY and the caller
  // hasn't picked a color mode themselves, force ANSI colors on.
  const hasColorFlag = args.some(
    (a) => a === "--color" || a.startsWith("--color=") || a === "--no-color",
  );
  if (!hasColorFlag && process.stdout.isTTY) {
    args = ["--color=ansi", ...args];
  }

  // Auto-add preopens for absolute paths found in args so they're accessible
  // without requiring the caller to manually configure preopens.
  const resolvedPreopens = { ...preopens };
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    const absPath = isAbsolute(arg) ? arg : resolve(arg);
    if (!(absPath in resolvedPreopens)) {
      resolvedPreopens[absPath] = absPath;
    }
  }

  const { getRgWasmModule, createWasiRuntime } = await import("./_rg.mjs");

  const wasi = await createWasiRuntime({
    args,
    env,
    nodeWasi,
    preopens: resolvedPreopens,
    returnOnExit,
  });

  const wasm = await getRgWasmModule();
  const instance = await WebAssembly.instantiate(wasm, wasi.imports);
  const code = await wasi.start(instance);
  return { code };
}

function getDefaultNodeWasi() {
  if (process.env.RIPGREP_NODE_WASI === "1") return true;
  if (process.env.RIPGREP_NODE_WASI === "0") return false;
  return !("Bun" in globalThis) && !("Deno" in globalThis);
}
