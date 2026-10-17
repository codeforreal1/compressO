import { AnimatePresence, motion } from 'framer-motion'
import cloneDeep from 'lodash/cloneDeep'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Card from '@/components/Card'
import DatePicker from '@/components/DatePicker'
import Divider from '@/components/Divider'
import InfoTooltip from '@/components/InfoTooltip'
import Switch from '@/components/Switch'
import TextArea from '@/components/TextArea'
import TextInput from '@/components/TextInput'
import type { MediaMetadataConfig } from '@/types/app'
import {
  getAudioFileOutputExtension,
  isAudioExtension,
} from '@/types/compression'
import { slideDownTransition } from '@/utils/animation'
import { getOutputVideoContainer } from '@/utils/video'
import {
  appProxy,
  normalizeBatchMediaConfig,
  videoMetadataConfigInitialState,
} from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'

/**
 * Fields audio formats cannot keep (MP3 and M4A keep every field), not shown for audio outputs:
 * FLAC, OGG & Opus have no description of their own (it is merged into the comment)
 */
const AUDIO_FORMAT_UNSUPPORTED_FIELDS: Record<
  string,
  ('description' | 'synopsis' | 'creationTime')[] | undefined
> = {
  wav: ['description', 'synopsis', 'creationTime'],
  flac: ['description'],
  ogg: ['description'],
  opus: ['description'],
}

/**
 * Output formats that cannot keep all the metadata (MP4, MKV and WebM keep every field), described
 * by `metadata.limitation_<format>`
 */
const METADATA_FORMAT_LIMITATIONS = ['mov', 'avi', 'ts'] as const

type MetadataProps = {
  mediaIndex: number
}

function Metadata({ mediaIndex }: MetadataProps) {
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
  const { config } = video ?? {}
  const { shouldStripMetadata, metadataConfig, convertToExtension } =
    config ?? commonConfigForBatchCompression[batchConfigKey] ?? {}

  const updateMetadataField = useCallback(
    (
      field: keyof MediaMetadataConfig,
      value: string | boolean | null | undefined,
    ) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        if (!appProxy.state.media[mediaIndex]?.config?.metadataConfig) {
          appProxy.state.media[mediaIndex].config.metadataConfig = cloneDeep(
            videoMetadataConfigInitialState,
          )
        }
        ;(appProxy.state.media[mediaIndex].config.metadataConfig![
          field
        ] as any) = value

        if (
          field === 'creationTimeRaw' &&
          appProxy.state.media[mediaIndex]?.config?.metadataConfig
        ) {
          appProxy.state.media[mediaIndex].config.metadataConfig![
            'creationTime'
          ] = (value as any)?.toDate?.('')?.toISOString()
        }

        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          if (
            !appProxy.state?.commonConfigForBatchCompression?.[batchConfigKey]
              ?.metadataConfig
          ) {
            appProxy.state.commonConfigForBatchCompression[
              batchConfigKey
            ].metadataConfig = cloneDeep(videoMetadataConfigInitialState)
          }
          ;(appProxy.state.commonConfigForBatchCompression[batchConfigKey]
            .metadataConfig![field] as any) = value

          if (
            field === 'creationTimeRaw' &&
            appProxy.state.commonConfigForBatchCompression?.[batchConfigKey]
              ?.metadataConfig
          ) {
            appProxy.state.commonConfigForBatchCompression[batchConfigKey]
              .metadataConfig!['creationTime'] = (value as any)
              ?.toDate?.('')
              ?.toISOString()
          }

          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex, batchConfigKey],
  )

  const handleStripMetadataToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      appProxy.state.media[mediaIndex].config.shouldStripMetadata =
        !appProxy.state.media[mediaIndex].config.shouldStripMetadata
      appProxy.state.media[mediaIndex].isConfigDirty = true

      if (appProxy.state.media[mediaIndex].config.shouldStripMetadata) {
        appProxy.state.media[mediaIndex].config.metadataConfig = null
      } else {
        appProxy.state.media[mediaIndex].config.metadataConfig = cloneDeep(
          videoMetadataConfigInitialState,
        )
      }
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression[
          batchConfigKey
        ].shouldStripMetadata =
          !appProxy.state.commonConfigForBatchCompression[batchConfigKey]
            .shouldStripMetadata

        if (
          appProxy.state.commonConfigForBatchCompression[batchConfigKey]
            .shouldStripMetadata
        ) {
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].metadataConfig = null
        } else {
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].metadataConfig = cloneDeep(videoMetadataConfigInitialState)
        }

        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, batchConfigKey])

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    convertToExtension === 'gif'

  const isAudioFileSettings =
    mediaIndex >= 0
      ? !!video?.isAudioFile
      : batchConfigKey === 'audioFileConfig'
  // The audio format written (an audio file's own with "Same as input"; unknown for a batch's)
  const audioOutputExtension = isAudioExtension(convertToExtension)
    ? convertToExtension
    : video?.isAudioFile
      ? getAudioFileOutputExtension(video.extension)
      : null
  const unsupportedFields =
    (audioOutputExtension &&
      AUDIO_FORMAT_UNSUPPORTED_FIELDS[audioOutputExtension]) ||
    []

  // Unknown for "Same as input" on a batch
  const outputContainer = getOutputVideoContainer(
    convertToExtension,
    video?.extension,
  )
  const limitedFormat = METADATA_FORMAT_LIMITATIONS.find(
    (format) => format === outputContainer,
  )
  const formatLimitation = limitedFormat
    ? t('metadata.limitation', { context: limitedFormat })
    : null

  return (
    <>
      {/* Beside the switch, not in its label, so clicking the icon does not toggle it */}
      <div className="flex items-center">
        <Switch
          isSelected={shouldStripMetadata}
          onValueChange={handleStripMetadataToggle}
          isDisabled={shouldDisableInput}
        >
          <div className="flex justify-center items-center">
            <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
              {t('metadata.strip')}
            </span>
          </div>
        </Switch>
        <InfoTooltip
          content={
            !shouldStripMetadata && !shouldDisableInput && formatLimitation
          }
        />
      </div>
      <AnimatePresence mode="wait">
        {!shouldStripMetadata ? (
          <Card className="px-2 my-2 pb-4 shadow-none border-1 dark:border-none">
            <motion.div {...slideDownTransition} className="space-y-4 pt-2">
              <div className="text-zinc-700 dark:text-zinc-400">
                <p className="text-xs  italic">- {t('metadata.keepHint')}</p>{' '}
                <p className="text-xs  italic">- {t('metadata.removeHint')}</p>
              </div>
              <div>
                <TextInput
                  type="text"
                  label={t('metadata.title.label')}
                  placeholder={
                    isAudioFileSettings
                      ? t('metadata.title.placeholder')
                      : t('metadata.title.placeholderVideo')
                  }
                  value={metadataConfig?.title ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) => updateMetadataField('title', value)}
                  classNames={{ mainWrapper: 'my-3' }}
                />
                <Divider className="mb-6" />
              </div>
              <div>
                <TextInput
                  type="text"
                  label={t('metadata.artist.label')}
                  placeholder={t('metadata.artist.placeholder')}
                  value={metadataConfig?.artist ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) =>
                    updateMetadataField('artist', value)
                  }
                  classNames={{ mainWrapper: 'my-3' }}
                />
                <Divider className="mb-6" />
              </div>
              <div>
                <TextInput
                  type="text"
                  label={t('metadata.album.label')}
                  placeholder={t('metadata.album.placeholder')}
                  value={metadataConfig?.album ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) => updateMetadataField('album', value)}
                  classNames={{ mainWrapper: 'my-3' }}
                />
                <Divider className="mb-6" />
              </div>
              <div>
                <TextInput
                  type="text"
                  label={t('metadata.genre.label')}
                  placeholder={t('metadata.genre.placeholder')}
                  value={metadataConfig?.genre ?? ''}
                  isDisabled={shouldDisableInput}
                  classNames={{ mainWrapper: 'my-3' }}
                  onValueChange={(value) => updateMetadataField('genre', value)}
                />
                <Divider className="mb-6" />
              </div>
              <div>
                <TextInput
                  type="text"
                  label={t('metadata.year.label')}
                  placeholder={t('metadata.year.placeholder')}
                  value={metadataConfig?.year ?? ''}
                  isDisabled={shouldDisableInput}
                  classNames={{ mainWrapper: 'my-3' }}
                  onValueChange={(value) => updateMetadataField('year', value)}
                />
                <Divider className="mb-6" />
              </div>
              {!unsupportedFields.includes('description') ? (
                <div className="!mt-[-10px]">
                  <TextArea
                    type="text"
                    label={t('metadata.description.label')}
                    placeholder={t('metadata.description.placeholder')}
                    value={metadataConfig?.description ?? ''}
                    isDisabled={shouldDisableInput}
                    onValueChange={(value) =>
                      updateMetadataField('description', value)
                    }
                    className="mb-3"
                  />
                  <Divider className="mb-6" />
                </div>
              ) : null}
              {!unsupportedFields.includes('synopsis') ? (
                <div className="!mt-[-10px]">
                  <TextArea
                    type="text"
                    label={t('metadata.synopsis.label')}
                    placeholder={t('metadata.synopsis.placeholder')}
                    value={metadataConfig?.synopsis ?? ''}
                    isDisabled={shouldDisableInput}
                    onValueChange={(value) =>
                      updateMetadataField('synopsis', value)
                    }
                    className="mb-3"
                  />
                  <Divider className="mb-6" />
                </div>
              ) : null}
              <div className="!mt-[-10px]">
                <TextArea
                  type="text"
                  label={t('metadata.comment.label')}
                  placeholder={t('metadata.comment.placeholder')}
                  value={metadataConfig?.comment ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) =>
                    updateMetadataField('comment', value)
                  }
                  className="mb-3"
                />
                <Divider className="mb-6" />
              </div>
              <div className="!mt-[-10px]">
                <TextArea
                  type="text"
                  label={t('metadata.copyright.label')}
                  placeholder={t('metadata.copyright.placeholder')}
                  value={metadataConfig?.copyright ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) =>
                    updateMetadataField('copyright', value)
                  }
                  className="mb-3"
                />
                <Divider className="mb-6" />
              </div>

              {!unsupportedFields.includes('creationTime') ? (
                <div>
                  <div className="flex items-center mt-[-10px]">
                    <Switch
                      isSelected={Boolean(
                        metadataConfig?.shouldEnableCreationTime,
                      )}
                      onValueChange={(isSelected) => {
                        updateMetadataField(
                          'shouldEnableCreationTime',
                          isSelected,
                        )
                      }}
                      className="flex justify-center items-center"
                      isDisabled={shouldDisableInput}
                      size="sm"
                    >
                      <div className="flex justify-center items-center">
                        <span className="text-black1 dark:text-white1 block mr-2 text-xs opacity-90">
                          {t('metadata.creationTime.label')}
                        </span>
                      </div>
                    </Switch>
                  </div>
                  {metadataConfig?.shouldEnableCreationTime &&
                  metadataConfig?.creationTimeRaw ? (
                    <DatePicker
                      hideTimeZone
                      showMonthAndYearPickers
                      label=""
                      placeholder={t('metadata.creationTime.placeholder')}
                      isDisabled={
                        shouldDisableInput ||
                        !metadataConfig?.shouldEnableCreationTime
                      }
                      onChange={(value) => {
                        updateMetadataField('creationTimeRaw', value as any)
                      }}
                      value={metadataConfig?.creationTimeRaw as any}
                      className="mt-2"
                    />
                  ) : null}
                </div>
              ) : null}
            </motion.div>
          </Card>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default Metadata
