import { useReducedMotion } from 'framer-motion'
import React, { useEffect, useRef } from 'react'

import type { WaveformData } from '@/types/waveform'
import { sizeWaveformCanvas, waveformLevel } from '@/utils/waveform'

export type AudioWaveformProps = {
  waveform: WaveformData | null
  mediaElement: HTMLMediaElement | null
}

/** A fixed waveform with a quiet playback cursor; the bars never scroll or pulse. */
const AudioWaveform = React.forwardRef<HTMLDivElement, AudioWaveformProps>(
  ({ waveform, mediaElement }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const dataRef = useRef(waveform)
    dataRef.current = waveform
    const drawRef = useRef<() => void>(() => {})
    const reducedMotion = useReducedMotion()

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      let frame = 0
      let lastFrame = 0
      let disposed = false
      const levels = new Float32Array(280)
      let cachedShape = ''
      let hasData = false
      const draw = () => {
        const data = dataRef.current
        const width = canvas.clientWidth
        const height = canvas.clientHeight
        if (!width || !height) return
        const ctx = sizeWaveformCanvas(canvas, width, height)
        if (!ctx) return
        ctx.clearRect(0, 0, width, height)
        if (!data) return
        const time = mediaElement?.currentTime ?? 0
        const start =
          Math.floor(
            Math.min(time, Math.max(0, data.duration - 0.001)) /
              data.chunkSeconds,
          ) * data.chunkSeconds
        const span = Math.min(data.chunkSeconds, data.duration - start)
        if (span <= 0) return
        data.requestRange(start, start + span - 0.001, 'preview')
        const available = Math.min(width * 0.84, 1040)
        const left = (width - available) / 2
        const center = height / 2
        const amplitude = Math.min(height * 0.18, 78)
        const color = getComputedStyle(canvas).color
        const bars = Math.min(280, Math.max(24, Math.floor(available / 4)))
        const shape = `${data.revision}:${start}:${span}:${bars}`
        if (cachedShape !== shape) {
          cachedShape = shape
          hasData = false
          for (let index = 0; index < bars; index++) {
            const from = start + (index / bars) * span
            const level = waveformLevel(
              data,
              from,
              start + ((index + 1) / bars) * span,
            )
            levels[index] = level ? Math.pow(level.peak, 0.85) : -1
            if (level) hasData = true
          }
        }
        if (!hasData) return
        const fill = ctx.createLinearGradient(
          0,
          center - amplitude,
          0,
          center + amplitude,
        )
        fill.addColorStop(0, color)
        fill.addColorStop(0.48, color)
        fill.addColorStop(1, 'transparent')
        ctx.fillStyle = fill
        const step = available / bars
        const progress = Math.max(0, Math.min(1, (time - start) / span))
        for (let index = 0; index < bars; index++) {
          if (levels[index] < 0) continue
          const barHeight = Math.max(0.5, levels[index] * amplitude)
          ctx.globalAlpha = index / bars <= progress ? 0.9 : 0.45
          ctx.fillRect(
            left + index * step,
            center - barHeight,
            Math.max(1.5, step * 0.54),
            barHeight * 2,
          )
        }
        ctx.globalAlpha = 0.5
        ctx.fillStyle = color
        ctx.fillRect(
          left + progress * available,
          center - amplitude - 6,
          1,
          amplitude * 2 + 12,
        )
        ctx.globalAlpha = 1
      }
      const stop = () => {
        cancelAnimationFrame(frame)
        frame = 0
      }
      const tick = (now: number) => {
        if (
          disposed ||
          document.hidden ||
          mediaElement?.paused ||
          reducedMotion
        ) {
          stop()
          return
        }
        if (now - lastFrame >= 1000 / 30) {
          draw()
          lastFrame = now
        }
        frame = requestAnimationFrame(tick)
      }
      const update = () => {
        draw()
        if (
          !frame &&
          !document.hidden &&
          mediaElement &&
          !mediaElement.paused &&
          !reducedMotion
        )
          frame = requestAnimationFrame(tick)
        if (document.hidden || mediaElement?.paused) stop()
      }
      drawRef.current = update
      const resize = new ResizeObserver(update)
      resize.observe(canvas)
      const theme = new MutationObserver(update)
      theme.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      })
      const events = [
        'play',
        'pause',
        'seeked',
        'ended',
        'loadedmetadata',
        'ratechange',
      ]
      for (const event of events) mediaElement?.addEventListener(event, update)
      // Reduced motion still follows seeks/playhead without a frame-by-frame animation.
      mediaElement?.addEventListener('timeupdate', update)
      document.addEventListener('visibilitychange', update)
      update()
      return () => {
        disposed = true
        stop()
        resize.disconnect()
        theme.disconnect()
        for (const event of events)
          mediaElement?.removeEventListener(event, update)
        mediaElement?.removeEventListener('timeupdate', update)
        document.removeEventListener('visibilitychange', update)
        drawRef.current = () => {}
      }
    }, [mediaElement, reducedMotion])

    useEffect(() => {
      dataRef.current = waveform
      drawRef.current()
    }, [waveform])

    return (
      <div
        ref={ref}
        className="h-full w-full text-primary pointer-events-none"
        aria-hidden="true"
      >
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>
    )
  },
)
AudioWaveform.displayName = 'AudioWaveform'
export default AudioWaveform
