import { fileURLToPath } from "node:url";

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

  const wasi = await createWasiRuntime({
    args,
    env,
    nodeWasi,
    preopens,
    returnOnExit,
  });

  const wasm = await getRgWasmModule();
  const instance = await WebAssembly.instantiate(wasm, wasi.imports);
  const code = await wasi.start(instance);
  return { code };
}

// Compiling the wasm module is expensive; cache it so repeated `ripgrep` calls
// only pay the cost once. Instances are still created per-call since they're
// stateful (own memory, wasi context, etc).
let rgWasmModulePromise;
function getRgWasmModule() {
  if (!rgWasmModulePromise) {
    rgWasmModulePromise = import("./_rg.wasm.mjs").then(({ getRgWasmBytes }) =>
      WebAssembly.compile(getRgWasmBytes()),
    );
  }
  return rgWasmModulePromise;
}

function getDefaultNodeWasi() {
  if (process.env.ZIGREP_NODE_WASI === "1") return true;
  if (process.env.ZIGREP_NODE_WASI === "0") return false;
  return !("Bun" in globalThis) && !("Deno" in globalThis);
}

async function createWasiRuntime({
  args,
  env,
  nodeWasi,
  preopens,
  returnOnExit,
}) {
  const config = { args, env, preopens, returnOnExit };
  if (!nodeWasi) return createWasiShim(config);

  try {
    return await createNodeWasi(config);
  } catch {
    // Browser-hosted Node environments can expose `node:wasi` but still fail
    // at construction or start-up. Fall back to the portable JS shim.
    return createWasiShim(config);
  }
}

// Custom WASI preview1 shim (see `_wasi.mjs`). Lazy-imported so consumers
// that only touch `rgPath` don't pay for loading it.
async function createWasiShim({ args, env, preopens, returnOnExit }) {
  const { createWasi } = await import("./_wasi.mjs");
  return createWasi({ args: ["rg", ...args], env, preopens, returnOnExit });
}

// Thin adapter over Node's built-in `node:wasi` (https://nodejs.org/api/wasi.html)
// so it plugs into the same `{ imports, start }` shape as the custom shim.
async function createNodeWasi({ args, env, preopens, returnOnExit }) {
  const prev = process.emitWarning;
  process.emitWarning = () => {};
  const { WASI } = await import("node:wasi");
  process.emitWarning = prev;
  const wasi = new WASI({
    version: "preview1",
    args: ["rg", ...args],
    env,
    preopens,
    returnOnExit,
  });
  return {
    imports: wasi.getImportObject(),
    start: (instance) => wasi.start(instance) ?? 0,
  };
}
