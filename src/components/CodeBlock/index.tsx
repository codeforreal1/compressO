import React from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { cn } from '@/utils/tailwind'

/** How long the copy button shows that the code was copied */
const COPIED_DURATION_MS = 1500

export interface CodeBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The code, shown as it is (line breaks & spaces kept) */
  code: string
  /** Shows a button that copies the code to the clipboard */
  isCopyable?: boolean
}

/** A block of code or a command, e.g. to copy into a terminal */
const CodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(
  (props, ref) => {
    const { code, isCopyable, className, ...rest } = props
    const { t } = useTranslation()
    const [isCopied, setIsCopied] = React.useState(false)

    React.useEffect(() => {
      if (!isCopied) return
      const timeout = setTimeout(() => setIsCopied(false), COPIED_DURATION_MS)
      return () => clearTimeout(timeout)
    }, [isCopied])

    return (
      <div
        ref={ref}
        className={cn(
          'relative flex items-start gap-2 rounded-lg bg-zinc-200/70 dark:bg-zinc-800/70 py-2 pl-3',
          isCopyable ? 'pr-1.5' : 'pr-3',
          className,
        )}
        {...rest}
      >
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words py-1 font-mono text-xs leading-relaxed text-foreground select-text">
          {code}
        </pre>
        {isCopyable ? (
          <Tooltip
            content={isCopied ? t('common.copied') : t('common.copy')}
            aria-label={t('common.copy')}
            delay={300}
          >
            <Button
              isIconOnly
              size="sm"
              variant="light"
              aria-label={t('common.copy')}
              onPress={() => {
                navigator.clipboard
                  .writeText(code)
                  .then(() => setIsCopied(true))
                  .catch(() => {})
              }}
            >
              {/* The icons share one slot & crossfade, so nothing moves */}
              <span className="relative grid size-5 place-items-center">
                <Icon
                  name="copy"
                  size={20}
                  className={cn(
                    'col-start-1 row-start-1 transition-opacity duration-200',
                    isCopied ? 'opacity-0' : 'opacity-100',
                  )}
                />
                <Icon
                  name="tick"
                  size={20}
                  className={cn(
                    'col-start-1 row-start-1 text-success transition-opacity duration-200',
                    isCopied ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </span>
            </Button>
          </Tooltip>
        ) : null}
      </div>
    )
  },
)
CodeBlock.displayName = 'CodeBlock'

export default CodeBlock
