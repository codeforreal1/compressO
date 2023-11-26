import React from 'react'

import Icon from '../Icon'
import type { IconProps } from '../Icon'
import Button from '../Button'
import type { ButtonProps } from '../Button'
import { mergeClasses } from '@/utils/tailwind'

interface IconButtonProps {
  iconProps: IconProps
  buttonProps?: ButtonProps
}

function IconButton(props: IconButtonProps) {
  const { iconProps, buttonProps } = props

  return (
    <Button
      {...buttonProps}
      variant={buttonProps?.variant ?? 'light'}
      className={mergeClasses(['min-w-0 px-3', buttonProps?.className])}
    >
      <Icon {...iconProps} />
    </Button>
  )
}

export default IconButton
