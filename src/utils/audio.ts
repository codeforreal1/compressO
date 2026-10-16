/**
 * Bitrate (kbps) an audio file is compressed to from the Quality slider (0-100), unless a bitrate
 * is chosen: 128 kbps at the default 50%, a common size for music that still sounds clear.
 * Lossless formats (WAV, FLAC) ignore it.
 */
export function getAudioBitrateForQuality(quality: number | null | undefined) {
  const value = quality ?? 50
  if (value <= 20) return 64
  if (value <= 40) return 96
  if (value <= 60) return 128
  if (value <= 80) return 192
  return 256
}
