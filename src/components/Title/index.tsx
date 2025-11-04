import React from 'react'

import { cn } from '@/utils/tailwind'
import Icon, { IconProps } from '../Icon'

type TitleProps = {
  title: string | number
  iconProps?: IconProps
}
function Title({
  title,
  iconProps,
  ...props
}: TitleProps & React.ComponentProps<'p'>) {
  return (
    <>
      {iconProps ? (
        <Icon
          size={35}
          {...(iconProps ?? {})}
          className={cn([
            'mx-auto mb-2 text-zinc-600 dark:text-zinc-400',
            iconProps?.className,
          ])}
        />
      ) : null}
      <p
        {...props}
        className={cn([
          'text-center bg-gradient-to-br from-foreground-800 to-foreground-500 bg-clip-text text-3xl font-semibold tracking-tight text-transparent dark:to-foreground-200',
          props?.className,
        ])}
      >
        {title}
      </p>
    </>
  )
}

export default Title
