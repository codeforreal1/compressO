import React from 'react'

import { ThemeProxy, useTheme } from '@/hooks/useTheme'
import Button from '../Button'
import Icon from '../Icon'
import Tooltip from '../Tooltip'

type ThemeSwitcherChildrenProps = ThemeProxy

interface ThemeSwitcherProps {
  children?(props: ThemeSwitcherChildrenProps): React.ReactNode
}

function ThemeSwitcher(props: ThemeSwitcherProps) {
  const { children } = props

  const { theme, setTheme, toggleTheme } = useTheme()

  return children == null ? (
    <Button
      isIconOnly
      size="sm"
      onPress={() => {
        toggleTheme()
      }}
    >
      <Tooltip
        content="Toggle theme"
        aria-label="Toggle theme"
        placement="right"
      >
        <Icon name={theme === 'light' ? 'moon' : 'sun'} />
      </Tooltip>
    </Button>
  ) : (
    children({ theme, setTheme, toggleTheme })
  )
}

export default ThemeSwitcher
