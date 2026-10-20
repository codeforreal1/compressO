import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import StepperInput from '@/components/StepperInput'
import { useSyncState } from '@/hooks/useSyncState'
import { formatBytes } from '@/utils/fs'
import {
  DEFAULT_TARGET_SIZE_IN_MB,
  formatSizeInMB,
  MAX_TARGET_SIZE_IN_MB,
  MB_PER_GB,
  MIN_TARGET_SIZE_IN_MB,
  TARGET_SIZE_STEP_IN_GB,
  TARGET_SIZE_STEP_IN_MB,
} from '@/utils/targetSize'
import {
  getQualitySizeEstimate,
  getTargetSizePlan,
  qualitySizeEstimates,
} from '../../../../-compression'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'

/**
 * The unit switching: to GB, the new one comes up from below as the old one goes up; back to MB,
 * the other way (`custom` is whether it is now GB)
 */
const unitVariants = {
  enter: (isInGB: boolean) => ({ y: isInGB ? 12 : -12, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit: (isInGB: boolean) => ({ y: isInGB ? -12 : 12, opacity: 0 }),
}

type TargetSizeProps = {
  mediaIndex: number
}

/**
 * The size a video is compressed to (see `utils/targetSize.ts`), with the resolution & frame rate
 * it gets to fit, or that its quality settings already fit (& are used)
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
  // The size at the quality settings is estimated when compressing starts (see `-sizeEstimate.ts`),
  // & kept for the same settings
  useSnapshot(qualitySizeEstimates)
  const batchConfigKey = useBatchVideoConfigKey()
  const video =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config } = video ?? {}
  const { targetSizeInMB: targetSizeGlobal } =
    config ?? commonConfigForBatchCompression[batchConfigKey] ?? {}

  const setTargetSizeGlobal = useCallback(
    (value: number) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.targetSizeInMB = value
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression[
          batchConfigKey
        ].targetSizeInMB = value
        normalizeBatchMediaConfig()
      }
    },
    [mediaIndex, batchConfigKey],
  )

  const [targetSize, setTargetSize] = useSyncState<number>({
    globalValue: targetSizeGlobal ?? undefined,
    setGlobalValue: setTargetSizeGlobal,
    defaultValue: DEFAULT_TARGET_SIZE_IN_MB,
    // Saved as it is typed, so the size used is always the one shown
    debounceMs: 0,
  })

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  // The estimate of a single video, for the size typed (not yet saved while typing)
  const plan = video
    ? getTargetSizePlan(
        {
          ...video,
          type: 'video',
          config: { ...video.config, targetSizeInMB: targetSize },
        } as Parameters<typeof getTargetSizePlan>[0],
        null,
      )
    : null
  // The smallest size a single video can reach at an acceptable quality (any size in a batch,
  // where each video differs): the input does not go below it
  const minimumPlan = video
    ? getTargetSizePlan(
        {
          ...video,
          type: 'video',
          config: { ...video.config, targetSizeInMB: MIN_TARGET_SIZE_IN_MB },
        } as Parameters<typeof getTargetSizePlan>[0],
        null,
      )
    : null
  const minimumSize = Math.max(
    MIN_TARGET_SIZE_IN_MB,
    Math.ceil(minimumPlan?.minimumSizeInMB ?? MIN_TARGET_SIZE_IN_MB),
  )

  // A size below the smallest one (e.g. the default for a long video, or after slowing it down) is
  // raised to it, as the input does not go below it
  useEffect(() => {
    if (video && targetSize < minimumSize) setTargetSize(minimumSize)
  }, [video, targetSize, minimumSize, setTargetSize])

  // Shown in MB, or in GB after clicking the unit (the size is kept in MB)
  const [isInGB, setIsInGB] = useState(false)
  const reduceMotion = useReducedMotion()
  const unitScale = isInGB ? MB_PER_GB : 1

  const outputExtension =
    config?.convertToExtension ??
    commonConfigForBatchCompression[batchConfigKey]?.convertToExtension
  const isGif = outputExtension === 'gif'

  return (
    <div>
      <StepperInput
        aria-label={t('targetSize.size')}
        decreaseLabel={t('common.decrease')}
        increaseLabel={t('common.increase')}
        value={targetSize / unitScale}
        minValue={minimumSize / unitScale}
        maxValue={MAX_TARGET_SIZE_IN_MB / unitScale}
        step={isInGB ? TARGET_SIZE_STEP_IN_GB : TARGET_SIZE_STEP_IN_MB}
        decimals={isInGB ? 2 : 1}
        unit={
          <button
            type="button"
            aria-label={t('targetSize.switchUnit', {
              unit: isInGB ? 'MB' : 'GB',
            })}
            onClick={() => setIsInGB((value) => !value)}
            disabled={shouldDisableInput}
            className="relative inline-grid h-4 overflow-hidden rounded px-0.5 transition-colors hover:text-zinc-900 disabled:pointer-events-none dark:hover:text-white"
          >
            {/* GB slides in from below, MB from above */}
            <AnimatePresence initial={false} mode="popLayout" custom={isInGB}>
              <motion.span
                key={isInGB ? 'GB' : 'MB'}
                className="col-start-1 row-start-1 leading-4"
                custom={isInGB}
                variants={unitVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 420, damping: 32 }
                }
              >
                {isInGB ? 'GB' : 'MB'}
              </motion.span>
            </AnimatePresence>
          </button>
        }
        onChange={(value) =>
          setTargetSize(Math.round(value * unitScale * 10) / 10)
        }
        isDisabled={shouldDisableInput}
      />
      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        {isGif ? (
          <p>{t('targetSize.notForGif')}</p>
        ) : !video ? (
          <p>{t('targetSize.eachVideo')}</p>
        ) : plan?.fitsAtQuality ? (
          <p className="text-zinc-700 dark:text-zinc-300">
            {t('targetSize.fitsAtQuality', {
              size: formatBytes(
                getQualitySizeEstimate(
                  video as Parameters<typeof getQualitySizeEstimate>[0],
                  null,
                ) ?? 0,
              ),
            })}
          </p>
        ) : plan ? (
          <p className="text-zinc-700 dark:text-zinc-300">
            {t(
              plan.isResolutionLowered || plan.fps
                ? 'targetSize.estimateLowered'
                : 'targetSize.estimate',
              {
                width: plan.dimensions[0],
                height: plan.dimensions[1],
                fps: plan.fps ?? video.fps ?? 30,
                size: formatSizeInMB(targetSize),
              },
            )}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default TargetSize
