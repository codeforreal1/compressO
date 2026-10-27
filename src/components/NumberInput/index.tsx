import {
  NumberInput as NextUINumberInput,
  type NumberInputProps as NextUINumberInputProps,
} from '@heroui/react'

import { glassTrack, glassTrackHover, mergeClassNames } from '@/utils/glass'
import { cn } from '@/utils/tailwind'

interface NumberInputProps extends NextUINumberInputProps {}

/** A field with a thin grey border (see `utils/glass.ts`) */
function NumberInput(props: NumberInputProps) {
  return (
    <NextUINumberInput
      size="sm"
      {...props}
      classNames={mergeClassNames(
        {
          inputWrapper: cn(
            glassTrack,
            glassTrackHover,
            'shadow-none group-data-[focus=true]:bg-zinc-100 dark:group-data-[focus=true]:bg-white/[0.05]',
          ),
        },
        props.classNames,
      )}
    />
  )
}

export default NumberInput
