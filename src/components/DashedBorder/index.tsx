import { useId } from 'react'

import { cn } from '@/utils/tailwind'

type DashedBorderProps = {
  /** The corner radius of the element it outlines, in pixels */
  radius: number
  /** Shown in the primary color (e.g. while something is dragged over it) */
  isActive?: boolean
  className?: string
}

/**
 * A dashed outline with the app's glass finish: brighter at the top & fading downwards, like the
 * edge of the frosted controls (a CSS dashed border can only be one flat color). Placed inside a
 * `relative` element, which it outlines; it ignores the pointer.
 */
function DashedBorder({ radius, isActive, className }: DashedBorderProps) {
  // React's ids have colons, which are not safe in an SVG `url(#...)`
  const gradientId = `dashed-border-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`

  return (
    <svg
      aria-hidden="true"
      // Inset by half the stroke, so the whole stroke is inside the element
      className={cn(
        'pointer-events-none absolute inset-px h-[calc(100%-2px)] w-[calc(100%-2px)] overflow-visible',
        isActive ? 'text-primary' : 'text-zinc-400 dark:text-white',
        className,
      )}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor="currentColor"
            className={
              isActive
                ? '[stop-opacity:1]'
                : '[stop-opacity:0.7] dark:[stop-opacity:0.35]'
            }
          />
          <stop
            offset="100%"
            stopColor="currentColor"
            className={
              isActive
                ? '[stop-opacity:1]'
                : '[stop-opacity:0.3] dark:[stop-opacity:0.1]'
            }
          />
        </linearGradient>
      </defs>
      <rect
        width="100%"
        height="100%"
        rx={Math.max(radius - 1, 0)}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={2}
        strokeDasharray="6 5"
        className="transition-colors"
      />
    </svg>
  )
}

export default DashedBorder
