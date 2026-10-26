# Offline tool bundles

Release builds ship one target-specific compressed archive containing the platform's tools instead of uncompressed Tauri
sidecars. **All 20 original binaries in `src-tauri/bin/` remain tracked and unchanged.** Packaging
copies them into a temporary directory; it never signs, replaces, or removes the originals.

macOS, Windows, and Linux use `tools.tar.lrz` with a bundled lrzip executable for their respective
platforms. Rust retains XZ extraction support for existing bundles and other targets.
No download or administrator access is needed when the app starts.

## Building

Run the usual `pnpm tauri:build`. The Tauri before-build hook runs
`node scripts/prepare-tools.mjs` before building the frontend. It selects
`TAURI_ENV_TARGET_TRIPLE` (provided by Tauri), then `TARGET`, then the Rust host target.
For a standalone packaging run, set `TARGET` explicitly when preparing another architecture.

Build prerequisites are Node, Rust, and the normal platform build tools. Added image codecs are
checked-in prebuilt executables, verified by SHA-256; see [image-codecs.md](image-codecs.md).
No Python installation is required for codec or archive preparation.
The isolated Rust helper in `scripts/tool-archive/` creates deterministic TAR/XZ archives using
the same TAR and statically linked XZ libraries as the app. It builds for the host architecture,
even when packaging tools for a different target, and is never included in the app download.
Cargo caches its build under `src-tauri/target/tool-archive/`.
On macOS and Linux, the first packaging run downloads checksum-pinned lrzip 0.7.3,
LZ4 1.10.0, and LZO 2.10 source archives. `scripts/build-lrzip.mjs` compiles them privately under
`src-tauri/.toolchain-cache/<target>/`. On macOS it uses macOS 11 as the deployment target and
static LZ4/LZO linking. Only Apple system libraries remain dynamically linked. This avoids Homebrew binaries
silently raising the minimum supported OS. Cached sources/builds make subsequent builds offline.
Use a native macOS runner for each architecture, as configured in the release workflow.

Linux builds use a matching native GNU/Linux runner (Ubuntu 22.04 for releases). Install
`build-essential binutils perl zlib1g-dev libbz2-dev` in addition to the normal Tauri build
dependencies. The helper links fully statically, including the distribution's zlib/bzip2 static
libraries and the privately built LZ4/LZO. Its ELF architecture is verified, and packaging rejects
any shared-library dependency or runtime interpreter. No system `lrzip` installation is needed.
Linux builds omit macOS deployment/architecture flags and CPU-specific tuning. Only the matching
helper and LRZIP archive ship in both the `.deb` and AppImage; no second XZ archive is included.

Every newly prepared LRZIP archive is extracted with the exact bundled helper into a directory
with spaces and Unicode characters. The complete decoded TAR SHA-256 must match the original
before packaging succeeds. A normal Linux extraction uses absolute paths, matching app startup;
Windows uses relative paths as described below. Cached, hash-verified bundles skip this work.

Windows x64 uses the supplied `lrzip-0.651.1-x86_64-ucrt64.exe`, preserved as
`src-tauri/bin/compresso_lrzip-x86_64-pc-windows-msvc.exe`. Build its archive on Windows: this
exact executable creates and then extracts the complete archive during packaging, and the
round-trip TAR hashes must match before packaging succeeds. This catches runtime dependencies,
unsupported options, archive incompatibility, and extraction failures before shipping. Windows
archives are never produced with the newer macOS helper. The original 20 media tools are unchanged.

`LICENSES/lrzip-windows/SOURCE.json` pins the supplied helper's SHA-256, release provenance, and
matching source archive checksum. Its import table lists Windows system/UCRT DLLs, with no MSYS,
LZO, LZ4, or MinGW runtime DLL imports. The license is bundled with the app, and CI publishes
`src-tauri/tool-sources/lrzip-windows-v0.651-1.tar.gz` separately alongside Windows releases.
The helper is copied to `tool-bundle/bootstrap/lrzip.exe`, verified against the embedded manifest
at extraction time, and launched without an additional console window.

The older Windows helper receives only ASCII relative filenames. Rust copies the verified archive
into the writable staging directory, and LRZIP runs there with `tools.tar.lrz` as input and
`tools.tar` as output. This avoids passing Tauri's canonical Windows resource paths (`\\?\...`)
to the port's older C file APIs. The temporary archive copy is removed before installation is
completed. The build-time round-trip check uses the same relative-path strategy.

On macOS, tools are copied and signed **before** their hashes and archive are generated.
`APPLE_SIGNING_IDENTITY` selects the release identity; local builds use ad-hoc signing. The helper
is signed with the same identity. Production Developer ID signing/notarization must still be
validated on a clean Mac; a local ad-hoc build does not establish Gatekeeper acceptance.

Generated files live in `src-tauri/tool-bundle/` and are ignored by Git except `.gitkeep`.
Original media tool licenses remain bundled. Helper license texts and source metadata are
included alongside the archive. The matching source archives and helper build script are packaged
separately in `.toolchain-cache/toolchain-sources-<target>.tar.gz`; CI uploads this alongside each
macOS and Linux release so users can obtain the corresponding sources without enlarging the app
download. Linux also includes the distribution's zlib/bzip2 copyright and license notices.

To build locally without updater signing secrets:

```bash
pnpm tauri build --bundles app,dmg --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Ordinary `pnpm tauri:dev`/`cargo run` can use the checked-in target-specific binaries when no
matching generated manifest exists. If an archive has been prepared, development runs use it,
which also allows testing the first-launch flow. Release compilation requires a matching
manifest and cannot silently fall back to source binaries.

## Startup and repair

Rust embeds the expected manifest in the application executable. On every launch, it checks all
installed files' SHA-256 hashes, sizes, and executable permissions before making their paths
available to compression code. A completion marker alone is never sufficient.

The installation path is Tauri's `app_local_data_dir()/tools/<target>/<archive-sha256>/`.
On macOS this is normally `~/Library/Application Support/com.compresso.app/tools/`.
Versions with identical tool archives reuse the same installation. Different archive hashes get
separate directories; older versions are retained so switching versions does not destroy them.
The archive stays in the application bundle for offline repair.

If installation or repair is required, Rust opens a separate **Preparing CompressO** window.
It is centered with a native title bar and minimize/close controls. Its content size stays fixed
at 460 × 340, with resizing and maximizing disabled.
The main and tray frontends wait before mounting their normal router and hooks. Hardware encoder
probing also waits. Files opened during preparation stay queued for frontend readiness.

Rust checks the archive/helper hashes, extracts to a staging directory, rejects unexpected TAR
paths, links, duplicate entries, and wrong file sizes, then checks every extracted tool hash.
It writes the completion marker and renames the staging directory into place only after success.
An interrupted staging directory is cleared on retry. Missing files, changed bytes, missing execute
permissions, and missing completion markers trigger full re-extraction on the next launch.
Closing the preparation window exits the app and stops a running decompressor. Failures stay in
that window with an error and small, side-by-side Retry, Exit, and Show logs buttons; a damaged
bundled archive requires reinstalling. Exit quits the app and stops any remaining extraction
subprocess. Show logs uses the same current-log-file reveal action as Settings. Preparation
failures record their stage, target, and error (including decompressor diagnostics) in that log,
and log output is flushed before revealing the file so it can be sent to the developer.

Executable paths are resolved inside Rust, never from user input or the system PATH. Existing
compression process management, cancellation, and progress handling are retained. Tool commands
must pipe stdin, stdout, and stderr, matching the old Tauri shell builder: the process executor
takes those handles to read FFprobe JSON, FFmpeg progress, and failure diagnostics. Checking only
`Command::output()` is insufficient because it creates capture pipes automatically.

## Verification

```bash
pnpm tsc:check
pnpm vite:build
pnpm exec biome check scripts/build-lrzip.mjs scripts/prepare-tools.mjs src/ui/ToolsPreparation/index.tsx src/main.tsx
cargo test --manifest-path scripts/tool-archive/Cargo.toml --target-dir src-tauri/target/tool-archive
cd src-tauri
cargo test core::tool_bundle::tests
cargo test core::tool_bundle::tests -- --include-ignored --nocapture
```

The regular tests cover XZ installation/reuse, same-size corruption, missing files, interrupted
extraction, missing completion markers, damaged archives, expanded size bounds, and invalid TAR
entries. The explicit smoke tests extract the actual target archive and execute all ten tools,
then generate a video, read its metadata, transcode it, and verify progress/error capture using
the executor's `SharedChild::spawn` pattern.

For manual release testing, open the built application, observe preparation on first launch, quit,
and reopen to check fast reuse. With the app stopped, remove one file **from the extracted data
directory**, then launch again to verify repair. Never remove or edit the originals in
`src-tauri/bin/`. Test an actual media compression after repair. Windows, Linux, Intel macOS, and
Developer ID notarization require their native release checks.
