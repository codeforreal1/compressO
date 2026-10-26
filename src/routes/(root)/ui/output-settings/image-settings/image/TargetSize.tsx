import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import StepperInput from '@/components/StepperInput'
import UnitSwitch from '@/components/UnitSwitch'
import { useSyncState } from '@/hooks/useSyncState'
import { getTargetSizeWarning, MediaFile } from '@/routes/(root)/-compression'
import { appProxy, normalizeBatchMediaConfig } from '@/routes/(root)/-state'
import {
  DEFAULT_IMAGE_TARGET_SIZE_IN_KB,
  IMAGE_TARGET_SIZE_STEP_IN_KB,
  IMAGE_TARGET_SIZE_STEP_IN_MB,
  KB_PER_MB,
  MAX_IMAGE_TARGET_SIZE_IN_KB,
  MIN_IMAGE_TARGET_SIZE_IN_KB,
} from '@/utils/imageTargetSize'

type TargetSizeProps = {
  mediaIndex: number
}

/**
 * The size an image is compressed to (see `utils/imageTargetSize.ts`): the highest quality that
 * fits, at smaller dimensions only when it has to be
 */
function TargetSize({ mediaIndex }: TargetSizeProps) {
  const { t } = useTranslation()
  const {
    state: {
      isCompressing,
      isProcessCompleted,
      media,
      commonConfigForBatchCompression,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const image =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'image'
      ? media[mediaIndex]
      : null
  const { config } = image ?? {}
  const { targetSizeInKB: targetSizeGlobal } =
    config ?? commonConfigForBatchCompression.imageConfig ?? {}

  const setTargetSizeGlobal = useCallback(
    (value: number) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'image' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.targetSizeInKB = value
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression.imageConfig.targetSizeInKB =
          value
        normalizeBatchMediaConfig()
      }
    },
    [mediaIndex],
  )

  const [targetSize, setTargetSize] = useSyncState<number>({
    globalValue: targetSizeGlobal ?? undefined,
    setGlobalValue: setTargetSizeGlobal,
    defaultValue: DEFAULT_IMAGE_TARGET_SIZE_IN_KB,
    // Saved as it is typed, so the size used is always the one shown
    debounceMs: 0,
  })

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  // Shown in KB, or in MB after clicking the unit (the size is kept in KB)
  const [isInMB, setIsInMB] = useState(() => targetSize >= KB_PER_MB)
  const unitScale = isInMB ? KB_PER_MB : 1

  // SVGs & GIFs cannot be compressed to a size: this image, or any image of the batch (which is
  // then not compressed until another format, or the quality, is chosen)
  const warning = image
    ? getTargetSizeWarning(image as MediaFile)
    : (media
        .filter((mediaFile) => mediaFile.type === 'image')
        .map((mediaFile) => getTargetSizeWarning(mediaFile as MediaFile))
        .find(Boolean) ?? null)
  const isSupported = !warning

  return (
    <div>
      <StepperInput
        aria-label={t('targetSize.size')}
        decreaseLabel={t('common.decrease')}
        increaseLabel={t('common.increase')}
        value={targetSize / unitScale}
        minValue={MIN_IMAGE_TARGET_SIZE_IN_KB / unitScale}
        maxValue={MAX_IMAGE_TARGET_SIZE_IN_KB / unitScale}
        step={
          isInMB ? IMAGE_TARGET_SIZE_STEP_IN_MB : IMAGE_TARGET_SIZE_STEP_IN_KB
        }
        decimals={isInMB ? 2 : 0}
        unit={
          <UnitSwitch
            units={['KB', 'MB']}
            isLarger={isInMB}
            onToggle={() => setIsInMB((value) => !value)}
            aria-label={t('targetSize.switchUnit', {
              unit: isInMB ? 'KB' : 'MB',
            })}
            disabled={shouldDisableInput || !isSupported}
          />
        }
        onChange={(value) => setTargetSize(Math.round(value * unitScale))}
        isDisabled={shouldDisableInput || !isSupported}
      />
      {/* Only why it cannot be used: the size it comes out at is only known once compressed */}
      {warning ? (
        <p className="mt-2 text-xs text-warning-600 dark:text-warning-400">
          {t(warning)}
        </p>
      ) : null}
    </div>
  )
}

export default TargetSize
