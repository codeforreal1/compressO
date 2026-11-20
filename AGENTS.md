# AGENTS.md

Guidelines for coding agents working on CompressO.

CompressO is a Tauri 2 desktop app that compresses video, image, and audio files with bundled
FFmpeg, gifski, pngquant, jpegoptim, and image codecs. React + Vite render the UI; Rust owns
compression, files, queues, history, the tray, and the command line bridge. The app is offline:
the only network request is the optional update check/download.

Read `README.md` for the product and `CHANGELOG.md` for the current release notes. Versions in
`package.json` and `src-tauri/tauri.conf.json` must match; the release workflow enforces it.

## Start here

- Package manager: **pnpm**. Node version: `.node-version` (currently 20.10.0).
- Rust: pinned by `rust-toolchain.toml` (currently 1.95.0). Keep it in sync with the release
  workflow.
- Branch/version: `CHANGELOG.md` has the in-progress `4.3.0` section; `package.json` and
  `src-tauri/tauri.conf.json` are bumped together when that version is released.
- Do not hand-edit generated files: `src/routeTree.gen.ts`, `src-tauri/gen/**`,
  `src-tauri/binaries/**`, `src-tauri/tool-bundle/**` (except `.gitkeep`), `dist/**`.
- `src-tauri/bin/**` contains pinned, hash-verified sidecars. Do not replace or rebuild them
  unless the task is specifically about tool packaging.
- **Identifiers**: release builds use `com.compresso.app` from `src-tauri/tauri.conf.json`.
  `pnpm tauri:dev` and `tauri:build:debug` merge `src-tauri/tauri.dev.conf.json`, which only
  overrides the identifier to `com.compresso.dev` so development data, login items, logs, and
  updater state do not mix with the installed app. Never change the production identifier: it
  would break existing app data and updates.

## First files to read

- `src/routes/(root)/-state.ts` — what the app holds and how media/config/snapshots relate.
- `src/routes/(root)/ui/StartCompression.tsx`, `src-tauri/src/tauri_commands/media.rs`, and
  `src-tauri/src/core/ffmpeg.rs` — follow one compression from click to process.
- `src/tauri/commands/*` — the full backend API surface exposed to the UI.
- `src/stores/settingsStore.ts`, `src/stores/presetsStore.ts`, and
  `src/routes/(root)/ui/app-settings/Setting.tsx` — settings and presets.

## Commands

```bash
pnpm install                  # install frontend deps
pnpm tauri:dev                # full app on http://localhost:3001 (builds the CLI first)
pnpm vite:dev                 # frontend only on port 3001 (Tauri calls do not work)
pnpm tsc:check                # TypeScript
pnpm exec biome check .       # lint + format check
pnpm exec biome check --write . # auto-fix
pnpm i18n:check               # 16 locale coverage + interpolation placeholders

pnpm test:audio-target-size   # node:test, transpiles a TS module
pnpm test:drop-queue
pnpm test:image-dynamic-range
pnpm test:video-dynamic-range
pnpm test:watched-folders
node --test scripts/test-dependency-sources.mjs

cd src-tauri && cargo check
cd src-tauri && cargo clippy
cd src-tauri && cargo test    # unit tests; some need bundled tools/fixtures

node scripts/build-cli.mjs    # builds compresso-cli into src-tauri/binaries (ignored)
node scripts/prepare-tools.mjs # builds/verifies the per-target tool bundle (release)
node scripts/image-tools.mjs  # verifies prebuilt image codecs and hashes
pnpm generate:latest-json     # updater manifest (release)
pnpm tauri:build              # production bundle
pnpm tauri:build:debug
pnpm tauri:build:mac          # arm64 + x64
```

Pre-commit runs `pnpm lint-staged` (Biome on staged files and translations) and
`pnpm tsc:check`. Fix failures; do not bypass hooks.

Frontend dev server is **3001**. Iris (a separate project) uses 3002. Do not mix sessions,
repos, or dev servers between the two.

## Non-negotiables

1. **All user-visible text is translated in every locale.** Add/change the English key in
   `src/i18n/locales/en.json` and the same key in all 15 other locale files in the same change.
   Use `t()` in components, `t` from `@/i18n` outside React. Run `pnpm i18n:check`.
   Plural keys use i18next suffixes (`_one`, `_other`, ...). Native menu/quit text is sent to
   Rust from `src/i18n/index.ts` (`setNativeTexts`).
2. **Stay offline.** No new network calls except the existing updater. Do not add telemetry,
   remote fonts, CDNs, or runtime tool downloads.
3. **Always use the bundled tools.** Call FFmpeg/ffprobe/gifski/pngquant/jpegoptim through the
   Rust wrappers (`FFMPEG`, `ImageCompressor`, `FFPROBE`, `tool_bundle::command`). Never invoke
   a system `ffmpeg` from Rust or the frontend.
4. **Media stream selection: skip attached pictures.** Some MP4s (notably from X/Twitter)
   carry a 0×0 MJPEG cover art as the first video stream. Use ffprobe `-select_streams V:0`
   and FFmpeg filter inputs `[0:V:0]`, never `v:0` / `[0:v]`. This affects dimensions, fps,
   compression, trim, speed, GIF conversion, and target size. Cover art is still wanted for
   audio files' thumbnails, so `get_video_streams` deliberately keeps attached pictures;
   do not "fix" that without checking audio cover art.
5. **No `console.log`.** Biome treats it as an error. Use `toast` from `@/components/Toast` for
   user-facing errors and `log_error`/Rust `log` for diagnostics.
6. **Use the existing UI system.** HeroUI wrappers in `src/components/` and `@/components/*`;
   `cn()` from `@/utils/tailwind`; no new component library, spinner, or toast stack.
7. **Do not change save/preset semantics casually.** Outputs are never overwritten; use
   `getAvailablePath`/`moveFile`; "replace original files" is opt-in. Clips are saved
   individually and can be retried. Presets intentionally exclude per-file settings.

## Project map

```text
src/
  main.tsx                 React root, theme before first paint, Linux video server
  global.css               Tailwind layers, theme tokens, window materials
  routes/
    __root.tsx             window routing: main vs tray; sync hooks; updater init
    (root)/                main window route and feature code
      -state.ts            valtio appProxy: media, config, snapshots, batch normalization
      -media.ts            import/probe/add media (files, folders, open-with)
      -compression.ts      output plans, MediaItemConfig builder, warnings, lanes
      -sizeEstimate.ts     target-size / quality size estimates
      -presets.ts          Standard + user presets, apply/save/describe
      -save.ts             save outputs/clips, auto-save, clipboard, queue save
      -history.ts          history records for main window and queue
      ui/
        MediaConfig.tsx    single/batch media + output settings layout
        PreviewSingleMedia, PreviewBatchMedia, PreviewClips, MediaThumbnail
        output-settings/   Video/Image tabs, video and image setting components
        app-settings/      Settings dialog pages + SETTINGS_INDEX
      ui/start compression, progress, save, cancel, pause, comparison
    webviews/tray/         macOS menu bar / Windows tray popover and queue runner
  components/              reusable UI (VideoPlayer, Timeline, Icon, Button, ...)
  stores/                  valtio/localStorage: settings, presets, updates, dialog state
  hooks/                   cross-window/backend sync (theme, tray, queue, clipboard, ...)
  tauri/commands/          typed invoke wrappers, one file per Rust command module
  tauri/components/        Tauri-aware UI (Titlebar, Link)
  types/                   app, compression, presets, files, HDR, waveform
  utils/                   pure helpers (video, transform, target size, preset output, ...)
  i18n/                    i18next setup, languages, 16 locale JSON files
  assets/                  icons (SVG React components), fonts, sounds

src-tauri/
  src/main.rs              app setup, windows, tray, menu, command registration, exit flow
  src/core/                domain + compression engine
  src/tauri_commands/      #[tauri::command] entry points
  src/sys/                 cross-platform OS services (history, queue, watch, logs, CLI)
  src/macos/               macOS app menu, tray popover, bridge
  src/win/                 Windows tray popover, theme, tray icon
  cli/                     compresso-cli crate (CLI + MCP; talks to the app over a socket)
  bin/                     pinned sidecars (do not edit)
  tool-bundle/             per-target compressed archive/manifest (generated)
  capabilities/            Tauri permissions per window
  tauri.conf.json          bundle, windows, file associations, updater config
```

## Runtime topology

- **Windows**: `main` (normal app window), `tray` (macOS menu bar / Windows system tray
  popover), `preparation` (first-run tool extraction). Linux has no tray window; the main
  window runs the queue while open. Capabilities are split across
  `src-tauri/capabilities/{main,tray,preparation}.json`; add permissions there, not globally.
- **Boot**: `ToolPreparation` gates the UI until the tool bundle is extracted/verified. The
  main window starts hidden and calls `frontend-ready` when painted; opened at login with
  "Open in menu bar only" (macOS) or started by the CLI, it stays hidden. The updater check
  runs after that.
- **Two webviews share no JS state.** Sync through:
  - `localStorage` + `storage` events (`settingsStore`, `presetsStore`).
  - Rust-owned state and Tauri events (`drop-queue-changed`, `drop-queue-paused-changed`,
    `history-changed`, `open-with-app`, `update-event`, `update-error`,
    `target-size-retry`, compression progress events).
  - `useSyncState` for debounced local↔global inputs; call `flushSyncStates()` before
    compressing so a just-typed value is used.
- **App data**: `history.json` and temporary compressed outputs live in the Tauri app data
  directory. Thumbnails and saved outputs are real files; deleting media must delete its
  cached outputs/thumbnails (`deleteCache`/`deleteFile`).
- **Logs**: written via the Tauri log plugin (`CompressO_*.log`), `log_error` for frontend
  diagnostics. Do not leave temporary diagnostic logging in production code.

## State model

`appProxy` (`src/routes/(root)/-state.ts`) is the single source for the current selection:

- `media`: `MediaFile[]`; a video/audio file is `type: 'video'` (audio files also set
  `isAudioFile`), images are `type: 'image'`. There is no separate audio media type.
- Each video/image has a `config`; batch editing writes
  `commonConfigForBatchCompression.videoConfig|imageConfig|audioFileConfig`.
- `selectedMediaIndexForCustomization` switches a batch into single-media editing.
- `takeSnapshot`/`timeTravel` support cancel/restore flows. Do not replace proxy objects
  wholesale unless you understand snapshot references; mutate fields where existing code does.
- `normalizeBatchMediaConfig()` propagates batch settings to media; call it after changing
  batch-level options.
- `isCompressing`, `isProcessCompleted`, `batchId`, `isPreviewingClip` drive UI screens and
  save behavior.

`settingsStore` and `presetsStore` persist through `localStorage` (`storage` events keep the
windows in sync); `updateStore` and `settingsDialogStore` are in-memory. Storage keys live in
`src/constants`; `constants/settingsIndex.ts` maps Settings rows for search and deep links.
To add a setting, update the store defaults/read/write, constants, the Settings page, and
`SETTINGS_INDEX` so search and "open setting" links work.

## Media and output model

- Extensions and codecs: `src/types/compression.ts` (`extensions`, `inputOnlyExtensions`,
  `inputExtensions`, `VIDEO_CODECS`, `batchResolutions`). Input-only formats (m4v, mts/m2ts,
  bmp, tiff, aac, ...) are readable but never offered as outputs.
- Audio extraction is a **video output whose extension is audio** (`isAudioExtension`).
  Audio files are handled as videos without a picture (`isAudioFile`).
- Resolution is "longer side" for both orientations: 1080p means 1920×1080 or 1080×1920.
- `getOutputVideoContainer` resolves "Same as input", m4v→mp4, mts/m2ts→ts.
- Target size and quality are alternatives; videos budget bitrate/dimensions, images find the
  highest quality that fits, audio plans bitrate. See `-sizeEstimate.ts`,
  `-compression.ts`, `utils/targetSize.ts`, `utils/audioTargetSize.ts`.
- GIF output is a normal compressed intermediate video followed by gifski; audio is dropped,
  clips are not available, and target size is not supported.
- Clips split the finished video with stream copy into 1-based `VideoClipOutput`s; the
  frontend saves and previews each clip independently.
- HDR: `image_dynamic_range.rs` / `video_dynamic_range.rs` decide Keep/Boost/Remove per
  format and source; platform support varies (JPEG HDR is macOS 15+). Do not assume all
  outputs can hold HDR.

## Compression pipeline

1. **Import** — `-media.ts` reads metadata, probes with `get_video_basic_info` /
   `get_video_streams` / dynamic range, generates a thumbnail, and creates a config from the
   default preset. Folders expand recursively and keep `relativeDir`.
2. **Configure** — output-settings components mutate `appProxy`; `-presets.ts` applies
   presets and records `presetId`, skipped fields, and preset output (`saveLocation`,
   `saveFolder`, `filePrefix`).
3. **Start** — `StartCompression.tsx` flushes inputs, validates target size/clips, snapshots
   state, then calls `getMediaItemConfig` for every media and
   `compress_media_batch(batchId, items)`.
4. **Rust batch** — `tauri_commands/media.rs` runs three lanes concurrently: one video, one
   audio, one image at a time. A failed media is logged and omitted; cancellation fails the
   batch. The batch emits `BatchMediaCompressionProgress` and
   `BatchMediaIndividualCompressionCompletion`. Pause stops each lane before its next item.
5. **Video** — `core/ffmpeg.rs` builds the filter graph (trim → speed → transforms → scale →
   HDR → pad), selects codecs, applies quality or target-size rounds, hardware acceleration
   with CPU fallback, then writes the output. GIF uses a temp video + gifski; clips are split
   after encoding with forced keyframes at clip boundaries.
6. **Image** — `core/image.rs` uses pngquant/jpegoptim/gifski/JPEG XL/HEIF tools, handles HDR,
   SVG, lossless, and target size. Audio uses the video pipeline with no picture and only
   audio settings.
7. **Result** — outputs stay in the app cache until saved. `-save.ts` moves them to the chosen
   destination (or leaves them for the Save button), handles clips and "replace original",
   copies to clipboard if enabled, and records/updates history.
8. **Completion** — the main window auto-saves, plays the completion sound, and can auto-copy.
   The tray/queue path does the same per item and records history as `dropQueue` /
   `watchedFolder` / `commandLine`.

### Events and cancellation

- Custom event names are defined in both `src-tauri/src/core/domain.rs` (`CustomEvents`) and
  `src/types/compression.ts`. Keep them in sync.
- Cancel with `CancelInProgressCompression` (`{ ids: [...] }`); the backend kills the matching
  child processes and stops the batch. Processes are spawned children, not blocking threads.
- Progress carries the video/media id and duration; target-size retries emit
  `target-size-retry` with `{ videoId, pass, onCpu }`.
- Any listener created in a long-lived scope must be cleaned up (`EventListenerGuard` in Rust,
  `unlisten` in React).

## Preview and editing

- `PreviewSingleMedia` is the shell for a single media (or one customized in a batch):
  header, preview, size/summary, actions.
- `MediaThumbnail` switches between video playback (`VideoPlayer`/ReactPlayer), image preview,
  audio cover/waveform, and transform preview. `MediaTransformer` and
  `VideoTrimmerTimeline` are the crop/trim editors.
- `PreviewBatchMedia` is the grid; `PreviewClips` is the finished-clips grid and the
  read-only clip player; `MediaOutputCompareSlider` is before/after comparison.
- **ReactPlayer gotcha**: `config.file.attributes.style` replaces the video element's default
  style. When you pass it, include `width: '100%'`, `height: '100%'`, and `objectFit:
  'contain'`; otherwise the video renders at intrinsic size and can overflow the player.
- Video previews need a bounded media box. `MediaThumbnail` sizes the player to the source
  aspect ratio inside a 60vh box; keep portrait videos centered and let the timeline keep the
  full width. `MediaOutputCompareSlider` uses the same aspect sizing, while `PreviewClips`
  fills its available frame.
- Linux has no native asset playback in the webview: `isVideoPreviewAvailable` is off by
  default and video is served by a local Rust server with a secret URL. Do not bypass
  `constructVideoUrl`.
- Timeline/waveform: `useTimelineEngine`, `Timeline`, `AudioWaveform`, and
  `useAudioWaveform`; waveforms are cached in Rust and can be disabled in Settings.

## Output settings UI

- `VideoSettings` tabs: **Video**, **Audio**, **Others**. Audio files have only **Audio** and
  **Others**. Settings that apply only to video outputs are wrapped in `VideoOnlySection` and
  disabled (not hidden) when the output extension is audio; this avoids layout jumps.
- `BatchVideoConfigKeyContext` selects `videoConfig` or `audioFileConfig` for batch editing.
  A setting must work for both single media and batch configs; use the existing pattern
  (`video?.config ?? commonConfigForBatchCompression[key]`).
- Clips and custom thumbnail live in **Others**; keep the Video tab focused on encoding,
  sizing, transforms, trim, speed, and extension.
- Presets only include fields listed in `src/types/preset.ts` (`videoPresetFields`,
  `imagePresetFields`, `audioPresetFields`). Per-file settings (trim, crop, subtitles, custom
  thumbnail, metadata values, audio tracks) are intentionally excluded.
- Adding a setting usually touches: `src/types/app.ts`, `-state.ts` initial state,
  the setting component, `-presets.ts` (if global), `src/types/preset.ts` (if saved),
  Rust `VideoCompressionConfig`/`ImageCompressionConfig`, ffmpeg/image builders, and
  translations.

## Saving, queue, and history

- Save locations: same folder, ask, or fixed folder. Presets can override with their own
  output; otherwise the Standard preset uses Settings → Output (`getPresetOutput`,
  `savesAutomatically`).
- Never overwrite silently: `getAvailablePath` numbers clashing names; `moveFile` handles
  "replace original" by trashing the original only when the setting is on.
- A dropped folder preserves its structure by default; the top folder is chosen once per save
  so all files land together.
- Clips are saved independently (the main window's `saveVideoClips`, and every clip of a
  drop-zone/watched-folder/CLI output in the queue); partial saves are retryable.
- If an output is larger than the original and "save larger outputs" is off, it stays in the
  cache for the Save button; the queue reports `larger` / no-save-location reasons.
- History is a Rust-owned `history.json` (max 20,000 entries) emitted as `history-changed`,
  with its own UI in Settings → History. Record main-window batches once, queue items per
  item, and update entries when a later save happens.
- The drop queue is Rust-owned and shared by the tray, watched folders, clipboard, and CLI.
  The menu bar/tray window compresses it on macOS/Windows; the main window does on Linux.
  Auto-compress requires a preset that saves without asking. Watched folders only pick up
  files added after watching, wait for writes to settle, and never re-compress CompressO's
  own outputs (`output_registry`).

## Tauri / Rust conventions

- Commands return `Result<T, String>`, use `#[tauri::command]`, and serialize with
  `#[serde(rename_all = "camelCase")]`. Frontend wrappers live in `src/tauri/commands/` and
  invoke snake_case command names with camelCase args.
- Register every command in `src-tauri/src/main.rs`'s `invoke_handler`. Platform-only
  commands are gated with `#[cfg(...)]`.
- Long work runs on `tauri::async_runtime`/Tokio; never block the main thread. Child
  processes go through `media_process` so they are tracked, canceled, logged, and killed on
  quit.
- Window labels: `main`, `tray`, `preparation`. Linux has no `tray`. Keep capability files
  in sync with labels and platforms.
- Tool bundle: `tool_bundle.rs` verifies the embedded manifest/hashes, extracts on first run
  into app data, and only then exposes commands. Do not trust mutable files or paths.
- Log errors with `log::error!`/`log::warn!` including context (command, path, exit code).
  The end of a failed process's stderr is already captured by `media_process`.
- File system: use existing helpers for paths, `relativeDir` uses `/` on every platform,
  and macOS "Files & Folders" permission failures should surface as access-denied messaging.

## Platform notes

- **macOS**: custom app menu (`macos/app_menu.rs`), menu bar tray popover, dock progress/
  badge, open-with events, login item, tinted window. The app is not notarized; do not add
  assumptions that it is signed.
- **Windows**: tray popover (Acrylic on Windows 11), clipboard watching, installer adds the
  CLI to PATH, NSIS installer. Use `win/` for native behavior.
- **Linux**: no tray; the main window owns the queue while open. Video previews are off by
  default and use the local server; AppImage/deb packaging. WebKit rendering workarounds may
  be needed; do not remove `WEBKIT_DISABLE_*` guidance.
- CLI (`src-tauri/cli`) has no compression of its own: it connects to the running app over a
  local socket (named pipe on Windows), starts the app in the background if needed, and uses
  the same drop queue/presets/output settings. `compresso watch` lists/adds/updates/removes
  watched folders, and `compresso mcp` exposes `compress`, `list_presets`, `cancel_compression`,
  and watched-folder management. The CLI crate is built by
  `scripts/build-cli.mjs`; `src-tauri/binaries` is generated and ignored.

## Release and packaging

- Bump `package.json` **and** `src-tauri/tauri.conf.json`; add the matching `### <version>`
  section to `CHANGELOG.md`. The release workflow rejects mismatches and published versions.
- Tools are packed per target into `src-tauri/tool-bundle` by
  `scripts/prepare-tools.mjs`; image codecs are validated by `scripts/image-tools.mjs`.
  Never download tools at runtime.
- `scripts/generate-latest-json.mts` writes the updater manifest; the release workflow signs
  updater artifacts with `TAURI_SIGNING_PRIVATE_KEY` and publishes a draft release. Test
  installers from the draft before publishing.
- Release targets: macOS arm64/x64, Windows x64, Linux x64 (Ubuntu 22.04-compatible).
- Cargo dependencies can affect bundle size and licensing; update `THIRD_PARTY_NOTICES.md` and
  `LICENSES/` sources when adding bundled software.

## Where to make changes

| Change | Start with |
| --- | --- |
| Output setting for a media type | `ui/output-settings/{video,image}-settings/`; config in `types/app.ts` + `-state.ts`; Rust `VideoCompressionConfig`/`ImageCompressionConfig`; `core/ffmpeg.rs`/`core/image.rs` |
| Preset field | `types/preset.ts` field lists; `-presets.ts` pick/apply/save/describe; default preset UI |
| App setting | `stores/settingsStore.ts` + `constants` + `ui/app-settings/*` + `SETTINGS_INDEX` |
| Tauri command | `src-tauri/src/tauri_commands/*`, register in `main.rs`, wrapper in `src/tauri/commands/*`, capability if a plugin permission is needed |
| Rust/Tauri event | `core/domain.rs` + `types/compression.ts`; always clean up listeners |
| Media format | `types/compression.ts` extensions; verify the bundled tool supports it; update input-only/output rules and tests |
| Save behavior | `-save.ts` + `utils/presetOutput.ts`; keep history updates in sync |
| Compression bug | Reproduce with the bundled tool first; trace `StartCompression` → `compress_media_batch` → `FFMPEG`/`ImageCompressor` |
| Translation | `i18n/locales/en.json` plus every other locale; run `pnpm i18n:check` |
| Test | `scripts/test-*.mjs` using `node:test` + `typescript.transpileModule`; add a `package.json` script if it is part of the regular suite |

## Verification checklist

Before calling a change done:

1. `pnpm tsc:check`
2. `pnpm exec biome check .`
3. `pnpm i18n:check` if any user-visible string changed
4. `cd src-tauri && cargo check` (and `cargo clippy` for Rust changes)
5. Relevant `pnpm test:*` scripts; add a `node:test` script for new pure logic
6. Smoke the affected flow in `pnpm tauri:dev`:
   - add a normal video, a portrait video, an image, an audio file
   - trim, speed, transform, target size, GIF, clips
   - batch edit and customize one media
   - save (same folder / ask / fixed folder), unsaved output prompt, compare
   - drop zone / watched folder / CLI if touched
7. Check the changelog entry and version consistency if releasing.

Manual checks matter more than unit tests here: most bugs are interaction/state/ffmpeg graph
issues that type checking cannot catch.

## Known pitfalls (short list)

- Attached cover art: `V:0`, not `v:0`; `[0:V:0]`, not `[0:v]`.
- ReactPlayer `config.file.attributes.style` replaces the default video style: repeat
  width/height/object-fit.
- Portrait videos need an aspect-ratio-sized, bounded player box; a max-height alone lets
  the video overflow the timeline/metadata.
- Audio files are videos without a picture; do not add a third media type.
- Batch and single settings are different objects; update `commonConfigForBatchCompression`
  and call `normalizeBatchMediaConfig` when needed.
- Debounced inputs: call `flushSyncStates()` before reading config for compression.
- Presets must not capture trim/crop/subtitles/custom thumbnails/metadata values/tracks.
- Never overwrite outputs; use `getAvailablePath` and `moveFile`.
- The app is offline; do not add dependencies that phone home.
- Use `t()` for all strings, including toasts and native menus; run the locale check.
