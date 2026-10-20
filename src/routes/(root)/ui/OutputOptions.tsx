import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import { formatBytes } from '@/utils/fs'
import { glassTrack } from '@/utils/glass'
import { cn } from '@/utils/tailwind'
import { chooseOutputOption } from '../-save'
import { appProxy } from '../-state'

type OutputOptionsProps = {
  mediaIndex: number
}

/**
 * The outputs made for a video's target size (each attempt), by size: the one used is marked in
 * the primary color, & choosing another uses it instead (shown in the preview, & saved), see
 * `chooseOutputOption`
 */
function OutputOptions({ mediaIndex }: OutputOptionsProps) {
  const { t } = useTranslation()
  const {
    state: { media },
  } = useSnapshot(appProxy)
  const mediaFile = media[mediaIndex]
  const file = mediaFile?.type === 'video' ? mediaFile.compressedFile : null
  const options = file?.options
  if (!file || !options || options.length < 2) return null
  const { targetSizeInBytes } = file

  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t('outputOptions.title')}
      </p>
      <div
        role="radiogroup"
        aria-label={t('outputOptions.title')}
        className="flex flex-wrap justify-center gap-2"
      >
        {options.map((option) => {
          const isChosen = option.pathRaw === file.pathRaw
          const isOver =
            targetSizeInBytes != null && option.sizeInBytes > targetSizeInBytes
          const size = formatBytes(option.sizeInBytes)
          return (
            <button
              key={option.pathRaw}
              type="button"
              role="radio"
              aria-checked={isChosen}
              aria-label={t('outputOptions.choose', { size })}
              disabled={file.isSaving}
              onClick={() => chooseOutputOption(mediaIndex, option)}
              className={cn(
                'flex items-center gap-2 rounded-xl p-1 pr-3 text-left',
                'transition-colors duration-200 disabled:cursor-default',
                isChosen
                  ? 'border border-primary bg-primary/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                  : cn(
                      glassTrack,
                      'hover:bg-zinc-200/60 dark:hover:bg-white/[0.06]',
                    ),
              )}
            >
              {mediaFile.thumbnailPath ? (
                <img
                  src={mediaFile.thumbnailPath}
                  alt=""
                  className={cn(
                    'h-8 w-8 rounded-lg object-cover transition-opacity duration-200',
                    !isChosen && 'opacity-70',
                  )}
                />
              ) : null}
              <span className="flex flex-col leading-tight">
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    isChosen
                      ? 'text-zinc-900 dark:text-white'
                      : 'text-zinc-600 dark:text-zinc-300',
                  )}
                >
                  {size}
                </span>
                <span
                  className={cn(
                    'text-[10px]',
                    isOver
                      ? 'text-warning-600 dark:text-warning-400'
                      : 'text-zinc-500 dark:text-zinc-400',
                  )}
                >
                  {t(
                    isOver
                      ? 'outputOptions.overTarget'
                      : 'outputOptions.withinTarget',
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default OutputOptions
