import { describe, it, expect } from "vitest";
import { ripgrep, rgPath } from "../lib/index.mjs";
import * as fs from "node:fs";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const FIXTURE = "test/fixture/";
const HELLO = "test/fixture/hello.txt";

describe("ripgrep", () => {
  it("returns code 0 on match", async () => {
    const res = await ripgrep(["hello", HELLO], { buffer: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("hello ripgrep world");
  });

  it("returns code 1 on no match", async () => {
    const res = await ripgrep(["__NOMATCH_zzz__", HELLO], {
      buffer: true,
    });
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("");
  });

  it("returns code 2 on error", async () => {
    const res = await ripgrep(["--bad-flag"], { buffer: true });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("unrecognized flag");
  });

  it("captures stderr separately from stdout", async () => {
    const res = await ripgrep(["hello", HELLO, "__noexist__"], {
      buffer: true,
    });
    expect(res.stdout).toContain("hello ripgrep world");
    expect(res.stderr).toContain("__noexist__");
  });

  it("supports custom stdout stream", async () => {
    const chunks = [];
    const stdout = { write: (c) => chunks.push(Buffer.from(c)) };
    const res = await ripgrep(["hello", HELLO], { stdout });
    expect(res.code).toBe(0);
    expect(res.stdout).toBeUndefined();
    expect(Buffer.concat(chunks).toString()).toContain("hello ripgrep world");
  });

  it("supports custom stderr stream", async () => {
    const chunks = [];
    const stderr = { write: (c) => chunks.push(Buffer.from(c)) };
    const res = await ripgrep(["--bad-flag"], { stderr });
    expect(res.code).toBe(2);
    expect(res.stderr).toBeUndefined();
    expect(Buffer.concat(chunks).toString()).toContain("unrecognized flag");
  });

  it("buffer does not override custom stdout/stderr streams", async () => {
    const outChunks = [];
    const stdout = { write: (c) => outChunks.push(Buffer.from(c)) };
    const res = await ripgrep(["hello", HELLO], {
      buffer: true,
      stdout,
    });
    expect(res.code).toBe(0);
    // Custom stream captures stdout; buffer field is absent
    expect(res.stdout).toBeUndefined();
    expect(Buffer.concat(outChunks).toString()).toContain("hello ripgrep world");
    // stderr still buffered since no custom stderr provided
    expect(res.stderr).toBe("");
  });

  it("searches with absolute path", async () => {
    const abs = process.cwd() + "/" + HELLO;
    const res = await ripgrep(["hello", abs], { buffer: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("hello ripgrep world");
  });

  it("passes --version", async () => {
    const res = await ripgrep(["--version"], { buffer: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/^ripgrep \d+/);
  });

  it("respects custom env", async () => {
    const res = await ripgrep(["--version"], { buffer: true, env: {} });
    expect(res.code).toBe(0);
  });

  it("searches a directory recursively", async () => {
    const res = await ripgrep(["hello", FIXTURE], { buffer: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("hello ripgrep world");
  });

  it("searches nested subdirectories", async () => {
    const res = await ripgrep(["foo", FIXTURE], { buffer: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("foo bar baz");
  });

  it("follows symlinks in fixture", async () => {
    const res = await ripgrep(["--follow", "hello", "test/fixture/link.txt"], { buffer: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("hello ripgrep world");
  });

  it("lists files with --files", async () => {
    const res = await ripgrep(["--files", FIXTURE], { buffer: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("hello.txt");
    expect(res.stdout).toContain("nested.txt");
  });

  it("searches with --count", async () => {
    const res = await ripgrep(["--count", "hello", HELLO], {
      buffer: true,
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/\d+/);
  });

  it("uses custom wasi shim with nodeWasi: false", async () => {
    const res = await ripgrep(["--version"], {
      buffer: true,
      nodeWasi: false,
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/^ripgrep \d+/);
  });

  it("searches with explicit --color=never", async () => {
    const res = await ripgrep(["--color=never", "hello", HELLO], {
      buffer: true,
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("hello ripgrep world");
  });
});

describe("ripgrep (vfs)", () => {
  it("searches using a custom vfs", async () => {
    const virtualFiles = {
      "/vfs/hello.txt": "hello from virtual filesystem\n",
    };
    const vfs = {
      readdirSync(dirPath, opts) {
        if (dirPath in virtualDirs()) {
          const entries = virtualDirs()[dirPath];
          if (opts?.withFileTypes) {
            return entries.map((name) => ({
              name,
              isFile: () => !name.endsWith("/"),
              isDirectory: () => name.endsWith("/"),
              isSymbolicLink: () => false,
              isBlockDevice: () => false,
              isCharacterDevice: () => false,
            }));
          }
          return entries;
        }
        return fs.readdirSync(dirPath, opts);
      },
      statSync(filePath, opts) {
        if (filePath in virtualFiles) {
          const size = Buffer.byteLength(virtualFiles[filePath]);
          const s = {
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            dev: opts?.bigint ? 0n : 0,
            ino: opts?.bigint ? 0n : 0,
            nlink: opts?.bigint ? 1n : 1,
            size: opts?.bigint ? BigInt(size) : size,
            atimeNs: opts?.bigint ? 0n : undefined,
            mtimeNs: opts?.bigint ? 0n : undefined,
            ctimeNs: opts?.bigint ? 0n : undefined,
          };
          return s;
        }
        if (filePath === "/vfs") {
          return {
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            dev: opts?.bigint ? 0n : 0,
            ino: opts?.bigint ? 0n : 0,
            nlink: opts?.bigint ? 1n : 1,
            size: opts?.bigint ? 0n : 0,
            atimeNs: opts?.bigint ? 0n : undefined,
            mtimeNs: opts?.bigint ? 0n : undefined,
            ctimeNs: opts?.bigint ? 0n : undefined,
          };
        }
        return fs.statSync(filePath, opts);
      },
      lstatSync(filePath, opts) {
        return this.statSync(filePath, opts);
      },
      openSync(filePath, flags) {
        if (filePath in virtualFiles) {
          // Use a high fd number to avoid collisions
          const fd = 1000 + Object.keys(virtualFiles).indexOf(filePath);
          vfs._openFiles = vfs._openFiles || {};
          vfs._openFiles[fd] = { path: filePath, pos: 0 };
          return fd;
        }
        return fs.openSync(filePath, flags);
      },
      closeSync(fd) {
        if (vfs._openFiles?.[fd]) {
          delete vfs._openFiles[fd];
          return;
        }
        return fs.closeSync(fd);
      },
      readSync(fd, buffer, offset, length, position) {
        if (vfs._openFiles?.[fd]) {
          const f = vfs._openFiles[fd];
          const content = Buffer.from(virtualFiles[f.path]);
          const pos = position != null ? position : f.pos;
          const n = Math.min(length, content.length - pos);
          if (n <= 0) return 0;
          content.copy(buffer, offset, pos, pos + n);
          f.pos = pos + n;
          return n;
        }
        return fs.readSync(fd, buffer, offset, length, position);
      },
      fstatSync(fd, opts) {
        if (vfs._openFiles?.[fd]) {
          return this.statSync(vfs._openFiles[fd].path, opts);
        }
        return fs.fstatSync(fd, opts);
      },
    };

    function virtualDirs() {
      return { "/vfs": ["hello.txt"] };
    }

    const res = await ripgrep(["hello", "/vfs"], {
      buffer: true,
      preopens: { "/vfs": "/vfs" },
      vfs,
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("hello from virtual filesystem");
  });

  it("falls back to real fs for methods not on vfs", async () => {
    const calls = [];
    const vfs = {
      statSync(filePath, opts) {
        calls.push(filePath);
        return fs.statSync(filePath, opts);
      },
    };
    const res = await ripgrep(["hello", HELLO], { buffer: true, vfs });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("hello ripgrep world");
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("ripgrep (non-buffered)", () => {
  it("returns code without stdout/stderr fields", async () => {
    const res = await ripgrep(["hello", HELLO]);
    expect(res.code).toBe(0);
    expect(res.stdout).toBeUndefined();
    expect(res.stderr).toBeUndefined();
  });

  it("returns code 1 on no match without stdout/stderr fields", async () => {
    const res = await ripgrep(["__NOMATCH_zzz__", HELLO]);
    expect(res.code).toBe(1);
    expect(res.stdout).toBeUndefined();
    expect(res.stderr).toBeUndefined();
  });

  it("returns code 2 on error without stdout/stderr fields", async () => {
    const res = await ripgrep(["--bad-flag"]);
    expect(res.code).toBe(2);
    expect(res.stdout).toBeUndefined();
    expect(res.stderr).toBeUndefined();
  });
});

describe("rgPath", () => {
  it("points to an existing file", () => {
    expect(existsSync(rgPath)).toBe(true);
  });

  it("ends with rg.mjs", () => {
    expect(rgPath).toMatch(/rg\.mjs$/);
  });
});

describe("rgPath exec", () => {
  it("runs ripgrep via spawn", async () => {
    const { code, stdout } = await execRgPath(["--version"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^ripgrep \d+/);
  });

  it("finds matches via spawn", async () => {
    const { code, stdout } = await execRgPath(["hello", HELLO]);
    expect(code).toBe(0);
    expect(stdout).toContain("hello ripgrep world");
  });

  it("exits 1 on no match via spawn", async () => {
    const { code } = await execRgPath(["__NOMATCH_zzz__", HELLO]);
    expect(code).toBe(1);
  });

  it("exits 2 on error via spawn", async () => {
    const { code, stderr } = await execRgPath(["--bad-flag"]);
    expect(code).toBe(2);
    expect(stderr).toContain("unrecognized flag");
  });

  it("handles absolute paths via spawn", async () => {
    const abs = process.cwd() + "/" + HELLO;
    const { code, stdout } = await execRgPath(["hello", abs]);
    expect(code).toBe(0);
    expect(stdout).toContain("hello ripgrep world");
  });
});

function execRgPath(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [rgPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(out).toString(),
        stderr: Buffer.concat(err).toString(),
      });
    });
  });
}
