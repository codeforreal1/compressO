import { SelectItem, SelectSection } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Icon from '@/components/Icon'
import InfoTooltip from '@/components/InfoTooltip'
import Select from '@/components/Select'
import Switch from '@/components/Switch'
import Tooltip from '@/components/Tooltip'
import { isVideoCodecCompatible, VIDEO_CODECS } from '@/types/compression'
import { slideDownTransition } from '@/utils/animation'
import { getOutputVideoContainer } from '@/utils/video'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'

type VideoCodecProps = {
  mediaIndex: number
}

function VideoCodec({ mediaIndex }: VideoCodecProps) {
  const { t, i18n } = useTranslation()
  const {
    state: {
      media,
      isCompressing,
      isProcessCompleted,
      commonConfigForBatchCompression,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const batchConfigKey = useBatchVideoConfigKey()
  const video =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config, extension: videoExtension } = video ?? {}
  const { shouldEnableCustomVideoCodec, customVideoCodec, convertToExtension } =
    config ?? commonConfigForBatchCompression[batchConfigKey] ?? {}

  // The output container of each video the codec applies to: one for a single video, one per video
  // for a batch (they differ with "Same as input")
  const outputContainers = useMemo(
    () =>
      mediaIndex >= 0
        ? [getOutputVideoContainer(convertToExtension, videoExtension)]
        : media
            .filter((mediaFile) => mediaFile.type === 'video')
            .map((mediaFile) =>
              getOutputVideoContainer(convertToExtension, mediaFile.extension),
            ),
    [mediaIndex, convertToExtension, videoExtension, media],
  )

  // Reset the codec if no video's container can hold it
  useEffect(() => {
    if (
      shouldEnableCustomVideoCodec &&
      customVideoCodec &&
      !outputContainers.some((container) =>
        isVideoCodecCompatible(customVideoCodec, container),
      )
    ) {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.customVideoCodec = undefined
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].customVideoCodec = undefined
          normalizeBatchMediaConfig()
        }
      }
    }
  }, [
    outputContainers,
    shouldEnableCustomVideoCodec,
    customVideoCodec,
    mediaIndex,
    batchConfigKey,
  ])

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      appProxy.state.media[mediaIndex].config.shouldEnableCustomVideoCodec =
        !shouldEnableCustomVideoCodec
      appProxy.state.media[mediaIndex].isConfigDirty = true
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression[
          batchConfigKey
        ].shouldEnableCustomVideoCodec = !shouldEnableCustomVideoCodec
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, shouldEnableCustomVideoCodec, batchConfigKey])

  const handleValueChange = useCallback(
    (value: string) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.customVideoCodec = value
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].customVideoCodec = value
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex, batchConfigKey],
  )

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    convertToExtension === 'gif'

  const initialCodecValue = customVideoCodec ?? '-'

  const isBatch = mediaIndex < 0

  // With how many videos each codec can be used. A single video lists the codecs its container can
  // hold; a batch lists every codec, those no video can use being disabled.
  const codecOptions = VIDEO_CODECS.map((codec) => ({
    ...codec,
    videoCount: outputContainers.filter((container) =>
      isVideoCodecCompatible(codec.value, container),
    ).length,
  })).filter((codec) => isBatch || codec.videoCount > 0)
  const compatibleCodecs = codecOptions.filter((codec) => codec.videoCount > 0)

  // In a batch, the videos whose container cannot hold the chosen codec keep their default codec
  const selectedCodec = compatibleCodecs.find(
    (codec) => codec.value === customVideoCodec,
  )
  const skippedVideoCount = selectedCodec
    ? outputContainers.length - selectedCodec.videoCount
    : 0
  const skippedContainers = selectedCodec
    ? [
        ...new Set(
          outputContainers.filter(
            (container) =>
              !isVideoCodecCompatible(selectedCodec.value, container),
          ),
        ),
      ].map((container) => container.toUpperCase())
    : []
  const codecNote =
    shouldEnableCustomVideoCodec && selectedCodec && skippedVideoCount > 0
      ? t('codecs.unusableIn', {
          codec: selectedCodec.name,
          containers: formatList(skippedContainers, i18n.language),
          count: skippedVideoCount,
        })
      : null

  return (
    <>
      {/* Beside the switch, not in its label, so clicking the icon does not toggle it */}
      <div className="flex items-center">
        <Switch
          isSelected={shouldEnableCustomVideoCodec}
          onValueChange={handleSwitchToggle}
          isDisabled={shouldDisableInput}
        >
          <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
            {t('codecs.title')}
          </p>
        </Switch>
        <InfoTooltip content={!shouldDisableInput && codecNote} />
      </div>
      <AnimatePresence mode="wait">
        {shouldEnableCustomVideoCodec ? (
          <motion.div {...slideDownTransition}>
            <Select
              fullWidth
              label={t('codecs.select')}
              className="block flex-shrink-0 rounded-2xl !mt-8"
              selectedKeys={[initialCodecValue]}
              size="sm"
              value={initialCodecValue}
              onChange={(evt) => {
                const value = evt?.target?.value
                if (value) {
                  handleValueChange(value)
                }
              }}
              selectionMode="single"
              disabledKeys={codecOptions
                .filter((codec) => codec.videoCount === 0)
                .map((codec) => codec.value)}
              isDisabled={!shouldEnableCustomVideoCodec || shouldDisableInput}
              classNames={{
                label: '!text-gray-600 dark:!text-gray-400 text-xs',
              }}
            >
              <SelectItem
                key="-"
                textValue={t('codecs.default')}
                className="flex justify-center items-center"
                endContent={
                  <Tooltip
                    content={t('codecs.defaultDescription')}
                    aria-label={t('codecs.defaultDescription')}
                  >
                    <Icon
                      name="info"
                      className="inline-block ml-1 text-primary"
                      size={15}
                    />
                  </Tooltip>
                }
              >
                <div className="flex flex-col">
                  <span className="text-sm">{t('codecs.default')}</span>
                </div>
              </SelectItem>
              <SelectSection>
                {codecOptions.map((codec) => {
                  const videoCountText = t('codecs.videoCount', {
                    count: outputContainers.length,
                    usable: codec.videoCount,
                  })
                  const isPartial =
                    isBatch && codec.videoCount < outputContainers.length
                  return (
                    <SelectItem
                      key={codec.value}
                      textValue={codec.name}
                      className="flex justify-center items-center"
                      endContent={
                        isPartial && codec.videoCount > 0 ? (
                          <Tooltip
                            content={t('codecs.partial', {
                              videos: videoCountText,
                              codec: codec.name,
                            })}
                            aria-label={t('codecs.partial', {
                              videos: videoCountText,
                              codec: codec.name,
                            })}
                            className="max-w-64"
                          >
                            <Icon
                              name="info"
                              className="inline-block ml-1 text-warning-400"
                              size={15}
                            />
                          </Tooltip>
                        ) : null
                      }
                    >
                      <div className="flex flex-col">
                        <span className="text-sm">{codec.name}</span>
                        <span className="text-xs text-gray-500">
                          {codec.description}
                        </span>
                        {isPartial ? (
                          <span className="text-xs text-warning-500">
                            {videoCountText}
                          </span>
                        ) : null}
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectSection>
            </Select>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

/** "MP4", "MP4 and TS", "MP4, TS and AVI", in the interface's language */
function formatList(items: string[], language: string) {
  return new Intl.ListFormat(language, { type: 'conjunction' }).format(items)
}

export default VideoCodec
