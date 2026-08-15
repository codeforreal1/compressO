import { Button } from '@heroui/react'
import { useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/utils/tailwind'
import Icon from '../Icon'
import Tooltip from '../Tooltip'

interface ThemeSwitcherProps extends React.ComponentPropsWithoutRef<'button'> {
  duration?: number
}

export const ThemeSwitcher = ({
  className,
  duration = 400,
}: ThemeSwitcherProps) => {
  const { theme, setTheme, toggleTheme } = useTheme()

  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const updateTheme = () => {
      setTheme(
        document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      )
    }

    updateTheme()

    const observer = new MutationObserver(updateTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [setTheme])

  const handleThemeToggle = useCallback(() => {
    const button = buttonRef.current
    if (!button) return

    const { top, left, width, height } = button.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    const maxRadius = Math.hypot(
      Math.max(x, viewportWidth - x),
      Math.max(y, viewportHeight - y),
    )

    const applyTheme = () => {
      toggleTheme()
      document.documentElement.classList.toggle('dark')
    }

    if (typeof document.startViewTransition !== 'function') {
      applyTheme()
      return
    }

    const transition = document.startViewTransition(() => {
      flushSync(applyTheme)
    })

    const ready = transition?.ready
    if (ready && typeof ready.then === 'function') {
      ready.then(() => {
        document.documentElement.animate(
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
    }
  }, [toggleTheme, duration])

  return (
    <Button
      isIconOnly
      size="sm"
      type="button"
      ref={buttonRef}
      radius="md"
      className={cn(className)}
      onPress={handleThemeToggle}
    >
      <Tooltip content="切换主题" aria-label="切换主题" placement="right">
        <Icon name={theme === 'light' ? 'moon' : 'sun'} />
      </Tooltip>
      <span className="sr-only">切换主题</span>
    </Button>
  )
}
