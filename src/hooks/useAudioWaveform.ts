import { useEffect, useMemo, useState } from 'react'

import { cancelWaveform, getAudioWaveform } from '@/tauri/commands/waveform'
import type { WaveformChunk, WaveformData } from '@/types/waveform'

export type AudioWaveformOptions = {
  path?: string | null
  duration: number
  sizeInBytes?: number | null
  enabled: boolean
  track?: number
}

/** One small-file pass; large files fetch only visible/playback chunks and one ahead. */
export function useAudioWaveform({
  path,
  duration,
  sizeInBytes,
  enabled,
  track = 0,
}: AudioWaveformOptions): WaveformData | null {
  const [visible, setVisible] = useState(() => !document.hidden)
  const [revision, setRevision] = useState(0)
  const model = useMemo(
    () => ({
      source: `${path ?? ''}:${track}`,
      chunks: new Map<number, WaveformChunk>(),
      ranges: new Map<string, number[]>(),
      failed: new Set<number>(),
      chunkSeconds:
        duration <= 300 && (sizeInBytes ?? 0) <= 256 * 1024 * 1024
          ? Math.max(duration, 0.02)
          : 30,
      requestRange: (_start: number, _end: number, _consumer: string) => {},
    }),
    [path, duration, sizeInBytes, track],
  )

  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    if (
      !path ||
      !enabled ||
      !visible ||
      !Number.isFinite(duration) ||
      duration <= 0
    )
      return
    let disposed = false
    let running = false
    let active: { id: string; chunk: number } | null = null
    const count = Math.ceil(duration / model.chunkSeconds)
    const desired = () => [...new Set([...model.ranges.values()].flat())]
    const pump = async () => {
      if (running || disposed) return
      running = true
      try {
        while (!disposed) {
          const chunk = desired().find(
            (index) => !model.chunks.has(index) && !model.failed.has(index),
          )
          if (chunk === undefined) break
          const request = { id: `waveform-${crypto.randomUUID()}`, chunk }
          active = request
          try {
            const data = await getAudioWaveform(
              path,
              chunk,
              model.chunkSeconds,
              request.id,
              track,
            )
            if (disposed) break
            model.chunks.set(chunk, data)
            // Bounded memory even for day-long media; revisits read the disk cache.
            while (model.chunks.size > 64) {
              const evict = [...model.chunks.keys()].find(
                (index) => !desired().includes(index),
              )
              if (evict === undefined) break
              model.chunks.delete(evict)
            }
            setRevision((value) => value + 1)
          } catch (error) {
            if (disposed) break
            if (!String(error).includes('CANCELLED')) model.failed.add(chunk)
          } finally {
            if (active === request) active = null
          }
        }
      } finally {
        running = false
      }
    }
    model.requestRange = (start, end, consumer) => {
      if (disposed || !Number.isFinite(start) || !Number.isFinite(end)) return
      const first = Math.max(
        0,
        Math.min(count - 1, Math.floor(start / model.chunkSeconds)),
      )
      const last = Math.max(
        first,
        Math.min(count - 1, Math.floor(end / model.chunkSeconds)),
      )
      // A viewport should never request unbounded analysis when zoomed all the way out.
      const indices = Array.from(
        { length: Math.min(last - first + 1, 8) },
        (_, i) => first + i,
      )
      if (last + 1 < count) indices.push(last + 1)
      const previous = model.ranges.get(consumer)
      if (previous?.join(',') === indices.join(',')) return
      model.ranges.set(consumer, indices)
      if (active && !desired().includes(active.chunk))
        void cancelWaveform(active.id).catch(() => {})
      void pump()
    }
    if (count === 1) model.requestRange(0, duration, 'initial')
    // Reopening a tab or finishing compression resumes the current visible ranges.
    void pump()
    return () => {
      disposed = true
      model.requestRange = () => {}
      if (active) void cancelWaveform(active.id).catch(() => {})
    }
  }, [path, duration, track, enabled, visible, model])

  return path && duration > 0
    ? {
        duration,
        chunkSeconds: model.chunkSeconds,
        chunks: model.chunks,
        revision,
        requestRange: (start, end, consumer) =>
          model.requestRange(start, end, consumer),
      }
    : null
}
