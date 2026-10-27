import type { WaveformData } from '@/types/waveform'

/** Read an interval without allocating PCM or a second waveform array. Missing chunks stay empty. */
export function waveformLevel(data: WaveformData, start: number, end: number) {
  let peak = 0
  let energy = 0
  let count = 0
  const first = Math.max(0, Math.floor(start / data.chunkSeconds))
  const last = Math.min(
    Math.ceil(data.duration / data.chunkSeconds) - 1,
    Math.floor(end / data.chunkSeconds),
  )
  for (let chunkIndex = first; chunkIndex <= last; chunkIndex++) {
    const chunk = data.chunks.get(chunkIndex)
    if (!chunk) continue
    const offset = chunkIndex * data.chunkSeconds
    const from = Math.max(0, Math.floor((start - offset) * chunk.sampleHz))
    const to = Math.min(
      chunk.values.length / 2,
      Math.max(from + 1, Math.ceil((end - offset) * chunk.sampleHz)),
    )
    for (let index = from; index < to; index++) {
      peak = Math.max(peak, chunk.values[index * 2] / 65535)
      const rms = chunk.values[index * 2 + 1] / 65535
      energy += rms * rms
      count++
    }
  }
  return count ? { peak, rms: Math.sqrt(energy / count) } : null
}

export function sizeWaveformCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const ratio = Math.min(
    window.devicePixelRatio || 1,
    2,
    2048 / Math.max(1, width),
    768 / Math.max(1, height),
  )
  const w = Math.max(1, Math.ceil(width * ratio))
  const h = Math.max(1, Math.ceil(height * ratio))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const context = canvas.getContext('2d')
  context?.setTransform(ratio, 0, 0, ratio, 0, 0)
  return context
}
