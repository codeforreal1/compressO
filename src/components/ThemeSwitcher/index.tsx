import React from 'react'
import { useTheme } from 'next-themes'

import Button from '../Button'
import Icon from '../Icon'
import Tooltip from '../Tooltip'

interface ThemeSwitcherChildrenProps {
  theme: string | undefined

  setTheme(theme: string | undefined): void
}

interface ThemeSwitcherProps {
  children?(props: ThemeSwitcherChildrenProps): React.ReactNode
}

function ThemeSwitcher(props: ThemeSwitcherProps) {
  const { children } = props

  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return children == null ? (
    <Tooltip content="Toggle theme" aria-label="Toggle theme" placement="right">
      <Button
        isIconOnly
        size="sm"
        onClick={() => {
          setTheme(theme === 'light' ? 'dark' : 'light')
        }}
      >
        <Icon name={theme === 'light' ? 'moon' : 'sun'} />
      </Button>
    </Tooltip>
  ) : (
    children({ theme, setTheme })
  )
}

export default ThemeSwitcher
