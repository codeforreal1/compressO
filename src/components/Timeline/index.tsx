import { TimelineAction, TimelineRow } from '@xzdarcy/timeline-engine'
import { FC } from 'react'

import TimelineWaveform from '@/components/AudioWaveform/TimelineWaveform'
import type { WaveformData } from '@/types/waveform'
import { formatDuration } from '@/utils/string'

export const BoundaryRowActionRender: FC<{
  action: TimelineAction
  row: TimelineRow
  /** Parts of the action that are kept; the rest is left empty as trimmed out */
  keptSegments?: readonly { start: number; end: number }[] | null
  waveform?: WaveformData | null
}> = ({ action, keptSegments, waveform }) => {
  const duration = action.end - action.start
  const isTrimmed = !!keptSegments?.length && duration > 0
  const keptDuration = isTrimmed
    ? keptSegments.reduce((total, s) => total + (s.end - s.start), 0)
    : duration

  return (
    <div
      className={`relative flex justify-center items-center rounded-lg ${waveform ? 'h-6 mt-0' : 'h-[2px] mt-3'} ${
        isTrimmed || waveform ? 'bg-transparent' : 'bg-primary'
      }`}
    >
      {waveform ? (
        <TimelineWaveform
          waveform={waveform}
          start={action.start}
          end={action.end}
          keptSegments={keptSegments}
        />
      ) : null}
      {isTrimmed && !waveform
        ? keptSegments.map((segment) => (
            <div
              key={`${segment.start}-${segment.end}`}
              className="absolute top-0 h-full bg-primary rounded-lg"
              style={{
                left: `${((segment.start - action.start) / duration) * 100}%`,
                width: `${((segment.end - segment.start) / duration) * 100}%`,
              }}
            />
          ))
        : null}
      <p className="relative text-[11px] text-center text-zinc-800 dark:text-zinc-300 bg-zinc-200 dark:bg-zinc-800 rounded-lg px-2">{`${keptDuration.toFixed(2)}s`}</p>
    </div>
  )
}

export const ScaleRender: FC<{
  scale: number
}> = ({ scale }) => {
  const formatted = formatDuration(scale, { disableMilliseconds: true })
  return (
    <span className="text-[11px] text-zinc-700 dark:text-zinc-400">
      {formatted}
    </span>
  )
}
