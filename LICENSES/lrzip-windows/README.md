# Windows LRZIP helper

The Windows x64 helper was supplied from the `v0.651-1` release of
https://github.com/eat-swap/lrzip-windows and is used unchanged.

- Original filename: `lrzip-0.651.1-x86_64-ucrt64.exe`
- Project copy: `src-tauri/bin/compresso_lrzip-x86_64-pc-windows-msvc.exe`
- License: GPL-2.0-or-later; see `COPYING`.
- Release, asset/source URLs, and checksums: see `SOURCE.json`.
- Matching port source: `src-tauri/tool-sources/lrzip-windows-v0.651-1.tar.gz`, published separately
  with Windows releases.

The supplied executable must create and extract its own archives. Do not substitute archives
produced by the newer macOS LRZIP helper without first verifying compatibility.
