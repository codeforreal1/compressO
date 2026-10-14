import React from 'react'

import { cn } from '@/utils/tailwind'

type SettingsSectionProps = {
  title: string
  children: React.ReactNode
  className?: string
}

/** A titled group of settings rows, e.g. "Appearance" */
export function SettingsSection({
  title,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn(['mb-12 last:mb-0', className])}>
      <h2 className="text-base font-semibold text-foreground mb-3">{title}</h2>
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
  className?: string
}

/** A single setting: title & description on the left, its control on the right */
export function SettingsRow({
  title,
  description,
  children,
  isNested,
  className,
}: SettingsRowProps) {
  return (
    <div
      className={cn([
        'flex items-center justify-between gap-8 py-4 first:pt-1',
        // A thread from the setting above (see `global.css`)
        isNested && 'settings-row-nested',
        className,
      ])}
    >
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
}
