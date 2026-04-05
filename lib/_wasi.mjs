// Minimal WASI preview1 shim implementing only the ~21 functions ripgrep imports.
// Backed by `node:fs` sync APIs, so it works on Node, Bun, and Deno uniformly.

import * as fs from "node:fs";
import * as path from "node:path";
import { randomFillSync } from "node:crypto";

// Errno (subset used here; full table at
// https://github.com/WebAssembly/WASI/blob/main/legacy/preview1/docs.md)
const E = {
  SUCCESS: 0,
  ACCES: 2,
  BADF: 8,
  EXIST: 20,
  INVAL: 28,
  IO: 29,
  ISDIR: 31,
  NAMETOOLONG: 37,
  NOENT: 44,
  NOSYS: 52,
  NOTDIR: 54,
  NOTSUP: 58,
};

// Filetype enum
const FT = {
  UNKNOWN: 0,
  BLOCK_DEVICE: 1,
  CHARACTER_DEVICE: 2,
  DIRECTORY: 3,
  REGULAR_FILE: 4,
  SYMBOLIC_LINK: 7,
};

const PREOPENTYPE_DIR = 0;
const OFLAGS_CREAT = 1;
const OFLAGS_DIRECTORY = 2;
const OFLAGS_EXCL = 4;
const OFLAGS_TRUNC = 8;
const FDFLAGS_APPEND = 1;
const RIGHTS_FD_READ = 1n << 1n;
const RIGHTS_FD_WRITE = 1n << 6n;

class WASIExit extends Error {
  constructor(code) {
    super(`wasi exit: ${code}`);
    this.code = code;
  }
}

export function createWasi({ args, env, preopens, returnOnExit = true } = {}) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const argBytes = args.map((a) => enc.encode(a + "\0"));
  const envBytes = Object.entries(env)
    .filter(([, v]) => v != null)
    .map(([k, v]) => enc.encode(`${k}=${v}\0`));

  // fds: 0/1/2 = stdio, 3+ = preopens, then files/dirs opened at runtime.
  const fds = [
    { type: "stdio", which: 0 },
    { type: "stdio", which: 1 },
    { type: "stdio", which: 2 },
  ];
  for (const [name, hostPath] of Object.entries(preopens)) {
    fds.push({
      type: "dir",
      hostPath: path.resolve(hostPath),
      preopenName: name,
    });
  }

  let memory;
  const dv = () => new DataView(memory.buffer);
  const u8 = () => new Uint8Array(memory.buffer);

  const imports = {
    proc_exit(code) {
      throw new WASIExit(code);
    },
    sched_yield() {
      return E.SUCCESS;
    },
    poll_oneoff(_in, _out, _n, _neventsOut) {
      // ripgrep doesn't actually need this for file search; stub it.
      return E.NOTSUP;
    },

    args_sizes_get(argcPtr, bufSizePtr) {
      const v = dv();
      v.setUint32(argcPtr, argBytes.length, true);
      v.setUint32(
        bufSizePtr,
        argBytes.reduce((s, b) => s + b.length, 0),
        true,
      );
      return E.SUCCESS;
    },
    args_get(argvPtr, argvBufPtr) {
      const v = dv();
      const mem = u8();
      for (const b of argBytes) {
        v.setUint32(argvPtr, argvBufPtr, true);
        argvPtr += 4;
        mem.set(b, argvBufPtr);
        argvBufPtr += b.length;
      }
      return E.SUCCESS;
    },
    environ_sizes_get(countPtr, bufSizePtr) {
      const v = dv();
      v.setUint32(countPtr, envBytes.length, true);
      v.setUint32(
        bufSizePtr,
        envBytes.reduce((s, b) => s + b.length, 0),
        true,
      );
      return E.SUCCESS;
    },
    environ_get(environPtr, environBufPtr) {
      const v = dv();
      const mem = u8();
      for (const b of envBytes) {
        v.setUint32(environPtr, environBufPtr, true);
        environPtr += 4;
        mem.set(b, environBufPtr);
        environBufPtr += b.length;
      }
      return E.SUCCESS;
    },

    clock_time_get(id, _precision, timePtr) {
      let t;
      if (id === 0) {
        t = BigInt(Date.now()) * 1_000_000n;
      } else if (id === 1) {
        t = process.hrtime.bigint
          ? process.hrtime.bigint()
          : BigInt(Math.round(performance.now() * 1e6));
      } else {
        return E.INVAL;
      }
      dv().setBigUint64(timePtr, t, true);
      return E.SUCCESS;
    },
    random_get(bufPtr, bufLen) {
      randomFillSync(u8(), bufPtr, bufLen);
      return E.SUCCESS;
    },

    fd_read(fd, iovsPtr, iovsLen, nreadPtr) {
      const e = fds[fd];
      if (!e) return E.BADF;
      const v = dv();
      const mem = u8();
      try {
        let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          const bufPtr = v.getUint32(iovsPtr + i * 8, true);
          const bufLen = v.getUint32(iovsPtr + i * 8 + 4, true);
          let n = 0;
          if (e.type === "file") {
            const target = Buffer.from(
              mem.buffer,
              mem.byteOffset + bufPtr,
              bufLen,
            );
            n = fs.readSync(e.hostFd, target, 0, bufLen, null);
            e.pos += BigInt(n);
          } else if (e.type === "stdio" && e.which === 0) {
            // No stdin support (would need blocking read). Signal EOF.
            n = 0;
          } else {
            return E.BADF;
          }
          total += n;
          if (n < bufLen) break;
        }
        v.setUint32(nreadPtr, total, true);
        return E.SUCCESS;
      } catch (err) {
        return errno(err);
      }
    },
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
      const e = fds[fd];
      if (!e) return E.BADF;
      const v = dv();
      const mem = u8();
      try {
        let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          const bufPtr = v.getUint32(iovsPtr + i * 8, true);
          const bufLen = v.getUint32(iovsPtr + i * 8 + 4, true);
          const chunk = mem.subarray(bufPtr, bufPtr + bufLen);
          if (e.type === "stdio") {
            if (e.which === 1) process.stdout.write(Buffer.from(chunk));
            else if (e.which === 2) process.stderr.write(Buffer.from(chunk));
            else return E.BADF;
            total += bufLen;
          } else if (e.type === "file") {
            const n = fs.writeSync(e.hostFd, chunk, 0, bufLen, null);
            e.pos += BigInt(n);
            total += n;
            if (n < bufLen) break;
          } else {
            return E.BADF;
          }
        }
        v.setUint32(nwrittenPtr, total, true);
        return E.SUCCESS;
      } catch (err) {
        return errno(err);
      }
    },
    fd_close(fd) {
      const e = fds[fd];
      if (!e) return E.BADF;
      try {
        if (e.type === "file") fs.closeSync(e.hostFd);
        fds[fd] = undefined;
        return E.SUCCESS;
      } catch (err) {
        return errno(err);
      }
    },
    fd_tell(fd, offsetPtr) {
      const e = fds[fd];
      if (!e || e.type !== "file") return E.BADF;
      dv().setBigUint64(offsetPtr, e.pos, true);
      return E.SUCCESS;
    },
    fd_readdir(fd, bufPtr, bufLen, cookie, bufUsedPtr) {
      const e = fds[fd];
      if (!e || e.type !== "dir") return E.BADF;
      const v = dv();
      const mem = u8();
      try {
        if (!e.dirents) {
          const list = fs.readdirSync(e.hostPath, { withFileTypes: true });
          e.dirents = list.map((d) => ({
            name: d.name,
            nameBytes: enc.encode(d.name),
            type: direntType(d),
          }));
        }
        let used = 0;
        const HEAD = 24;
        for (let i = Number(cookie); i < e.dirents.length; i++) {
          const d = e.dirents[i];
          if (bufLen - used < HEAD) {
            used = bufLen;
            break;
          }
          v.setBigUint64(bufPtr + used + 0, BigInt(i + 1), true); // d_next
          v.setBigUint64(bufPtr + used + 8, 0n, true); // d_ino
          v.setUint32(bufPtr + used + 16, d.nameBytes.length, true); // d_namlen
          v.setUint8(bufPtr + used + 20, d.type); // d_type
          used += HEAD;
          const space = Math.min(d.nameBytes.length, bufLen - used);
          mem.set(d.nameBytes.subarray(0, space), bufPtr + used);
          used += space;
          if (space < d.nameBytes.length) {
            used = bufLen;
            break;
          }
        }
        v.setUint32(bufUsedPtr, used, true);
        return E.SUCCESS;
      } catch (err) {
        return errno(err);
      }
    },
    fd_filestat_get(fd, filestatPtr) {
      const e = fds[fd];
      if (!e) return E.BADF;
      try {
        if (e.type === "stdio") {
          writeFilestat(dv(), filestatPtr, {
            dev: 0n,
            ino: 0n,
            filetype: FT.CHARACTER_DEVICE,
            nlink: 1n,
            size: 0n,
            atim: 0n,
            mtim: 0n,
            ctim: 0n,
          });
          return E.SUCCESS;
        }
        const st =
          e.type === "file"
            ? fs.fstatSync(e.hostFd, { bigint: true })
            : fs.statSync(e.hostPath, { bigint: true });
        writeFilestat(dv(), filestatPtr, filestatFromNode(st));
        return E.SUCCESS;
      } catch (err) {
        return errno(err);
      }
    },
    fd_fdstat_set_flags(_fd, _flags) {
      return E.SUCCESS;
    },
    fd_fdstat_get(fd, fdstatPtr) {
      const e = fds[fd];
      if (!e) return E.BADF;
      const v = dv();
      let filetype = FT.UNKNOWN;
      if (e.type === "stdio") filetype = FT.CHARACTER_DEVICE;
      else if (e.type === "dir") filetype = FT.DIRECTORY;
      else if (e.type === "file") filetype = FT.REGULAR_FILE;
      v.setUint8(fdstatPtr + 0, filetype);
      v.setUint8(fdstatPtr + 1, 0);
      v.setUint16(fdstatPtr + 2, 0, true);
      v.setUint32(fdstatPtr + 4, 0, true);
      // Grant all rights — ripgrep only reads, so over-granting is harmless.
      v.setBigUint64(fdstatPtr + 8, ~0n, true);
      v.setBigUint64(fdstatPtr + 16, ~0n, true);
      return E.SUCCESS;
    },
    fd_prestat_get(fd, prestatPtr) {
      const e = fds[fd];
      if (!e || e.type !== "dir" || !e.preopenName) return E.BADF;
      const v = dv();
      v.setUint8(prestatPtr + 0, PREOPENTYPE_DIR);
      v.setUint32(prestatPtr + 4, enc.encode(e.preopenName).length, true);
      return E.SUCCESS;
    },
    fd_prestat_dir_name(fd, pathPtr, pathLen) {
      const e = fds[fd];
      if (!e || e.type !== "dir" || !e.preopenName) return E.BADF;
      const name = enc.encode(e.preopenName);
      if (name.length > pathLen) return E.NAMETOOLONG;
      u8().set(name, pathPtr);
      return E.SUCCESS;
    },

    path_open(
      dirfd,
      _dirflags,
      pathPtr,
      pathLen,
      oflags,
      fsRightsBase,
      _fsRightsInheriting,
      fdflags,
      openedFdPtr,
    ) {
      const e = fds[dirfd];
      if (!e || e.type !== "dir") return E.BADF;
      const v = dv();
      const relPath = dec.decode(u8().subarray(pathPtr, pathPtr + pathLen));
      const fullPath = path.resolve(e.hostPath, relPath);
      try {
        let st;
        try {
          st = fs.statSync(fullPath);
        } catch (err) {
          // Only swallow ENOENT when O_CREAT is set; propagate everything else.
          if (!(oflags & OFLAGS_CREAT) || err?.code !== "ENOENT")
            return errno(err);
        }
        if (st?.isDirectory()) {
          fds.push({ type: "dir", hostPath: fullPath });
          v.setUint32(openedFdPtr, fds.length - 1, true);
          return E.SUCCESS;
        }
        if (oflags & OFLAGS_DIRECTORY) return E.NOTDIR;

        let flags = 0;
        const canRead = (BigInt(fsRightsBase) & RIGHTS_FD_READ) !== 0n;
        const canWrite = (BigInt(fsRightsBase) & RIGHTS_FD_WRITE) !== 0n;
        if (canRead && canWrite) flags |= fs.constants.O_RDWR;
        else if (canWrite) flags |= fs.constants.O_WRONLY;
        else flags |= fs.constants.O_RDONLY;
        if (oflags & OFLAGS_CREAT) flags |= fs.constants.O_CREAT;
        if (oflags & OFLAGS_EXCL) flags |= fs.constants.O_EXCL;
        if (oflags & OFLAGS_TRUNC) flags |= fs.constants.O_TRUNC;
        if (fdflags & FDFLAGS_APPEND) flags |= fs.constants.O_APPEND;

        const hostFd = fs.openSync(fullPath, flags);
        fds.push({ type: "file", hostFd, pos: 0n });
        v.setUint32(openedFdPtr, fds.length - 1, true);
        return E.SUCCESS;
      } catch (err) {
        return errno(err);
      }
    },
    path_filestat_get(dirfd, flags, pathPtr, pathLen, filestatPtr) {
      const e = fds[dirfd];
      if (!e || e.type !== "dir") return E.BADF;
      const relPath = dec.decode(u8().subarray(pathPtr, pathPtr + pathLen));
      const fullPath = path.resolve(e.hostPath, relPath);
      try {
        // bit 0 of lookupflags = symlink_follow
        const follow = (flags & 1) !== 0;
        const st = follow
          ? fs.statSync(fullPath, { bigint: true })
          : fs.lstatSync(fullPath, { bigint: true });
        writeFilestat(dv(), filestatPtr, filestatFromNode(st));
        return E.SUCCESS;
      } catch (err) {
        return errno(err);
      }
    },
  };

  return {
    imports: { wasi_snapshot_preview1: imports },
    start(instance) {
      memory = instance.exports.memory;
      try {
        instance.exports._start();
        return 0;
      } catch (err) {
        if (err instanceof WASIExit) {
          if (returnOnExit) return err.code;
          throw err;
        }
        throw err;
      }
    },
  };
}

// --- internal helpers -------------------------------------------------------

function writeFilestat(v, ptr, s) {
  v.setBigUint64(ptr + 0, s.dev, true);
  v.setBigUint64(ptr + 8, s.ino, true);
  v.setUint8(ptr + 16, s.filetype);
  v.setBigUint64(ptr + 24, s.nlink, true);
  v.setBigUint64(ptr + 32, s.size, true);
  v.setBigUint64(ptr + 40, s.atim, true);
  v.setBigUint64(ptr + 48, s.mtim, true);
  v.setBigUint64(ptr + 56, s.ctim, true);
}

function filestatFromNode(st) {
  let filetype = FT.UNKNOWN;
  if (st.isFile()) filetype = FT.REGULAR_FILE;
  else if (st.isDirectory()) filetype = FT.DIRECTORY;
  else if (st.isSymbolicLink()) filetype = FT.SYMBOLIC_LINK;
  else if (st.isBlockDevice()) filetype = FT.BLOCK_DEVICE;
  else if (st.isCharacterDevice()) filetype = FT.CHARACTER_DEVICE;
  return {
    dev: BigInt(st.dev),
    ino: BigInt(st.ino),
    filetype,
    nlink: BigInt(st.nlink),
    size: BigInt(st.size),
    atim: BigInt(st.atimeNs ?? 0),
    mtim: BigInt(st.mtimeNs ?? 0),
    ctim: BigInt(st.ctimeNs ?? 0),
  };
}

function direntType(d) {
  if (d.isFile()) return FT.REGULAR_FILE;
  if (d.isDirectory()) return FT.DIRECTORY;
  if (d.isSymbolicLink()) return FT.SYMBOLIC_LINK;
  if (d.isBlockDevice()) return FT.BLOCK_DEVICE;
  if (d.isCharacterDevice()) return FT.CHARACTER_DEVICE;
  return FT.UNKNOWN;
}

function errno(err) {
  switch (err?.code) {
    case "ENOENT":
      return E.NOENT;
    case "EBADF":
      return E.BADF;
    case "EACCES":
    case "EPERM":
      return E.ACCES;
    case "EISDIR":
      return E.ISDIR;
    case "ENOTDIR":
      return E.NOTDIR;
    case "EEXIST":
      return E.EXIST;
    case "EINVAL":
      return E.INVAL;
    default:
      return E.IO;
  }
}
