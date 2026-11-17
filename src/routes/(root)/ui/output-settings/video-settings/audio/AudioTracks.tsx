import { Checkbox } from '@heroui/react'
import { open } from '@tauri-apps/plugin-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Switch from '@/components/Switch'
import { t } from '@/i18n'
import { getAudioStreams, getVideoBasicInfo } from '@/tauri/commands/ffprobe'
import { ExternalAudioTrack } from '@/types/app'
import { AudioStream } from '@/types/compression'
import { slideDownTransition } from '@/utils/animation'
import { isAudioOutput } from '@/utils/audio'
import { cn } from '@/utils/tailwind'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'

type AudioTracksProps = {
  mediaIndex: number
}

const AUDIO_FILE_EXTENSIONS = [
  'mp3',
  'wav',
  'aac',
  'm4a',
  'm4b',
  'flac',
  'ogg',
  'oga',
  'opus',
  'aiff',
  'aif',
  'wma',
  'mp2',
]

function getLanguageFromTags(
  tags: readonly (readonly [string, string])[] | null,
): string {
  if (!tags) return t('subtitles.unknownLanguage')
  const langTag = tags.find(([key]) => key.toLowerCase() === 'language')
  return langTag ? langTag[1] : '-'
}

function getTitleFromTags(
  tags: readonly (readonly [string, string])[] | null,
): string | null {
  if (!tags) return null
  const titleTag = tags.find(([key]) => key.toLowerCase() === 'title')
  return titleTag ? titleTag[1] : null
}

function AudioTracks({ mediaIndex }: AudioTracksProps) {
  const { t } = useTranslation()
  if (mediaIndex < 0) return null

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
  const { config, videoInfoRaw } = video ?? {}
  const {
    shouldEnableAudioTrackSelection,
    selectedAudioTracks,
    externalAudioTracks,
    audioConfig,
    convertToExtension,
  } = config ?? commonConfigForBatchCompression[batchConfigKey] ?? {}

  const audioStreams = videoInfoRaw?.audioStreams ?? []
  const addedAudioTracks = externalAudioTracks ?? []

  useEffect(() => {
    if (
      shouldEnableAudioTrackSelection &&
      audioStreams.length > 0 &&
      // Added audio counts as a track, so the video's own tracks may all be unselected
      addedAudioTracks.length === 0 &&
      (!selectedAudioTracks || selectedAudioTracks.length === 0)
    ) {
      const allTrackIndices = audioStreams.map((_, index) => index)

      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.selectedAudioTracks =
          allTrackIndices
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].selectedAudioTracks = allTrackIndices
          normalizeBatchMediaConfig()
        }
      }
    }
  }, [
    shouldEnableAudioTrackSelection,
    mediaIndex,
    audioStreams,
    selectedAudioTracks,
    addedAudioTracks.length,
    batchConfigKey,
  ])

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      appProxy.state.media[mediaIndex].config.shouldEnableAudioTrackSelection =
        !shouldEnableAudioTrackSelection
      appProxy.state.media[mediaIndex].isConfigDirty = true

      if (!shouldEnableAudioTrackSelection) {
        appProxy.state.media[mediaIndex].config.selectedAudioTracks =
          audioStreams.map((_, index) => index)
      } else {
        appProxy.state.media[mediaIndex].config.selectedAudioTracks = []
      }
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression[
          batchConfigKey
        ].shouldEnableAudioTrackSelection = !shouldEnableAudioTrackSelection
        if (!shouldEnableAudioTrackSelection) {
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].selectedAudioTracks = audioStreams.map((_, index) => index)
        } else {
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].selectedAudioTracks = []
        }
        normalizeBatchMediaConfig()
      }
    }
  }, [
    mediaIndex,
    shouldEnableAudioTrackSelection,
    audioStreams,
    batchConfigKey,
  ])

  const handleTrackToggle = useCallback(
    (trackIndex: number) => {
      const currentSelected = selectedAudioTracks ?? []
      const isSelected = currentSelected.includes(trackIndex)

      let newSelected: number[]
      if (isSelected) {
        // Added audio files count as tracks: the video's own tracks can all be unselected when
        // an added one is kept
        if (currentSelected.length + addedAudioTracks.length <= 1) return
        newSelected = currentSelected.filter((i) => i !== trackIndex)
      } else {
        newSelected = [...currentSelected, trackIndex]
      }

      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.selectedAudioTracks =
          newSelected
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].selectedAudioTracks = newSelected
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex, selectedAudioTracks, addedAudioTracks.length, batchConfigKey],
  )

  const updateAddedAudioTracks = useCallback(
    (update: (tracks: ExternalAudioTrack[]) => ExternalAudioTrack[]) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        const videoConfig = appProxy.state.media[mediaIndex].config
        videoConfig.externalAudioTracks = update([
          ...(videoConfig.externalAudioTracks ?? []),
        ])
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          const commonConfig =
            appProxy.state.commonConfigForBatchCompression[batchConfigKey]
          commonConfig.externalAudioTracks = update([
            ...(commonConfig.externalAudioTracks ?? []),
          ])
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex, batchConfigKey],
  )

  const handleAddAudio = useCallback(async () => {
    try {
      const filePath = await open({
        directory: false,
        multiple: false,
        title: t('audio.selectFile'),
        filters: [
          {
            name: t('audio.fileFilter'),
            extensions: AUDIO_FILE_EXTENSIONS,
          },
        ],
      })
      if (typeof filePath !== 'string') return
      if (addedAudioTracks.some((track) => track.path === filePath)) return

      const [streams, basicInfo] = await Promise.all([
        getAudioStreams(filePath).catch(() => null),
        getVideoBasicInfo(filePath).catch(() => null),
      ])
      if (!streams || streams.length === 0) {
        toast.error(t('audio.addFailed'))
        return
      }

      const streamDuration = Number(streams[0]?.duration)
      updateAddedAudioTracks((tracks) => [
        ...tracks,
        {
          path: filePath,
          fileName: filePath.split(/[/\\]/).pop() ?? null,
          duration:
            basicInfo?.duration ??
            (Number.isFinite(streamDuration) ? streamDuration : null),
        },
      ])
    } catch (error: any) {
      toast.error(error?.message ?? t('audio.addFailed'))
    }
  }, [addedAudioTracks, updateAddedAudioTracks, t])

  const handleRemoveAudio = useCallback(
    (index: number) => {
      // Removing the last added audio may leave no selected track: keep the first of the video's
      // own tracks then, if it has any
      const shouldSelectOriginalTrack =
        addedAudioTracks.length <= 1 &&
        shouldEnableAudioTrackSelection &&
        audioStreams.length > 0 &&
        (selectedAudioTracks?.length ?? 0) === 0

      updateAddedAudioTracks((tracks) =>
        tracks.filter((_, trackIndex) => trackIndex !== index),
      )

      if (shouldSelectOriginalTrack) {
        if (
          mediaIndex >= 0 &&
          appProxy.state.media[mediaIndex].type === 'video' &&
          appProxy.state.media[mediaIndex]?.config
        ) {
          appProxy.state.media[mediaIndex].config.selectedAudioTracks = [0]
          appProxy.state.media[mediaIndex].isConfigDirty = true
        } else {
          if (appProxy.state.media.length > 1) {
            appProxy.state.commonConfigForBatchCompression[
              batchConfigKey
            ].selectedAudioTracks = [0]
            normalizeBatchMediaConfig()
          }
        }
      }
    },
    [
      addedAudioTracks.length,
      audioStreams,
      selectedAudioTracks,
      shouldEnableAudioTrackSelection,
      updateAddedAudioTracks,
      mediaIndex,
      batchConfigKey,
    ],
  )

  const hasNoAudio = audioStreams.length === 0
  const hasAddedAudio = addedAudioTracks.length > 0

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    // Muted, an audio output is still written (as silence), so its settings stay available
    (audioConfig?.volume === 0 &&
      !isAudioOutput({
        isAudioFile: video?.isAudioFile,
        isAudioFileSettings: batchConfigKey === 'audioFileConfig',
        convertToExtension,
      })) ||
    convertToExtension === 'gif'

  return (
    <>
      <Switch
        isSelected={shouldEnableAudioTrackSelection}
        onValueChange={handleSwitchToggle}
        isDisabled={shouldDisableInput}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          {t('audio.tracks')}
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {shouldEnableAudioTrackSelection ? (
          <motion.div {...slideDownTransition} className="pt-1">
            <div className="w-full rounded-2xl">
              {audioStreams.map((stream: AudioStream, index: number) => {
                const isSelected = (selectedAudioTracks ?? []).includes(index)
                const language = getLanguageFromTags(stream.tags)
                const title = getTitleFromTags(stream.tags)

                return (
                  <Checkbox
                    key={`source-${index}`}
                    isSelected={isSelected}
                    onValueChange={() => handleTrackToggle(index)}
                    isDisabled={shouldDisableInput}
                    size="sm"
                    classNames={{
                      base: cn(
                        'inline-flex w-full max-w-md items-center justify-start',
                        'cursor-pointer rounded-xl gap-2 p-4 py-2 pl-6 border-2 border-transparent',
                      ),
                      label: 'w-full',
                    }}
                    className="my-[2px]"
                  >
                    <div className="flex flex-col ml-2">
                      <span className="text-sm font-medium">
                        {t('audio.track', { number: index + 1 })}
                        {title ? ` - ${title}` : ''}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {language ? `${language} • ` : ''}
                        {stream.codec.toUpperCase?.() ?? ''} •{' '}
                        {t('audio.channelCount', {
                          count: Number(stream.channels) || 0,
                        })}
                      </span>
                    </div>
                  </Checkbox>
                )
              })}
              {addedAudioTracks.map((track, index) => (
                <div
                  key={`added-${track.path}`}
                  className="flex w-full items-center gap-2 rounded-xl p-4 py-2 pl-6 my-[2px] max-w-md"
                >
                  <Icon
                    name="music"
                    size={18}
                    className="shrink-0 text-primary"
                  />
                  <div className="flex min-w-0 flex-1 flex-col ml-1">
                    <span className="truncate text-sm font-medium">
                      {track.fileName ?? t('audio.addedTrack')}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {t('audio.addedTrack')}
                    </span>
                  </div>
                  <Button
                    type="button"
                    onPress={() => handleRemoveAudio(index)}
                    size="sm"
                    isDisabled={shouldDisableInput}
                    color="danger"
                    isIconOnly
                  >
                    <Icon name="cross" size={16} />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              onPress={handleAddAudio}
              fullWidth
              size="sm"
              isDisabled={shouldDisableInput}
              className="mt-2"
            >
              {t('audio.addTrack')}
              <Icon name="plus" size={14} />
            </Button>
            {hasNoAudio && !hasAddedAudio ? (
              <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
                {t('audio.addTrackHint')}
              </p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default AudioTracks
