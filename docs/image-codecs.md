# JPEG XL and HEIC/HEIF

CompressO accepts `.jxl`, `.heic`, and `.heif` in the file picker, dropped folders, watched
folders, tray queue, and OS file associations. All three are also output formats in individual
and batch settings. HEIC and HEIF outputs both use HEVC; changing the extension does not select
a different codec.

## Runtime

The offline tool bundle includes libjxl 0.12.0's `cjxl`, `djxl`, and `jxlinfo` on each supported
target. All platforms use libheif 1.23.6's dedicated `heif-dec` and `heif-enc` tools. The Linux
executables are built on Ubuntu 22.04 with static linking, including x265, libde265, PNG, and JPEG
dependencies. Their ELF headers are checked for x86-64 and the absence of shared-library or
loader requirements. ImageMagick, its AppImage extraction, documentation, and unrelated delegates
are no longer bundled. Windows also uses self-contained HEIC tools without codec DLLs.
Users do not install codecs or use a network service.
The Linux `.deb` and AppImage both include this same dedicated-codec tool bundle.

Rust copies inputs to an isolated workspace and passes ASCII relative filenames to codec tools.
This supports Unicode user paths and Windows extended-length resource paths. The workspace is
removed on success or failure. Codec processes use the existing owner-window, cancellation,
shutdown, and diagnostic logging machinery. Decoded PNG intermediates are cached by input content
hash under the existing app assets folder; normal cache cleanup removes them.

The editor, thumbnails, drop queue and output comparison show decoded PNGs, independently of
the platform WebView's codec support. Saving and copying always use the actual JXL/HEIC/HEIF file.
Recompression and saving trigger fresh preview resolution, including when an output path is reused.

## Compression and preservation

- JPEG XL supports lossy quality and lossless encoding, including 16-bit PNG intermediates.
- Unedited, upright JPEGs use lossless JPEG transcoding when lossless JXL is selected. Keeping
  metadata permits byte-for-byte JPEG reconstruction with `djxl`. Stripping metadata disables
  reconstruction and removes EXIF, XMP, and JUMBF without recompressing JPEG image coefficients.
- HEIC/HEIF encoding currently produces 8-bit images with x265. Lossy encoding accepts higher
  precision inputs and reduces them to 8-bit. A lossless request on higher precision pixels is
  rejected with an explicit message; use lossless JPEG XL or PNG instead.
- Lossless HEIC uses RGB and 4:4:4 chroma. Transparency is preserved. Smaller output is not
  guaranteed, especially when an already compressed image is encoded losslessly.
- Modern-format output normalizes orientation, applies requested edits before encoding, and
  preserves ICC/PNG color-description chunks. EXIF is retained when metadata stripping is off,
  with the orientation tag removed after pixel normalization. Arbitrary proprietary metadata
  and all XMP fields are not guaranteed to survive pixel transformations.
- Existing output formats continue through their existing compression pipeline and inherit
  those formats' bit-depth and metadata limitations.

This implementation handles still images. Animated JXL and HEIF sequences are rejected; a HEIF
collection uses its primary image, not the first thumbnail or auxiliary image. Floating-point,
CMYK, PQ/HLG and gain-map JXL inputs are rejected. HEIF depth maps, gain maps and auxiliary images
are not exported, and HDR tone mapping/preservation is not promised. GIF-to-modern conversion is
not offered yet.

## Building

The checked-in, target-specific executables are verified against
`LICENSES/image-codecs/SOURCES.json` by `node scripts/image-tools.mjs [target-triple]`.
`pnpm tauri:dev` runs this verification and uses the files in `src-tauri/bin/` directly.
`pnpm tauri:build` verifies the same files and places them in the compressed, offline tool bundle.
No codec source build, Python installation, or codec download is part of the build. The resulting
archive hash gives upgrades a separate installation directory and triggers normal preparation.

Windows ARM runs the x64 app and tools under Windows emulation. The static Windows HEIC executables
import only Windows system DLLs and passed an encode/decode round trip in the Windows x64 build
workflow. A Windows release installation with the new tools still needs testing. Linux x64
codec and tool installation regression tests also run before release uploads. The Intel macOS
codec executables are checked in and hash-verified. They were built for x86-64 with a macOS 11
deployment target, have no non-system dynamic-library dependencies, and passed JXL and HEIC
encode/decode round trips under Rosetta. A native Intel release installation still needs testing.

## Sources and verification

Each app includes available dependency notices under `tool-bundle/licenses/image-codecs/`.
`SOURCES.json` pins the exact executable hashes and upstream package URLs and hashes. The Windows
static build's metadata and libheif patch are kept with its notices. The Apple Silicon source
archive is published separately from its installer. The Intel macOS archive includes the pinned
vcpkg snapshot, downloaded codec sources, the build script, and the Little CMS CMake overlay
used to avoid Python in the source build. Rebuild it with
`node scripts/build-image-tools.mjs x86_64-apple-darwin`; normal app builds only verify the
checked-in executables. Before publishing other targets, verify that
their corresponding source and license obligations are met. A replacement prebuilt executable
requires an updated hash and an archive rebuild so the embedded manifest matches.

Rebuild only the Linux HEIF tools on an x86-64 Ubuntu 22.04 runner with
`node scripts/build-image-tools.mjs x86_64-unknown-linux-gnu`. Install `build-essential binutils
git curl zip unzip pkg-config cmake ninja-build nasm autoconf automake libtool perl` first.
This preserves the existing JPEG XL tools and builds HEIF with the same primary-image/sequence
patch used on macOS, no runtime plugins, and x265 assembly optimizations. Copy the two generated
executables from `.toolchain-cache/image-codecs/<target>/bin/` to `src-tauri/bin/`, update their
hashes in `SOURCES.json`, and include the matching dependency copyrights. Publish the generated
`image-codec-sources-<target>.tar.gz` separately via `src-tauri/tool-sources/`; it contains the
pinned vcpkg recipes, codec sources, build script, and overlays needed to rebuild the tools.

Run real codec regression tests on each native target:

```sh
cargo test --manifest-path src-tauri/Cargo.toml core::image_codecs::tests -- --include-ignored
cargo test --manifest-path src-tauri/Cargo.toml core::tool_bundle::tests -- --include-ignored
```

They check lossy and lossless JXL/HEIC/HEIF encoding, visible pixels/alpha, 16-bit JXL, JPEG
reconstruction, metadata-stripping flags, corrupt input, real archive extraction and repair, and
the existing FFmpeg/FFprobe execution path. Native release installation testing remains required.
