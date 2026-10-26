/** Audio size budgets use decimal MB, like the rest of the app. */
export const AUDIO_TARGET_BYTES_PER_MB = 1_000_000
export const MIN_AUDIO_TARGET_SIZE_IN_MB = 0.001
export const MAX_AUDIO_TARGET_SIZE_IN_MB = 10000

export type AudioTargetSizePlan = {
  sizeInBytes: number
  bitrate: number
  minimumSizeInMB: number
  isTooSmall: boolean
}

const AUDIO_TARGET_CODECS: Record<string, readonly string[]> = {
  mp3: ['libmp3lame'],
  m4a: ['aac'],
  ogg: ['libvorbis', 'libopus'],
  opus: ['libopus'],
}

/** Explicit codecs are respected, including codecs without bitrate size control. */
export function supportsAudioTargetSize(
  extension: string,
  codec?: string | null,
) {
  const codecs = AUDIO_TARGET_CODECS[extension]
  return !!codecs && (!codec || codec === '-' || codecs.includes(codec))
}

/** Vorbis managed bitrates depend on both sample rate and channel count. */
export function getVorbisTargetSettings(sampleRate = 48000, channels = 2) {
  const rates = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]
  const rate = rates.reduce(
    (best, value) =>
      Math.abs(value - sampleRate) < Math.abs(best - sampleRate) ? value : best,
    rates[0],
  )
  const count =
    Number.isFinite(channels) && channels > 0 ? Math.floor(channels) : 2
  const minimum =
    rate <= 8000
      ? 8 * count
      : rate <= 24000
        ? 16 * count
        : count === 1
          ? 32
          : 24 * count
  const maximumPerChannel =
    rate <= 8000
      ? 32
      : rate <= 12000
        ? 48
        : rate <= 16000
          ? 96
          : rate <= 24000
            ? 64
            : rate <= 32000
              ? 160
              : 192
  return {
    sampleRate: rate,
    minimum,
    maximum: Math.max(minimum, Math.min(256, maximumPerChannel * count)),
  }
}

export function planAudioTargetSize({
  targetSizeInMB,
  durationInSeconds,
  extension,
  codec,
  sampleRate,
  channels,
}: {
  targetSizeInMB: number
  durationInSeconds: number
  extension: string
  codec?: string | null
  sampleRate?: number
  channels?: number
}): AudioTargetSizePlan | null {
  if (
    !supportsAudioTargetSize(extension, codec) ||
    !Number.isFinite(targetSizeInMB) ||
    targetSizeInMB <= 0 ||
    targetSizeInMB > MAX_AUDIO_TARGET_SIZE_IN_MB ||
    !Number.isFinite(durationInSeconds) ||
    durationInSeconds <= 0
  )
    return null

  const vorbis =
    extension === 'ogg' && codec !== 'libopus'
      ? getVorbisTargetSettings(sampleRate, channels)
      : null
  const minimumBitrate = vorbis?.minimum ?? 8
  const maximumBitrate = vorbis?.maximum ?? (extension === 'mp3' ? 320 : 256)
  const sizeInBytes = Math.floor(targetSizeInMB * AUDIO_TARGET_BYTES_PER_MB)
  // Keep room for headers, metadata and bitrate drift, especially for short clips.
  const overhead = 4096
  const availableBitrate = Math.floor(
    ((sizeInBytes * 0.97 - overhead) * 8) / durationInSeconds / 1000,
  )
  const minimumSizeInMB =
    ((minimumBitrate * 1000 * durationInSeconds) / 8 + overhead) /
    0.97 /
    AUDIO_TARGET_BYTES_PER_MB
  return {
    sizeInBytes,
    bitrate: Math.max(
      minimumBitrate,
      Math.min(maximumBitrate, availableBitrate),
    ),
    minimumSizeInMB,
    isTooSmall: availableBitrate < minimumBitrate,
  }
}
