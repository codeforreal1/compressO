import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import { useSnapshot } from 'valtio'

import type { SettingId } from '@/constants/settingsIndex'
import { settingsDialogStore } from '@/stores/settingsDialogStore'
import { slideDownTransition } from '@/utils/animation'
import { cn } from '@/utils/tailwind'

type SettingsSectionProps = {
  title: string
  children: React.ReactNode
  className?: string
  /** A short note beside the title, about this section only */
  description?: React.ReactNode
}

/** A titled group of settings rows, e.g. "Appearance" */
export function SettingsSection({
  title,
  description,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn(['mb-12 last:mb-0', className])}>
      <h2 className="text-base font-semibold text-foreground mb-3">
        {title}
        {/* A note about this section only, beside its title (in brackets & italic) */}
        {description ? (
          <span className="ml-2 text-xs font-normal italic text-zinc-500 dark:text-zinc-400">
            ({description})
          </span>
        ) : null}
      </h2>
      <div className="divide-y divide-zinc-400 dark:divide-zinc-800">
        {children}
      </div>
    </section>
  )
}

type SettingsRowProps = {
  title: React.ReactNode
  description?: React.ReactNode
  /** Control shown on the right, e.g. a switch, button or value */
  children?: React.ReactNode
  /**
   * A setting that depends on the one above it (e.g. only shown when that one is on): indented,
   * with a thread from that setting
   */
  isNested?: boolean
  /**
   * For a setting shown only in some cases (e.g. when the one above is on): it slides in & out
   * when this changes, like the output settings, instead of appearing at once
   */
  isVisible?: boolean
  /** Lets search & links elsewhere open it (see `openSettings`), flashing it once shown */
  settingId?: SettingId
  className?: string
}

/** How long a setting opened from elsewhere is highlighted */
const HIGHLIGHT_DURATION_S = 1.4

/** A single setting: title & description on the left, its control on the right */
export function SettingsRow(props: SettingsRowProps) {
  const {
    title,
    description,
    children,
    isNested,
    isVisible,
    settingId,
    className,
  } = props
  const contentRef = React.useRef<HTMLDivElement>(null)
  const { highlight } = useSnapshot(settingsDialogStore)
  const [highlightKey, setHighlightKey] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!settingId || highlight?.settingId !== settingId) return
    // Shown once: not again when its page is opened later
    settingsDialogStore.highlight = null
    setHighlightKey(highlight.key)
    contentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight, settingId])

  const rowClassName = cn([
    // A thread from the setting above (see `global.css`)
    isNested && 'settings-row-nested',
    className,
  ])
  // The padding is inside, so a row sliding out shrinks to nothing. Its own stacking context keeps
  // the highlight behind its content.
  const content = (
    <div
      ref={contentRef}
      className="relative isolate flex items-center justify-between gap-8 py-4 [:first-child>&]:pt-1"
    >
      {highlightKey != null ? (
        <motion.div
          key={highlightKey}
          aria-hidden
          className="pointer-events-none absolute -inset-x-3 inset-y-1 -z-10 rounded-lg bg-primary/15"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{
            duration: HIGHLIGHT_DURATION_S,
            times: [0, 0.15, 0.7, 1],
          }}
          onAnimationComplete={() => setHighlightKey(null)}
        />
      ) : null}
      <div className="min-w-0">
        <p className="text-sm text-foreground">{title}</p>
        {description ? (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
            {description}
          </div>
        ) : null}
      </div>
      {children ? <div className="flex-shrink-0">{children}</div> : null}
    </div>
  )

  // Passed (even as `undefined`, which hides it) only for a setting shown in some cases
  if (!('isVisible' in props)) {
    return <div className={rowClassName}>{content}</div>
  }

  return (
    // Not when the settings open, only when the setting appears or goes
    <AnimatePresence initial={false}>
      {isVisible ? (
        <motion.div className={rowClassName} {...slideDownTransition}>
          {content}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
