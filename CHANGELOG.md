# Changelog

### 4.0.0

Features:

- **Target Size**: Compress videos, images and audio to a chosen file size, such as 10 MB for an email or a chat app. For videos, CompressO estimates the size before compressing, keeps the resolution where it can and compresses again in rounds until the video fits; every attempt is kept, so another one can be chosen under the result. Images get the highest quality that fits, and are made smaller only when needed. Audio gets the bitrate that fits, in the chosen format.
- **Much Smaller App Size**: The app size is now about 45 to 50 MB, down from around 75 to 80 MB, even though CompressO does far more than before. The compression tools are packed in one compressed archive and unpacked on the first launch, which shows its progress.
- **Drop Zone**: Drop or paste media on the menu bar (macOS) or the system tray (Windows) to compress it without opening the app. It can compress automatically, and the queue can be paused, stopped and tried again. Each file shows how much smaller it became.
- **Watch Folder**: Choose folders, such as screen recordings or downloads, whose new media is compressed automatically with their presets. Files made by CompressO are never compressed again.
- **Compression History**: See every compression in Settings, with the space saved in total, and search it by name, folder or preset. Each original and output can be shown in its folder.
- **Presets**: Save video, image and audio settings as presets, each with its own save location and file name prefix, choose the default preset for new media and manage presets in Settings.
- **Languages**: CompressO is now available in Simplified and Traditional Chinese, Russian, Spanish, Portuguese, German, French, Japanese, Korean, Polish, Turkish, Italian, Indonesian, Vietnamese and Hindi, chosen in Settings.
- **Audio Compression**: Compress audio files, and extract the audio of videos.
- **Hardware Acceleration**: Compress videos faster with the graphics card (Settings, under Output).
- **Faster AV1**: AV1 videos are compressed much faster.
- **Saving**: Save automatically to a chosen folder or next to the originals, keep the folder structure of dropped folders, skip outputs that are larger than the original, replace the original files and copy outputs to the clipboard.
- **Startup**: Open CompressO at login, optionally in the menu bar or system tray only.
- **Batch Improvements**: Add more media to a selection, pause a batch, set one resolution for all videos and choose any video codec for mixed batches. Videos, images and audio are compressed side by side, so images and audio no longer wait for videos.
- **Transform Previews**: See rotations, flips and crops live, also for videos and animated GIFs, and keep them in presets.
- **New Formats**: Support for JPEG XL, HEIC, AVIF, BMP, TIFF, M4V, MTS, M2TS and TS.
- **Audio Waveforms**: See the waveform of audio files and of the sound of videos in previews and on the trim timeline. It can be turned off in Settings.
- **System Theme**: CompressO follows the light or dark appearance of the system by default, and changes along with it. Light or Dark can still be chosen in Settings.
- **Completion Sound**: Play a sound when a compression completes.
- **Keep Awake**: Prevent the computer from sleeping while compressing.
- **Redesigned Settings**: Settings are now a dialog with a sidebar and a search field, available from the app menu and with Cmd/Ctrl + comma. Messages that mention a setting link to it.
- **Keyboard Shortcuts**: Start and cancel a compression with Cmd/Ctrl + Shift + Enter, and reconfigure with Cmd/Ctrl + Shift + R.
- **New Logo**: A new CompressO logo and app icon.

Enhancements:

- The app asks before quitting while media is being compressed or is not saved yet.
- Disabled settings explain why they are disabled.
- A tinted window and an accent color can be chosen in Settings.
- HEVC videos can be previewed and played on macOS.
- Photos with an EXIF orientation are shown upright.
- Log files are kept by date, and can be opened from Settings.
- Video previews on Linux can be turned on in Settings.
- Modern images, such as AVIF and HEIC, are previewed directly when the system supports them.
- Update notes show what changed in every version since the installed one, and the changelog can be opened from Settings, under About.
- The compression tools are checked when the app starts, and repaired when they are damaged.
- Target Size explains why it cannot be used for some formats, such as GIF, and compressing waits until another format or Quality is chosen.
- Reconfigure is not offered once compressed files have replaced their originals, as the originals were moved to the Trash.
- Media from the drop zone that cannot be saved next to its original, such as a file in a read-only folder, is saved in the app's own folder instead.

Bug Fixes:

- Fixed the progress of videos with a custom speed.
- Fixed batches stopping when a single file fails.
- Fixed saving next to files on network drives.
- Fixed showing saved files in their folder on Windows.
- Fixed a crash when a file is opened while the app launches.
- Fixed audio playback and video previews on Linux.
- Fixed the window flashing briefly after animations on Windows.
- Fixed a crash with some images on Windows.
- Fixed the app becoming unresponsive when the system denies access to a file.
- Fixed copying, pasting and showing files in their folder on Linux.
- Fixed the crop shape picked right before saving a transform being lost.
- Fixed converting images to WebP on some systems.
- Fixed compressing JPEG images on some Intel Macs.
- Fixed play buttons, drop zone outlines and the selected settings page being hard to see in light mode.

### 3.0.0

Features:

- **Image Compression Support**: Comprehensive image compression for JPEG, PNG, WebP, and GIF formats with quality controls and optimization options.
- **Image Transformations**: Full transformation support for images including crop, rotate, flip, and dimension adjustments.
- **SVG Conversion**: Convert SVG files to PNG, JPEG, or WebP formats with advanced settings for raster to SVG conversion.
- **Video to GIF Conversion**: Convert videos to animated GIFs with customizable quality and FPS settings.
- **GIF Compression**: Compress animated GIFs while maintaining quality and reducing file size.
- **Cross-Container Image Conversion**: Convert between different image formats (JPEG, PNG, WebP, GIF) seamlessly.
- **Output Comparison Slider**: Compare original and compressed images/videos with an interactive before/after slider.
- **In-App Updater**: Built-in updater to notify and download new releases automatically within the application.
- **Video Speed Control**: Adjust video playback speed for faster preview and review.
- **Image Metadata Preservation**: Preserve EXIF and other metadata when compressing images.
- **Full Image Information View**: View detailed information about image files including dimensions, format, EXIF metadata, etc.

Enhancements:

- **Linux Video Playback**: Implemented local axum server to serve video assets on Linux, enabling video playback that was previously unsupported on WebGTK.
- **Improved Compression Settings**: Enhanced compression settings UI with better controls and options for both video and image compression.
- **Better Output Stats Display**: Improved the display of compression statistics showing before/after file sizes and savings percentage.
- **Advanced SVG Support**: Added support for converting large SVG files to PNG for thumbnail rendering and better compatibility.
- **Piped Process Support**: Refactored media processing to support piped commands, enabling more complex transformation workflows.
- **Central Process Executor**: Implemented central process executor using builder pattern for better process management and error handling.
- **Subtitle Handling**: Improved subtitle embedding with better preservation of language and title metadata.
- **Metadata Stripping**: Enhanced metadata stripping functionality with more granular controls.
- **New Brand Identity**: Updated logo and app icon across all platforms.
- **Batch Compression**: Extended batch compression settings to fully support image compression alongside video compression.

Bug Fixes:

- Fixed dimension calculation issue during image crop operations.
- Fixed output path display after media is saved.
- Fixed FPS not being properly applied during GIF conversion.
- Fixed subtitle embedding issues for multiple container formats.

### 2.1.1
Enhancements:
- Make configuration settings label font weight bold for better visibility [5fcb190](https://github.com/codeforreal1/compressO/commit/5fcb1903c1f119d55fd54a2ddc43863dafd79f08)

Bug Fixes:
- Fix duration format missing showing hour duration [14f2b0d](https://github.com/codeforreal1/compressO/commit/14f2b0d485f11bc89b8897fe4436a97babfdff2f)
- Fix app About color issues [5fcb190](https://github.com/codeforreal1/compressO/commit/5fcb1903c1f119d55fd54a2ddc43863dafd79f08)

### 2.1.0

Features:
- Subtitle Upload: You can now upload single or multiple subtitle and embed in the final output video. You can upload subtitles from `Others` tab.
- Download Embedded Subtitle from the video: You can also download the embedded subtitles of the video in SRT or VTT format. You can download these subtitles from `Subtitles` tab of the full video info overlay.
- Theme Color: You can customize the color of the app to your liking. The selected color will be applied to everywhere on the app.
- Audio Amplification: You can now amplify the volume up-to 200% of the original audio.
- Capture Current Frame: You can now capture the current frame from the video player and copy it to the clipboard. Just right click on the video player and the context menu will show up to do so.
- Progress % in Dock: MacOS dock icon now shows progress % during processing.

Enhancements:
- Light Mode for Timeline Bar: Video player timeline and trimmer timeline gets light theme mode support.
- Timeline Performance Improvements: Timeline performance has been heavily improved. Earlier it used to show blank spaces due to constant auto-scroll update during video play progress but now it has been updated to only scroll when the cursor goes out of view.
- Metadata improvements: Metadata inputs are now controlled to sync the value properly during batch videos and single video mode. 

### 2.0.0

Features:

- Batch compression.
- Video trim/split functionality.
- Video player for Mac & Windows. Note: Linux WebGTK does not support playing local videos, so this feature is not available on Linux.
- Paste video files from clipboard. Paste a directory from clipboard for batch compression.
- Drag & drop a directory containing videos for batch compression.
- Open video files in CompressO directory from file managers. Just right click and select "Open with CompressO"
- Full video information including video container, video, audio, subtitles, chapters, etc.
- Copy compressed video to clipboard functionality.
- Video codec selection.
- Brand new Audio tab containing:
    - Audio codec selection.
    - Audio track selection.
    - Audio channel manipulation.
    - Audio bit rate manipulation.
    - Audio volume adjustment.
- Video metadata editing (title, artist, album, year, genre, description, comments, synopsis, copyright, creation date, etc.).
- Custom thumbnail for video. The thumbnail shows as a preview on file managers.
- Homebrew support for macOS installation.

Enhancements:

- Revamped UI with tabs for video, audio, and metadata settings.
- Improved slider UI components.
- Thumbnail regeneration for videos on image thumbnail mode.
- Video frame capture for transformations.

Bug Fixes:

- Remove support for 32-bit Windows.
- Windows release builds have been changed to `nsis` from `msi` for better compatibility.
- Fix Linux desktop template file to be more specific. [LINK](https://github.com/codeforreal1/compressO/issues/72)
- Preserve audio tracks when the video contains multiple audio tracks. [LINK](https://github.com/codeforreal1/compressO/issues/23)
- Fix drag & drop issue on Windows.

### 1.4.0
Bug Fixes:

- Fixed drag and drop issue on Windows [646aa54102138cc1b710ae42455a099ffdc78a8f](https://github.com/codeforreal1/compressO/commit/646aa54102138cc1b710ae42455a099ffdc78a8f)

### 1.3.0
Features:

- Brand new geometric transformation that enables ability o crop, rotate, flip, etc. the video. [6bf6e193d4892b2da93caa59a87ff825c35b2b43](https://github.com/codeforreal1/compressO/commit/6bf6e193d4892b2da93caa59a87ff825c35b2b43)
- Ability to change video dimensions (resolution) [37d11f436050eab42c4f619b35cc9707987a26b8](https://github.com/codeforreal1/compressO/commit/37d11f436050eab42c4f619b35cc9707987a26b8)
- Ability to change the FPS of the video [ea8ec436ac09773d9604a45c36cb93239226b778](https://github.com/codeforreal1/compressO/commit/ea8ec436ac09773d9604a45c36cb93239226b778)

Enhancements:

- Revamped UI

### 1.2.0

Features:

- File Drag & Drop support [d744fab04f85f6fd40c59b306486235c171d6fb3](https://github.com/codeforreal1/compressO/commit/d744fab04f85f6fd40c59b306486235c171d6fb3)
- Cancel in-progress compression [ca5bceb9fde92bcbf9c8ef418691e21278aac9e6](https://github.com/codeforreal1/compressO/commit/ca5bceb9fde92bcbf9c8ef418691e21278aac9e6)
- Quality slider to select from low, medium or hight compression quality [b65647ce89082243afad7e83b782200a251c3c10](https://github.com/codeforreal1/compressO/commit/b65647ce89082243afad7e83b782200a251c3c10)

Enhancements:

- Video configuration UI has been revamped to adjust new settings [b65647ce89082243afad7e83b782200a251c3c10](https://github.com/codeforreal1/compressO/commit/b65647ce89082243afad7e83b782200a251c3c10)
- Window size and position persistence. [cf0644c5a6db7cc1e42841dc0d88fb039df3e1d5](https://github.com/codeforreal1/compressO/commit/cf0644c5a6db7cc1e42841dc0d88fb039df3e1d5)

Bug Fixes:

- Window size and position persistence on every restart. https://github.com/codeforreal1/compressO/issues/2
- Accessibility fixes for scaled resolutions [315b26fbf71dcfb4fce93ebe12a78214f332874c](https://github.com/codeforreal1/compressO/commit/315b26fbf71dcfb4fce93ebe12a78214f332874c)

### 1.1.0

Features:

- Ability to mute video. ([5a44b7cb9e77a393bfe117bf79aca8b266d665cd](https://github.com/codeforreal1/compressO/commit/b0e5b60c250c69454fc38c0112c57f7a55f265de))

Enhancements:

- The minimum window height is reduced from 992 to 800 to adjust on smaller screens. ([93b04dc9ff9669b5a1fb9e1e586293aca2689636](https://github.com/codeforreal1/compressO/commit/93b04dc9ff9669b5a1fb9e1e586293aca2689636))

Bug Fixes:

- Fix typo `vide_duration`. ([f73df39f223e023611b0c4e35daf5814edd4af7c](https://github.com/codeforreal1/compressO/commit/f73df39f223e023611b0c4e35daf5814edd4af7c)). Thanks to [mbifulco](https://github.com/mbifulco) for the PR.
- Update Readme to reflect correct windows installer extension. ([6459892acf37db67aab27342aa5dae39d4fc7987](https://github.com/codeforreal1/compressO/commit/6459892acf37db67aab27342aa5dae39d4fc7987)).
