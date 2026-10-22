# Offline tool bundles

Release builds ship one target-specific compressed archive instead of five uncompressed Tauri
sidecars. **All 20 original binaries in `src-tauri/bin/` remain tracked and unchanged.** Packaging
copies them into a temporary directory; it never signs, replaces, or removes the originals.

macOS uses `tools.tar.lrz` and a small lrzip executable. Windows and Linux use `tools.tar.xz`,
decoded by Rust's statically linked XZ library, with no external extraction program. No download
or administrator access is needed when the app starts.

## Building

Run the usual `pnpm tauri:build`. The Tauri before-build hook runs
`node scripts/prepare-tools.mjs` before building the frontend. It selects
`TAURI_ENV_TARGET_TRIPLE` (provided by Tauri), then `TARGET`, then the Rust host target.
For a standalone packaging run, set `TARGET` explicitly when preparing another architecture.

Build prerequisites are Node, Rust, and the normal platform build tools; Python is not required.
The isolated Rust helper in `scripts/tool-archive/` creates deterministic TAR/XZ archives using
the same TAR and statically linked XZ libraries as the app. It builds for the host architecture,
even when packaging tools for a different target, and is never included in the app download.
Cargo caches its build under `src-tauri/target/tool-archive/`.
On macOS, the first packaging run downloads checksum-pinned lrzip 0.7.3,
LZ4 1.10.0, and LZO 2.10 source archives. `scripts/build-lrzip.mjs` compiles them privately under
`src-tauri/.toolchain-cache/<target>/`, with macOS 11 as the deployment target and static LZ4/LZO
linking. Only Apple system libraries remain dynamically linked. This avoids Homebrew binaries
silently raising the minimum supported OS. Cached sources/builds make subsequent builds offline.
Use a native macOS runner for each architecture, as configured in the release workflow.

On macOS, tools are copied and signed **before** their hashes and archive are generated.
`APPLE_SIGNING_IDENTITY` selects the release identity; local builds use ad-hoc signing. The helper
is signed with the same identity. Production Developer ID signing/notarization must still be
validated on a clean Mac; a local ad-hoc build does not establish Gatekeeper acceptance.

Generated files live in `src-tauri/tool-bundle/` and are ignored by Git except `.gitkeep`.
Original media tool licenses remain bundled. Helper license texts and source metadata are
included alongside the archive. The matching source archives and helper build script are packaged
separately in `.toolchain-cache/toolchain-sources-<target>.tar.gz`; CI uploads this alongside each
macOS release so users can obtain the corresponding sources without enlarging the app download.

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
five installed files' SHA-256 hashes, sizes, and executable permissions before making their paths
available to compression code. A completion marker alone is never sufficient.

The installation path is Tauri's `app_local_data_dir()/tools/<target>/<archive-sha256>/`.
On macOS this is normally `~/Library/Application Support/com.compresso.app/tools/`.
Versions with identical tool archives reuse the same installation. Different archive hashes get
separate directories; older versions are retained so switching versions does not destroy them.
The archive stays in the application bundle for offline repair.

If installation or repair is required, Rust opens a separate **Preparing CompressO** window.
The main and tray frontends wait before mounting their normal router and hooks. Hardware encoder
probing also waits. Files opened during preparation stay queued for frontend readiness.

Rust checks the archive/helper hashes, extracts to a staging directory, rejects unexpected TAR
paths, links, duplicate entries, and wrong file sizes, then checks every extracted tool hash.
It writes the completion marker and renames the staging directory into place only after success.
An interrupted staging directory is cleared on retry. Missing files, changed bytes, missing execute
permissions, and missing completion markers trigger full re-extraction on the next launch.
Closing the preparation window exits the app and stops a running decompressor. Failures stay in
that window with an error and a Retry button; a damaged bundled archive requires reinstalling.

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
entries. The explicit smoke tests extract the actual target archive and execute all five tools,
then generate a video, read its metadata, transcode it, and verify progress/error capture using
the executor's `SharedChild::spawn` pattern.

For manual release testing, open the built application, observe preparation on first launch, quit,
and reopen to check fast reuse. With the app stopped, remove one file **from the extracted data
directory**, then launch again to verify repair. Never remove or edit the originals in
`src-tauri/bin/`. Test an actual media compression after repair. Windows, Linux, Intel macOS, and
Developer ID notarization require their native release checks.
