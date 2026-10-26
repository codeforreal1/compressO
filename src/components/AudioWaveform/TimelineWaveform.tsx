import { useEffect, useRef } from 'react'

import type { WaveformData } from '@/types/waveform'
import { sizeWaveformCanvas, waveformLevel } from '@/utils/waveform'

type TimelineWaveformProps = {
  waveform: WaveformData
  start: number
  end: number
  keptSegments?: readonly { start: number; end: number }[] | null
}

/** Only allocate/draw the visible viewport, even when the action is hundreds of thousands of pixels wide. */
export default function TimelineWaveform({
  waveform,
  start,
  end,
  keptSegments,
}: TimelineWaveformProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const viewport = host.closest('.timeline-editor') ?? host.parentElement
    if (!viewport) return
    let frame = 0
    let requestTimer: ReturnType<typeof setTimeout> | undefined
    const draw = () => {
      frame = 0
      const rect = host.getBoundingClientRect()
      const bounds = viewport.getBoundingClientRect()
      if (rect.width <= 0 || bounds.width <= 0) return
      const left = Math.max(0, bounds.left - rect.left)
      const width = Math.max(
        0,
        Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left),
      )
      if (!width) return
      canvas.style.left = `${left}px`
      const ctx = sizeWaveformCanvas(canvas, width, 24)
      if (!ctx) return
      ctx.clearRect(0, 0, width, 24)
      const from = start + (left / rect.width) * (end - start)
      const to = start + ((left + width) / rect.width) * (end - start)
      clearTimeout(requestTimer)
      requestTimer = setTimeout(
        () => waveform.requestRange(from, to, 'timeline'),
        120,
      )
      const color = getComputedStyle(host).color
      const gradient = ctx.createLinearGradient(0, 0, 0, 24)
      gradient.addColorStop(0, color)
      gradient.addColorStop(0.5, color)
      gradient.addColorStop(1, 'transparent')
      ctx.fillStyle = gradient
      for (let x = 0; x < width; x += 3) {
        const time = from + (x / width) * (to - from)
        const level = waveformLevel(
          waveform,
          time,
          from + ((x + 3) / width) * (to - from),
        )
        if (!level) continue
        const kept =
          !keptSegments?.length ||
          keptSegments.some(
            (segment) => time >= segment.start && time <= segment.end,
          )
        ctx.globalAlpha = kept ? 0.65 : 0.13
        const amplitude = Math.max(0.5, Math.sqrt(level.peak) * 11)
        ctx.fillRect(x, 12 - amplitude, 2, amplitude * 2)
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(host)
    resize.observe(viewport)
    viewport.addEventListener('scroll', schedule, true)
    const theme = new MutationObserver(schedule)
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(requestTimer)
      resize.disconnect()
      theme.disconnect()
      viewport.removeEventListener('scroll', schedule, true)
    }
  }, [waveform, start, end, keptSegments])
  return (
    <div
      ref={hostRef}
      className="absolute inset-0 pointer-events-none text-primary"
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="absolute top-0" />
    </div>
  )
}
