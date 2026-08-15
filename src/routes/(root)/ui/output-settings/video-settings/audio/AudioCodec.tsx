import { SelectItem, SelectSection } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect } from 'react'
import { useSnapshot } from 'valtio'

import Icon from '@/components/Icon'
import Select from '@/components/Select'
import Switch from '@/components/Switch'
import Tooltip from '@/components/Tooltip'
import { extensions } from '@/types/compression'
import { slideDownTransition } from '@/utils/animation'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

type VideoExtension = keyof typeof extensions.video

type AudioCodecOption = {
  value: string
  name: string
  description: string
  compatible_containers: VideoExtension[]
}

const AUDIO_CODECS: readonly AudioCodecOption[] = [
  {
    value: 'aac',
    name: 'AAC',
    description: '标准编码器，兼容性广',
    compatible_containers: ['mp4', 'mov', 'mkv'] as VideoExtension[],
  },
  {
    value: 'libmp3lame',
    name: 'MP3',
    description: '通用音频格式',
    compatible_containers: ['mp4', 'mov', 'mkv', 'avi'] as VideoExtension[],
  },
  {
    value: 'libopus',
    name: 'Opus',
    description: '现代格式，质量高',
    compatible_containers: ['webm', 'mkv'] as VideoExtension[],
  },
  {
    value: 'libvorbis',
    name: 'Vorbis',
    description: '开源格式，质量良好',
    compatible_containers: ['webm', 'mkv'] as VideoExtension[],
  },
  {
    value: 'ac3',
    name: 'AC3',
    description: '杜比数字，支持环绕声',
    compatible_containers: ['mp4', 'mov', 'mkv', 'avi'] as VideoExtension[],
  },
  {
    value: 'alac',
    name: 'ALAC',
    description: '针对 Apple 设备优化的无损压缩',
    compatible_containers: ['mp4', 'mov'] as VideoExtension[],
  },
  {
    value: 'flac',
    name: 'FLAC',
    description: '无损压缩',
    compatible_containers: ['mkv'] as VideoExtension[],
  },
  {
    value: 'pcm_s16le',
    name: 'PCM',
    description: '未压缩，质量最佳',
    compatible_containers: ['mov', 'avi'] as VideoExtension[],
  },
]

type AudioCodecProps = {
  mediaIndex: number
}

function AudioCodec({ mediaIndex }: AudioCodecProps) {
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
  const { config, videoInfoRaw, extension: videoExtension } = video ?? {}
  const { shouldEnableCustomAudioCodec, convertToExtension, audioConfig } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

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
            appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig.audioCodec =
              undefined
          }
        }
      }
    }
  }, [
    currentExtension,
    shouldEnableCustomAudioCodec,
    customAudioCodec,
    mediaIndex,
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
        appProxy.state.commonConfigForBatchCompression.videoConfig.shouldEnableCustomAudioCodec =
          !shouldEnableCustomAudioCodec
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, shouldEnableCustomAudioCodec])

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
          appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig.audioCodec =
            value
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const hasNoAudio = videoInfoRaw?.audioStreams?.length === 0

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    hasNoAudio ||
    audioConfig?.volume === 0 ||
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
          编码器
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {shouldEnableCustomAudioCodec ? (
          <motion.div {...slideDownTransition}>
            <Select
              fullWidth
              label="选择编码器："
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
                textValue="默认"
                className="flex justify-center items-center"
                endContent={
                  <Tooltip
                    content="所选容器的默认编码器"
                    aria-label="所选容器的默认编码器"
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
                  <span className="text-sm">默认</span>
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
