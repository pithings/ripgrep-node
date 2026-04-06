# ripgrep-node

[ripgrep](https://github.com/BurntSushi/ripgrep) in a compact and cross-platform npm package. Works with Node.js, Bun, and Deno without native binaries. Bundler-friendly, with the WASM embedded as z85+brotli.

## CLI

```sh
npx ripgrep TODO src/

# or install globally
npm i -g ripgrep
rg TODO src/
```

## Programmatic API

```js
import { ripgrep, rgPath } from "ripgrep";

// Run ripgrep programmatically
const { code } = await ripgrep(["--json", "TODO", "src"]);
// 0 = matches found, 1 = no matches, 2 = error

// Or spawn as a child process (drop-in for vscode-ripgrep)
import { spawn } from "node:child_process";
spawn(rgPath, ["TODO", "src"], { stdio: "inherit" });
```

### `ripgrep(args, options)`

Runs ripgrep with the given CLI arguments and returns a `{ code }` result object. Output is written to the host's `process.stdout` / `process.stderr`.

Options:

- `env` — environment variables passed to the WASI instance (default: `process.env`).
- `preopens` — WASI preopened directories mapping guest paths to host paths (default: `{ ".": process.cwd() }`). Absolute paths passed as args are auto-added as preopens.
- `returnOnExit` — when `true`, `proc_exit` returns the exit code instead of terminating the process (default: `true`).
- `nodeWasi` — use Node's built-in `node:wasi` instead of the bundled WASI shim. Enabled by default on Node.js for best performance; automatically disabled on Bun and Deno where `node:wasi` is not available, falling back to the bundled shim. Can also be forced on via `RIPGREP_NODE_WASI=1`.

### `rgPath`

Absolute filesystem path to a JS shim that runs ripgrep via `ripgrep`. Drop-in replacement for `rgPath` from `vscode-ripgrep` / `@vscode/ripgrep`-style consumers that spawn the binary directly.

## How it works

- ripgrep is cross-compiled to `wasm32-wasip1` with SIMD (`simd128`) enabled via [`cargo zigbuild`](https://github.com/rust-cross/cargo-zigbuild), using Zig as the C compiler/linker. This unlocks `memchr`'s vectorized search routines for faster byte scanning.
- The resulting `.wasm` is brotli-compressed and z85-encoded into `lib/_rg.wasm.mjs`, so it ships as a plain ESM module — no `.wasm` asset resolution or postinstall needed.
- On first use, the z85 blob is decoded and decompressed, then cached to the OS temp directory (`$TMPDIR/ripgrep-wasm-<hash>.wasm`). Subsequent calls (even across processes) skip decoding entirely. The z85 string itself is wrapped in a function so V8 lazy-parses it only when needed.
- The compiled `WebAssembly.Module` is memoized in-process — repeated `ripgrep()` calls only pay the compilation cost once. Fresh instances are still created per-call since WASI state (memory, file descriptors) is per-instance.
- A minimal WASI preview1 shim (`lib/_wasi.mjs`, ~20 syscalls, backed by `node:fs`) instantiates the module. Works uniformly on Node, Bun, and Deno.
- ripgrep's TTY color detection doesn't survive the WASI boundary, so `ripgrep()` auto-injects `--color=ansi` when the host stdout is a TTY and the caller hasn't picked a color mode.

## Building from source

Requirements:

- `zig` (tested with 0.15.2)
- `rustc` + `cargo` (tested with 1.90.0)
- [`cargo-zigbuild`](https://github.com/rust-cross/cargo-zigbuild): `cargo install cargo-zigbuild`
- `rustup target add wasm32-wasip1`

Then:

```sh
git submodule update --init --recursive
zig build           # → dist/rg-wasm32-wasip1.wasm
node build.ts       # inline wasm into lib/_rg.wasm.mjs
```

Native cross-compiled binaries (macOS / Linux / Windows) are also available via `zig build native`, but they are not part of the published npm package — WASI is the only shipped flavor.

## License

MIT. ripgrep itself is licensed under MIT / Unlicense by its authors — see [vendor/ripgrep](vendor/ripgrep).
