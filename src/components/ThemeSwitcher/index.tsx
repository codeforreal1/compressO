import { useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'

import GlidingToggle from '@/components/GlidingToggle'
import Icon from '@/components/Icon'
import {
  applyTheme,
  resolveTheme,
  setThemePreference,
  THEME_PREFERENCES,
  type ThemePreference,
  useTheme,
} from '@/hooks/useTheme'

const ICONS = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
} as const

type ThemeSwitcherProps = {
  /** Of the reveal of the new look, in milliseconds */
  duration?: number
  className?: string
}

/**
 * The look of the app: the system's, light or dark. A new look is revealed in a circle growing
 * from the option clicked; one that looks the same (e.g. the system's, when it is already shown)
 * is only chosen.
 */
export function ThemeSwitcher({
  duration = 400,
  className,
}: ThemeSwitcherProps) {
  const { t } = useTranslation()
  const { preference, theme } = useTheme()

  const choose = useCallback(
    async (nextPreference: ThemePreference, target: HTMLElement) => {
      const nextTheme = await resolveTheme(nextPreference)
      const apply = () => setThemePreference(nextPreference, nextTheme)

      if (
        nextTheme === theme ||
        typeof document.startViewTransition !== 'function'
      ) {
        apply()
        return
      }

      const { top, left, width, height } = target.getBoundingClientRect()
      const x = left + width / 2
      const y = top + height / 2
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      const maxRadius = Math.hypot(
        Math.max(x, viewportWidth - x),
        Math.max(y, viewportHeight - y),
      )

      // Lets translucent surfaces (e.g. the settings dialog) be opaque in the transition snapshots,
      // which do not preserve backdrop blur
      const root = document.documentElement
      root.classList.add('theme-transitioning')
      const transition = document.startViewTransition(() => {
        flushSync(apply)
      })
      transition.finished.finally(() => {
        root.classList.remove('theme-transitioning')
      })
      transition.ready
        .then(() => {
          root.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${maxRadius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration,
              easing: 'ease-in-out',
              pseudoElement: '::view-transition-new(root)',
            },
          )
        })
        .catch(() => {
          // Skipped (e.g. another started): the new look is already shown
          applyTheme(nextTheme)
        })
    },
    [theme, duration],
  )

  return (
    <GlidingToggle
      aria-label={t('theme.title')}
      className={className}
      options={THEME_PREFERENCES.map((option) => ({
        value: option,
        label: <Icon name={ICONS[option]} size={16} />,
        'aria-label': t(`theme.options.${option}`),
      }))}
      value={preference}
      onChange={(option, target) => {
        choose(option, target)
      }}
    />
  )
}
