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

type VideoCodecOption = {
  value: string
  name: string
  description: string
  compatible_containers: VideoExtension[]
}

const VIDEO_CODECS: readonly VideoCodecOption[] = [
  {
    value: 'libx264',
    name: 'H.264 (AVC)',
    description: '兼容性最好，质量良好',
    compatible_containers: ['mp4', 'mov', 'mkv', 'avi'] as VideoExtension[],
  },
  {
    value: 'libx265',
    name: 'H.265 (HEVC)',
    description: '压缩效果更好，较新的标准',
    compatible_containers: ['mp4', 'mov', 'mkv'] as VideoExtension[],
  },
  {
    value: 'libvpx-vp9',
    name: 'VP9',
    description: '开源，适合网页使用',
    compatible_containers: ['webm', 'mkv'] as VideoExtension[],
  },
  {
    value: 'libaom-av1',
    name: 'AV1',
    description: '压缩效果最佳，但速度很慢',
    compatible_containers: ['mp4', 'mkv', 'webm'] as VideoExtension[],
  },
  {
    value: 'mpeg4',
    name: 'MPEG-4',
    description: '传统编码器，支持范围广',
    compatible_containers: ['mp4', 'mov', 'mkv', 'avi'] as VideoExtension[],
  },
]

type VideoCodecProps = {
  mediaIndex: number
}

function VideoCodec({ mediaIndex }: VideoCodecProps) {
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
  const { config, extension: videoExtension } = video ?? {}
  const { shouldEnableCustomVideoCodec, customVideoCodec, convertToExtension } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const currentExtension = convertToExtension
    ? convertToExtension === '-'
      ? videoExtension
      : convertToExtension
    : '-'

  // Reset codec if it's not compatible with the current extension
  useEffect(() => {
    if (shouldEnableCustomVideoCodec && customVideoCodec) {
      const currentCodec = VIDEO_CODECS.find(
        (c) => c.value === customVideoCodec,
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
          appProxy.state.media[mediaIndex].config.customVideoCodec = undefined
        } else {
          if (appProxy.state.media.length > 1) {
            appProxy.state.commonConfigForBatchCompression.videoConfig.customVideoCodec =
              undefined
          }
        }
      }
    }
  }, [
    currentExtension,
    shouldEnableCustomVideoCodec,
    customVideoCodec,
    mediaIndex,
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
        appProxy.state.commonConfigForBatchCompression.videoConfig.shouldEnableCustomVideoCodec =
          !shouldEnableCustomVideoCodec
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, shouldEnableCustomVideoCodec])

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
          appProxy.state.commonConfigForBatchCompression.videoConfig.customVideoCodec =
            value
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    convertToExtension === 'gif'

  const initialCodecValue = customVideoCodec ?? '-'

  const compatibleCodecs = VIDEO_CODECS.filter((codec) =>
    codec.compatible_containers.includes(currentExtension as any),
  )

  return (
    <>
      <Switch
        isSelected={shouldEnableCustomVideoCodec}
        onValueChange={handleSwitchToggle}
        isDisabled={shouldDisableInput}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          编码器
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {shouldEnableCustomVideoCodec ? (
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
              isDisabled={!shouldEnableCustomVideoCodec || shouldDisableInput}
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

export default VideoCodec
