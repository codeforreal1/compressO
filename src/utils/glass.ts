import { cn } from '@/utils/tailwind'

/**
 * The frosted glass look of the app's controls (like the website's buttons): a raised surface (e.g.
 * the chosen tab, a button) with a light gradient, a thin bright edge, a highlight along its top & a
 * soft shadow, on a faint track with a thin grey border
 */
export const glassSurface = cn(
  'border border-zinc-300/70 bg-gradient-to-b from-white to-zinc-50',
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_4px_rgba(0,0,0,0.08)]',
  'dark:border-white/20 dark:from-white/20 dark:to-white/10',
  'dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_8px_rgba(0,0,0,0.25)]',
)

/** The surface a little brighter, while hovered */
export const glassSurfaceHover = cn(
  'data-[hover=true]:from-white data-[hover=true]:to-zinc-100',
  'dark:data-[hover=true]:border-white/[0.28] dark:data-[hover=true]:from-white/[0.26] dark:data-[hover=true]:to-white/[0.14]',
)

/**
 * The same finish on a colored surface (e.g. an orange button), keeping its color: a light gradient
 * over it, a thin bright edge inside it (so its size stays the same), a highlight along its top & a
 * soft shadow
 */
export const glassTint = cn(
  'bg-gradient-to-b from-white/[0.18] to-transparent',
  'ring-1 ring-inset ring-white/20',
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2px_8px_rgba(0,0,0,0.2)]',
)

/** What surfaces sit on (e.g. the tabs' & a toggle's track, an input's field) */
export const glassTrack = cn(
  'border border-zinc-200 bg-zinc-100',
  'dark:border-white/[0.08] dark:bg-white/[0.03]',
)

/** The track a little brighter, while hovered */
export const glassTrackHover = cn(
  'data-[hover=true]:bg-zinc-200/60 dark:data-[hover=true]:bg-white/[0.06]',
)

/** A menu's option while hovered or focused (e.g. the chosen one when it opens): a faint wash */
export const glassMenuItem = cn(
  'rounded-md',
  'data-[hover=true]:bg-zinc-900/[0.04] dark:data-[hover=true]:bg-white/[0.05]',
  'data-[focus=true]:bg-zinc-900/[0.04] dark:data-[focus=true]:bg-white/[0.05]',
  'data-[selectable=true]:focus:bg-zinc-900/[0.04] dark:data-[selectable=true]:focus:bg-white/[0.05]',
  'data-[focus-visible=true]:bg-zinc-900/[0.04] dark:data-[focus-visible=true]:bg-white/[0.05]',
)

/** A thin grey border, e.g. for menus & popovers */
export const glassBorder = 'border border-zinc-200 dark:border-white/10'

/**
 * HeroUI `classNames` with the app's look added: the app's classes per slot, then those passed (so
 * a screen's own classes still win)
 */
export function mergeClassNames<T extends Record<string, unknown>>(
  base: Partial<Record<keyof T, string>>,
  passed: T | undefined,
): T {
  const slots = new Set([
    ...Object.keys(base),
    ...Object.keys(passed ?? {}),
  ]) as Set<keyof T>
  return Object.fromEntries(
    [...slots].map((slot) => [
      slot,
      cn(base[slot], passed?.[slot] as string | undefined),
    ]),
  ) as T
}
