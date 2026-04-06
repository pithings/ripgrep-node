/**
 * Known ripgrep CLI flags (long + short forms). Used to power
 * autocomplete for {@link ripgrep} arguments — any string is still
 * accepted (values, patterns, paths, unknown flags).
 */
// prettier-ignore
export type RgFlag =
  | "--after-context" | "--auto-hybrid-regex" | "--before-context" | "--binary"
  | "--block-buffered" | "--byte-offset" | "--case-sensitive" | "--color"
  | "--colors" | "--column" | "--context" | "--context-separator" | "--count"
  | "--count-matches" | "--crlf" | "--debug" | "--dfa-size-limit" | "--encoding"
  | "--engine" | "--field-context-separator" | "--field-match-separator"
  | "--file" | "--files" | "--files-without-match" | "--fixed-strings"
  | "--follow" | "--glob" | "--glob-case-insensitive" | "--heading" | "--help"
  | "--hidden" | "--hostname-bin" | "--hyperlink-format" | "--iglob" | "--ignore"
  | "--ignore-case" | "--ignore-dot" | "--ignore-exclude" | "--ignore-file"
  | "--ignore-file-case-insensitive" | "--ignore-files" | "--ignore-global"
  | "--ignore-parent" | "--ignore-vcs" | "--include-zero" | "--invert-match"
  | "--json" | "--line-buffered" | "--line-number" | "--line-regexp"
  | "--max-columns" | "--max-columns-preview" | "--max-count" | "--max-depth"
  | "--max-filesize" | "--maxdepth" | "--mmap" | "--multiline" | "--multiline-dotall"
  | "--no-auto-hybrid-regex" | "--no-binary" | "--no-block-buffered" | "--no-byte-offset"
  | "--no-column" | "--no-context-separator" | "--no-crlf" | "--no-encoding"
  | "--no-filename" | "--no-fixed-strings" | "--no-follow" | "--no-glob-case-insensitive"
  | "--no-heading" | "--no-hidden" | "--no-ignore" | "--no-ignore-dot"
  | "--no-ignore-exclude" | "--no-ignore-file-case-insensitive" | "--no-ignore-files"
  | "--no-ignore-global" | "--no-ignore-parent" | "--no-ignore-vcs" | "--no-include-zero"
  | "--no-invert-match" | "--no-line-buffered" | "--no-line-number"
  | "--no-max-columns-preview" | "--no-messages" | "--no-mmap" | "--no-multiline"
  | "--no-multiline-dotall" | "--no-one-file-system" | "--no-pcre2" | "--no-pcre2-unicode"
  | "--no-pre" | "--no-require-git" | "--no-search-zip" | "--no-sort-files" | "--no-text"
  | "--no-trim" | "--no-unicode" | "--null" | "--null-data" | "--one-file-system"
  | "--only-matching" | "--passthrough" | "--passthru" | "--path-separator" | "--pcre2"
  | "--pcre2-unicode" | "--pre" | "--pre-glob" | "--pretty" | "--print0" | "--quiet"
  | "--regex-size-limit" | "--regexp" | "--replace" | "--require-git" | "--search-zip"
  | "--smart-case" | "--sort" | "--sort-files" | "--sortr" | "--stop-on-nonmatch"
  | "--text" | "--threads" | "--trim" | "--type" | "--type-add" | "--type-clear"
  | "--type-list" | "--type-not" | "--unicode" | "--unrestricted" | "--version"
  | "--vimgrep" | "--with-filename" | "--word-regexp"
  | "-A" | "-B" | "-C" | "-E" | "-F" | "-H" | "-I" | "-L" | "-M" | "-N" | "-P"
  | "-R" | "-S" | "-T" | "-U"
  | "-a" | "-b" | "-c" | "-d" | "-e" | "-f" | "-g" | "-h" | "-i" | "-j" | "-l"
  | "-m" | "-n" | "-o" | "-p" | "-q" | "-r" | "-s" | "-t" | "-u" | "-v" | "-w"
  | "-x" | "-z";

/**
 * An argument to {@link ripgrep}: a known ripgrep flag (autocompleted)
 * or any other string (value, pattern, path, `--flag=value`, etc).
 */
export type RgArg = RgFlag | (string & {});

/**
 * Virtual filesystem interface for the custom WASI shim.
 * All methods mirror their `node:fs` equivalents. Only the methods
 * ripgrep actually calls need to be implemented — missing methods
 * fall back to the real `node:fs`.
 */
export interface RipgrepVfs {
  openSync?(path: string, flags: number): number;
  closeSync?(fd: number): void;
  readSync?(
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ): number;
  writeSync?(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): number;
  fstatSync?(fd: number, options?: { bigint?: boolean }): any;
  statSync?(path: string, options?: { bigint?: boolean }): any;
  lstatSync?(path: string, options?: { bigint?: boolean }): any;
  readdirSync?(path: string, options?: { withFileTypes?: boolean }): any[];
  readlinkSync?(path: string): string;
}

/**
 * Options for {@link ripgrep}.
 */
export interface ripgrepOptions {
  /**
   * Writable stream to use for stdout instead of `process.stdout`.
   * When provided, TTY auto-detection for `--color=ansi` is skipped.
   * With `nodeWasi`, only streams with a numeric `fd` property are supported.
   */
  stdout?: { write(chunk: Uint8Array | Buffer): unknown; fd?: number };

  /**
   * Writable stream to use for stderr instead of `process.stderr`.
   * With `nodeWasi`, only streams with a numeric `fd` property are supported.
   */
  stderr?: { write(chunk: Uint8Array | Buffer): unknown; fd?: number };

  /**
   * When `true`, buffer stdout and stderr and return them as strings
   * in the result object (`stdout` and `stderr` fields).
   * If custom `stdout`/`stderr` streams are also provided, those take
   * precedence and the corresponding field won't be buffered.
   * @default false
   */
  buffer?: boolean;

  /**
   * Environment variables passed to the WASI instance.
   * @default process.env
   */
  env?: Record<string, string | undefined>;

  /**
   * WASI preopened directories, mapping guest paths to host paths.
   * Required for ripgrep to see any files on disk.
   * @default { ".": process.cwd() }
   */
  preopens?: Record<string, string>;

  /**
   * When `true`, WASI `proc_exit` returns the exit code from `start()`
   * instead of terminating the Node process.
   * @default true
   */
  returnOnExit?: boolean;

  /**
   * Use Node's built-in `node:wasi` module instead of the bundled
   * custom WASI shim. Also enabled via `RIPGREP_NODE_WASI=1`.
   * @default false
   */
  nodeWasi?: boolean;

  /**
   * Custom virtual filesystem for the WASI shim. When provided, the
   * custom WASI shim is always used (regardless of `nodeWasi`).
   * Only the methods ripgrep calls need to be implemented — missing
   * methods fall back to the real `node:fs`.
   */
  vfs?: RipgrepVfs;
}

/**
 * Result of a ripgrep invocation.
 */
export interface RipgrepResult {
  /** Exit code: 0 = matches found, 1 = no matches, 2 = error. */
  code: number;
}

/**
 * Result of a buffered ripgrep invocation (`buffer: true`).
 */
export interface RipgrepBufferedResult extends RipgrepResult {
  /** Captured stdout output (unless a custom `stdout` stream was provided). */
  stdout: string;
  /** Captured stderr output (unless a custom `stderr` stream was provided). */
  stderr: string;
}

/**
 * Run ripgrep (compiled to `wasm32-wasip1`) with the given CLI arguments.
 *
 * Returns the ripgrep exit code (0 = matches found, 1 = no matches,
 * 2 = error), matching the native `rg` binary.
 *
 * @example
 * ```js
 * import { ripgrep } from "ripgrep";
 * const { code } = await ripgrep(["--json", "TODO", "src"]);
 * ```
 *
 * @example
 * ```js
 * import { ripgrep } from "ripgrep";
 * const { code, stdout } = await ripgrep(["TODO", "src"], { buffer: true });
 * ```
 */
export function ripgrep(
  args?: readonly RgArg[],
  options?: ripgrepOptions & { buffer: true },
): Promise<RipgrepBufferedResult>;
export function ripgrep(args?: readonly RgArg[], options?: ripgrepOptions): Promise<RipgrepResult>;

/**
 * Absolute filesystem path to a JS shim that runs ripgrep via `ripgrep`.
 * Useful for tools that expect an `rgPath`-style binary path (e.g.
 * `vscode-ripgrep`-compatible consumers).
 */
export const rgPath: string;
