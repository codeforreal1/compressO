import { SelectItem, SelectSection } from '@heroui/react'
import { useCallback, useEffect } from 'react'
import { useSnapshot } from 'valtio'

import Icon from '@/components/Icon'
import Select from '@/components/Select'
import { toast } from '@/components/Toast'
import { getAudioStreams } from '@/tauri/commands/ffprobe'
import { extensions, isAudioExtension } from '@/types/compression'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

const videoExtensions = Object.keys(extensions?.video)
const audioExtensions = Object.keys(extensions?.audio)

type VideoExtensionProps = {
  mediaIndex: number
}

function Extension({ mediaIndex }: VideoExtensionProps) {
  const {
    state: {
      media,
      isCompressing,
      isProcessCompleted,
      commonConfigForBatchCompression,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const video =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config, pathRaw: videoPathRaw } = video ?? {}
  const { convertToExtension } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

  // Audio can only be extracted from a video that has audio, so find out up front (the same probe &
  // cache as the Audio tab)
  const hasNoAudio = video?.videoInfoRaw?.audioStreams?.length === 0
  const hasCheckedAudio = !!video?.videoInfoRaw?.audioStreams
  useEffect(() => {
    if (mediaIndex < 0 || !videoPathRaw || hasCheckedAudio) return
    getAudioStreams(videoPathRaw)
      .then((streams) => {
        const targetVideo = appProxy.state.media[mediaIndex]
        if (!streams || targetVideo?.type !== 'video') return
        targetVideo.videoInfoRaw = {
          ...(targetVideo.videoInfoRaw ?? {}),
          audioStreams: streams,
        }
      })
      .catch(() => {})
  }, [mediaIndex, videoPathRaw, hasCheckedAudio])

  const handleValueChange = useCallback(
    async (
      value: keyof typeof extensions.video | keyof typeof extensions.audio,
    ) => {
      if (value?.length > 0) {
        if (
          mediaIndex >= 0 &&
          appProxy.state.media[mediaIndex].type === 'video' &&
          appProxy.state.media[mediaIndex]?.config
        ) {
          // Audio can only be extracted from a video that has audio
          const targetVideo = appProxy.state.media[mediaIndex]
          if (isAudioExtension(value) && targetVideo.pathRaw) {
            const audioStreams =
              targetVideo.videoInfoRaw?.audioStreams ??
              (await getAudioStreams(targetVideo.pathRaw).catch(() => null))
            if (audioStreams && audioStreams.length === 0) {
              toast.error('This video has no audio to extract.')
              return
            }
          }
          appProxy.state.media[mediaIndex].config.convertToExtension = value
          appProxy.state.media[mediaIndex].isConfigDirty = true
        } else {
          if (appProxy.state.media.length > 1) {
            appProxy.state.commonConfigForBatchCompression.videoConfig.convertToExtension =
              value
            normalizeBatchMediaConfig()
          }
        }
      }
    },
    [mediaIndex],
  )

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  return (
    <Select
      fullWidth
      label="Extension:"
      className="block flex-shrink-0 rounded-2xl"
      size="sm"
      value={convertToExtension}
      selectedKeys={[convertToExtension!]}
      disabledKeys={hasNoAudio ? audioExtensions : []}
      onChange={(evt) => {
        const value = evt?.target?.value as unknown as
          | keyof typeof extensions.video
          | keyof typeof extensions.audio
        handleValueChange(value)
      }}
      selectionMode="single"
      isDisabled={shouldDisableInput}
      classNames={{
        label: '!text-gray-600 dark:!text-gray-400 text-sm',
      }}
    >
      <SelectItem
        key="-"
        textValue="Same as input"
        className="flex justify-center items-center"
      >
        Same as input
      </SelectItem>
      <SelectSection>
        {videoExtensions?.map((ext) => (
          <SelectItem
            key={ext}
            textValue={ext}
            className="flex justify-center items-center"
          >
            {ext}
          </SelectItem>
        ))}
      </SelectSection>
      <SelectSection
        title={hasNoAudio ? 'Extract audio (No audio found)' : 'Extract audio'}
        classNames={{ heading: hasNoAudio ? 'text-danger' : '' }}
      >
        {audioExtensions?.map((ext) => (
          <SelectItem
            key={ext}
            textValue={ext}
            className="flex justify-center items-center"
            endContent={
              hasNoAudio ? (
                <Icon name="audioMuted" size={14} className="text-danger" />
              ) : null
            }
          >
            {ext}
          </SelectItem>
        ))}
      </SelectSection>
    </Select>
  )
}

export default Extension
