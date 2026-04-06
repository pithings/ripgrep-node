const std = @import("std");

// builds ripgrep (Rust) via `cargo zigbuild`, using Zig as the C
// compiler/linker. The Rust sources live in vendor/ripgrep as a git submodule.
//
// Two build steps are exposed:
//   - `wasi`   — builds only wasm32-wasip1 (default)
//   - `native` — cross-compiles all native release targets
// Outputs land in a top-level `dist/rg-<triple>[.exe|.wasm]`.
pub fn build(b: *std.Build) void {
    const native_triples = [_][]const u8{
        "aarch64-apple-darwin",
        "x86_64-unknown-linux-gnu",
        "aarch64-unknown-linux-gnu",
        "x86_64-pc-windows-gnu",
    };
    const wasi_triples = [_][]const u8{
        "wasm32-wasip1",
    };

    const native_step = b.step("native", "Cross-compile ripgrep for all native targets");
    const wasi_step = b.step("wasi", "Cross-compile ripgrep for wasm32-wasip1");

    for (native_triples) |triple| addTarget(b, native_step, triple);
    for (wasi_triples) |triple| addTarget(b, wasi_step, triple);

    // Default to wasi.
    b.default_step = wasi_step;
}

fn addTarget(b: *std.Build, parent: *std.Build.Step, triple: []const u8) void {
    const bld = addRipgrepBuild(b, triple);
    const dest = b.fmt("rg-{s}{s}", .{ triple, binExt(triple) });
    // `../dist` resolves relative to the install prefix (`zig-out`), so
    // binaries land in a top-level `dist/` at the repo root.
    const install = b.addInstallFileWithDir(bld.rg_path, .{ .custom = "../dist" }, dest);
    install.step.dependOn(&bld.cargo.step);
    parent.dependOn(&install.step);
}

const RipgrepBuild = struct {
    cargo: *std.Build.Step.Run,
    rg_path: std.Build.LazyPath,
};

fn addRipgrepBuild(b: *std.Build, rust_triple: []const u8) RipgrepBuild {
    // ripgrep's `release-lto` profile (defined in vendor/ripgrep/Cargo.toml)
    // layered with size tuning via `--config` to produce the smallest binary.
    const profile = "release-lto";
    const manifest_path = b.pathJoin(&.{ "vendor", "ripgrep", "Cargo.toml" });

    const cargo = b.addSystemCommand(&.{
        "cargo",
        "zigbuild",
        "--manifest-path",
        manifest_path,
        "--profile",
        profile,
        "--target",
        rust_triple,
        "--bin",
        "rg",
        "--config",
        "profile.release-lto.opt-level=\"z\"",
        "--config",
        "profile.release-lto.debug=false",
        "--config",
        "profile.release-lto.strip=\"symbols\"",
    });
    cargo.setName(b.fmt("cargo zigbuild ripgrep [{s}]", .{rust_triple}));

    // Keep each target's cargo target-dir separate so parallel/cross builds
    // don't thrash each other's fingerprints.
    const cache_root = b.cache_root.path orelse ".zig-cache";
    const target_dir = b.pathJoin(&.{ cache_root, "cargo-target", rust_triple });
    cargo.setEnvironmentVariable("CARGO_TARGET_DIR", target_dir);

    // Enable WASM SIMD for wasm targets — unlocks memchr's simd128 vectorized paths.
    if (std.mem.startsWith(u8, rust_triple, "wasm")) {
        cargo.setEnvironmentVariable("RUSTFLAGS", "-C target-feature=+simd128");
    }

    const exe_name = b.fmt("rg{s}", .{binExt(rust_triple)});
    const rg_path_str = b.pathJoin(&.{ target_dir, rust_triple, profile, exe_name });
    return .{
        .cargo = cargo,
        .rg_path = .{ .cwd_relative = rg_path_str },
    };
}

fn binExt(triple: []const u8) []const u8 {
    if (std.mem.indexOf(u8, triple, "windows") != null) return ".exe";
    if (std.mem.indexOf(u8, triple, "wasi") != null) return ".wasm";
    if (std.mem.startsWith(u8, triple, "wasm")) return ".wasm";
    return "";
}
