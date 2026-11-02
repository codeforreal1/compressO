# Image dynamic range on macOS

On macOS 15 and later, image settings offer one operation based on the **original source**:

- SDR: **HDR boost**, off by default, with intensity from 1× to 4× (default 2×).
- HDR: **Remove HDR**, off by default.
- Unknown or unsupported images: neither operation. Mixed batches use per-image controls;
  a homogeneous batch can use its shared toggle. Animated/multi-image sources are not processed.

Turning on an operation does not change the source classification or replace the control.
Image presets retain the operation and intensity. An operation applies only to matching sources;
it has no effect on other images, earlier macOS versions, or other operating systems.

The existing Rust–Swift bridge calls Core Image/ImageIO on a blocking worker. Detection checks
both Apple and ISO gain maps, HDR transfer functions, and content headroom. A ten-bit image or
wide-gamut Display P3 profile alone does not establish HDR. This requires macOS 15 APIs, without
raising the app's minimum system version. Export is independent of the current display;
viewing the full HDR brightness requires a compatible display and viewer.

Boost applies a linear exposure gain in a floating-point working space, then writes a 16-bit
PQ PNG intermediate with proper color signaling. Intensity 1× adds no exposure. Alpha is not
boosted. This effect increases brightness; it cannot recover missing highlight detail.
Boost output is PNG, JPEG XL, or JPEG (`.jpg`/`.jpeg`). All formats remain selectable; the boost switch is disabled
for other outputs, with an info tooltip explaining the supported formats. “Same as input”
uses each source’s actual extension. Stored boost preferences are inactive for incompatible
outputs; the selected output format is never changed automatically. HDR PNG uses lossless
optimization, never eight-bit palette quantization. JPEG XL supports both lossless and lossy encoding.

JPEG uses native Core Image gain-map export, with the original SDR rendition as its compatible
base and the boosted HDR rendition as the alternate. It adds no executable or third-party
dynamic library. Both renditions are prepared once, transformed identically, and kept together
through quality and target-size attempts. The final JPEG is never passed to jpegoptim or generic
metadata stripping. Privacy metadata can be removed while retaining the gain map.
Existing HDR images exported to JPEG with Remove HDR off use this same preservation path.
HDR JPEG encoding is quality-based, so lossless mode is unavailable for it; an info tooltip
points to PNG/JPEG XL for lossless output. Transparent pixels are composited against black
in both renditions because JPEG does not support alpha.

SDR conversion requests the intended SDR rendition from Core Image, including tone mapping for
direct PQ/HLG content and an SDR rendering for gain-map images. It exports a color-managed SDR
PNG intermediate with no gain map, then uses the selected existing image encoder. HDR tags are
not merely deleted. Both operations happen once before transforms and target-size retries.
Cancellation discards the intermediate after native processing finishes. Temporary workspaces
are removed on success, cancellation, or error. Private-metadata settings apply to the processed
image; necessary color information is retained. Lossless encoding preserves the adjusted
pixels, not the original pixels before the adjustment.

## Validation

```sh
pnpm test:image-dynamic-range
cargo test --manifest-path src-tauri/Cargo.toml core::image -- --include-ignored
pnpm tsc:check
pnpm i18n:check
```

Native tests cover range detection, intensity, invalid parameters, alpha, PQ/HLG JPEG XL,
an ISO gain-map JPEG, generated HDR JPEGs at multiple intensities and qualities, SDR fallback,
HDR rendering, paired transforms, quality retries, and gain-map recompression. The fixture is synthetic, generated locally with:

```sh
swift scripts/generate-image-hdr-fixture.swift src-tauri/tests/fixtures/image-hdr/gain-map.jpg
```

Real HDR appearance should also be checked on macOS 15 and later with an HDR display. The
automated checks verify encoded pixels, alpha, and signaling; they do not measure a display.
