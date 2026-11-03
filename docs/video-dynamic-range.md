# Video dynamic range

Video settings offer one operation based on the **original source**, on macOS, Windows and Linux:

- SDR: **HDR Boost**, off by default, with intensity from 1× to 8× (default 2×).
- HDR (HDR10, HLG, or Dolby Vision with an HDR10/HLG base such as iPhone video): **Remove HDR**,
  off by default.
- Unknown (an untagged 10-bit video, Dolby Vision profile 5): neither operation. Mixed batches use
  per-video controls; a homogeneous batch can use its shared toggle.

Video presets retain the operation and intensity. The backend probes the source again and applies
an operation only when it matches, so the menu bar queue, watched folders and size estimates behave
like the main window.

Everything runs in the bundled FFmpeg; no other tool or native framework is used. Detection reads
the stream's transfer, primaries, matrix, range, pixel format and Dolby Vision configuration with
FFprobe. Conversions use `zscale` (zimg) and `tonemap`, so the Windows and Linux FFmpeg builds must
include zimg (see the CompressO binary builds repository).

## Output

HDR needs a codec and container that carry it: H.265, VP9 or AV1 in MP4, MOV, MKV, WebM or TS.

- An HDR source with Remove HDR off stays HDR: 10-bit (`yuv420p10le`, `p010le` on graphics
  cards, HEVC Main 10 on VideoToolbox) with its colour signaling and HDR10 metadata. When the codec
  is automatic, HEVC is used instead of H.264 so that HDR is kept. Before this, compressed HDR
  videos were 8-bit but still tagged HDR, which banded and showed the wrong brightness.
- An HDR source whose output cannot hold HDR (H.264, MPEG-4, AVI, GIF) is converted to SDR; the
  switch shows this with an info tooltip. Lossless compression keeps the source as it is unless
  Remove HDR is on.
- HDR Boost is disabled, with an info tooltip, for outputs that cannot hold HDR and for lossless
  compression. A stored boost preference is inactive for those outputs; the codec and format are
  never changed automatically.

## Conversion

Both conversions run after trim, speed, crop, straighten and scale, before padding. Each zscale
input option (transfer, primaries, matrix, range) is passed explicitly from the probe, since zimg
cannot convert HLG or untagged frames from their own tags. Untagged SDR is treated as BT.709
(BT.601 below 720 lines).

- Remove HDR: linear light with SDR white at 100 nits, BT.709 primaries, `mobius` tone mapping
  (keeps mid-tones; `hable` made reference white noticeably dark), then 8-bit BT.709. Mastering
  display, content light level and Dolby Vision metadata are removed, as they no longer apply.
- HDR Boost: linear light with SDR white at 203 nits (ITU-R BT.2408), an exposure gain of the
  intensity, then 10-bit PQ BT.2020 (HDR10). Intensity 1× places SDR white at reference white, 2×
  at 406 nits, 4× at 812 nits and 8× at about 1,620 nits. Most HDR screens show 400 to 1,000 nits
  (Apple XDR screens up to 1,600 nits in small areas), so higher intensities are tone mapped or
  clipped by the player rather than shown brighter. This increases brightness; it cannot recover
  missing highlight detail.

Thumbnails of HDR videos are tone mapped the same way, so they do not look washed out.

## Validation

```sh
pnpm test:video-dynamic-range
cargo test --manifest-path src-tauri/Cargo.toml video_dynamic_range
pnpm tsc:check
pnpm i18n:check
```

The native test encodes synthetic PQ, HLG and SDR clips with the bundled FFmpeg and checks the
tone-mapped SDR level, removed HDR metadata, kept 10-bit HDR signaling, and the PQ code values of
boost at 1×, 2×, 4× and 8×. Real HDR appearance should also be checked on an HDR display, with an
iPhone (HLG and Dolby Vision) video.
