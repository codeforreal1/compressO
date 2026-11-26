import { SelectItem, SelectSection } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Icon from '@/components/Icon'
import Select from '@/components/Select'
import Switch from '@/components/Switch'
import Tooltip from '@/components/Tooltip'
import { AUDIO_CODECS } from '@/types/compression'
import { slideDownTransition } from '@/utils/animation'
import { isAudioOutput } from '@/utils/audio'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'

type AudioCodecProps = {
  mediaIndex: number
}

function AudioCodec({ mediaIndex }: AudioCodecProps) {
  const { t } = useTranslation()
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
  const { config, videoInfoRaw, extension: videoExtension } = video ?? {}
  const {
    shouldEnableCustomAudioCodec,
    convertToExtension,
    audioConfig,
    externalAudioTracks,
  } = config ?? commonConfigForBatchCompression[batchConfigKey] ?? {}

  const customAudioCodec = audioConfig?.audioCodec ?? '-'

  const currentExtension = convertToExtension
    ? convertToExtension === '-'
      ? videoExtension
      : convertToExtension
    : '-'

  useEffect(() => {
    if (shouldEnableCustomAudioCodec && customAudioCodec) {
      const currentCodec = AUDIO_CODECS.find(
        (c) => c.value === customAudioCodec,
      )
      if (
        currentCodec &&
        !currentCodec.compatible_containers.includes(currentExtension as any)
      ) {
        // Codec is incompatible with current extension, reset it
        if (
          mediaIndex >= 0 &&
          appProxy.state.media[mediaIndex].type === 'video' &&
          appProxy.state.media[mediaIndex]?.config
        ) {
          appProxy.state.media[mediaIndex].config.audioConfig.audioCodec =
            undefined
        } else {
          if (appProxy.state.media.length > 1) {
            appProxy.state.commonConfigForBatchCompression[
              batchConfigKey
            ].audioConfig.audioCodec = undefined
          }
        }
      }
    }
  }, [
    currentExtension,
    shouldEnableCustomAudioCodec,
    customAudioCodec,
    mediaIndex,
    batchConfigKey,
  ])

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      appProxy.state.media[mediaIndex].config.shouldEnableCustomAudioCodec =
        !shouldEnableCustomAudioCodec
      appProxy.state.media[mediaIndex].isConfigDirty = true
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression[
          batchConfigKey
        ].shouldEnableCustomAudioCodec = !shouldEnableCustomAudioCodec
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, shouldEnableCustomAudioCodec, batchConfigKey])

  const handleValueChange = useCallback(
    (value: string) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.audioConfig.audioCodec = value
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].audioConfig.audioCodec = value
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex, batchConfigKey],
  )

  const hasNoAudio =
    videoInfoRaw?.audioStreams?.length === 0 &&
    (externalAudioTracks?.length ?? 0) === 0

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    hasNoAudio ||
    // Muted, an audio output is still written (as silence), so its settings stay available
    (audioConfig?.volume === 0 &&
      !isAudioOutput({
        isAudioFile: video?.isAudioFile,
        isAudioFileSettings: batchConfigKey === 'audioFileConfig',
        convertToExtension,
      })) ||
    convertToExtension === 'gif'

  const initialCodecValue = customAudioCodec ?? '-'

  const compatibleCodecs = AUDIO_CODECS.filter((codec) =>
    codec.compatible_containers.includes(currentExtension as any),
  )

  return (
    <>
      <Switch
        isSelected={shouldEnableCustomAudioCodec}
        onValueChange={handleSwitchToggle}
        isDisabled={shouldDisableInput}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          {t('codecs.title')}
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {shouldEnableCustomAudioCodec ? (
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
              isDisabled={!shouldEnableCustomAudioCodec || shouldDisableInput}
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
                {compatibleCodecs?.map((codec) => (
                  <SelectItem
                    key={codec.value}
                    textValue={codec.name}
                    className="flex justify-center items-center"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm">{codec.name}</span>
                      <span className="text-xs text-gray-500">
                        {codec.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectSection>
            </Select>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default AudioCodec
