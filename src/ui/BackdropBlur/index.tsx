import { cn } from '@/utils/tailwind'
import React from 'react'

export const blurCSS =
  'backdrop-blur-lg backdrop-saturate-150 bg-white1/80 dark:bg-zinc-800/80'

type BackdropBlurProps = {
  children?: React.ReactNode
}
function BackdropBlur({
  children,
  ...props
}: BackdropBlurProps & React.ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn(['relative bg-transparent', props?.className])}
    >
      {children}
      <BackdropBlurContent />
    </div>
  )
}

type BackdropBlurContentProps = {}
export function BackdropBlurContent(
  props: BackdropBlurContentProps & React.ComponentProps<'div'>,
) {
  return (
    <div
      {...props}
      className={cn([
        'absolute top-0 right-0 bottom-0 left-0 width-full height-full z-[-1] ',
        blurCSS,
        props?.className,
      ])}
    />
  )
}

export default BackdropBlur
