import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";

export const rgPath = fileURLToPath(new URL("./rg.mjs", import.meta.url));

export async function ripgrep(args = [], options = {}) {
  let {
    stdout,
    stderr,
    buffer = false,
    env = process.env,
    preopens = { ".": process.cwd() },
    returnOnExit = true,
    nodeWasi = getDefaultNodeWasi(),
    vfs,
  } = options;

  let stdoutChunks, stderrChunks;
  if (buffer && !stdout) {
    stdoutChunks = [];
    stdout = { write: (c) => stdoutChunks.push(Buffer.from(c)) };
  }
  if (buffer && !stderr) {
    stderrChunks = [];
    stderr = { write: (c) => stderrChunks.push(Buffer.from(c)) };
  }

  // ripgrep's TTY auto-detection doesn't work through WASI preview1, so it
  // defaults to --color=never. If the host stdout is a TTY and the caller
  // hasn't picked a color mode themselves, force ANSI colors on.
  // When a custom stdout is provided, skip TTY auto-detection (assume non-TTY).
  const hasColorFlag = args.some(
    (a) => a === "--color" || a.startsWith("--color=") || a === "--no-color",
  );
  if (!hasColorFlag && !stdout && process.stdout.isTTY) {
    args = ["--color=ansi", ...args];
  }

  // Auto-add preopens for absolute paths found in args so they're accessible without requiring the caller to manually configure preopens.
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
    stdout,
    stderr,
    env,
    nodeWasi,
    preopens: resolvedPreopens,
    returnOnExit,
    vfs,
  });

  const wasm = await getRgWasmModule();
  const instance = await WebAssembly.instantiate(wasm, wasi.imports);
  const code = await wasi.start(instance);
  const result = { code };
  if (stdoutChunks) result.stdout = Buffer.concat(stdoutChunks).toString();
  if (stderrChunks) result.stderr = Buffer.concat(stderrChunks).toString();
  return result;
}

function getDefaultNodeWasi() {
  if (process.env.RIPGREP_NODE_WASI === "1") return true;
  if (process.env.RIPGREP_NODE_WASI === "0") return false;
  return !("Bun" in globalThis) && !("Deno" in globalThis);
}
