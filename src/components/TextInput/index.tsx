import {
  Input as NextUITextInput,
  type InputProps as NextUITextInputProps,
} from '@heroui/react'

import { glassTrack, glassTrackHover, mergeClassNames } from '@/utils/glass'
import { cn } from '@/utils/tailwind'

interface TextInputProps extends NextUITextInputProps {}

/** A field with a thin grey border (see `utils/glass.ts`) */
function TextInput(props: TextInputProps) {
  return (
    <NextUITextInput
      size="sm"
      labelPlacement="outside"
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
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

export default TextInput
