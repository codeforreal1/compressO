import { SelectItem } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Icon from '@/components/Icon'
import Select from '@/components/Select'
import Switch from '@/components/Switch'
import Tooltip from '@/components/Tooltip'
import { compressionPresets } from '@/types/compression'
import { slideDownTransition } from '@/utils/animation'
import CompressionQuality from './CompressionQuality'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

const PRESETS: {
  name: keyof typeof compressionPresets
  description: React.ReactNode
}[] = [
  {
    name: 'ironclad',
    description: <p>体积最优，但处理速度稍慢</p>,
  },
  {
    name: 'thunderbolt',
    description: <p>体积稍大，但处理速度更快</p>,
  },
]

type CompressionPresetProps = {
  mediaIndex: number
}

function CompressionPreset({ mediaIndex }: CompressionPresetProps) {
  const {
    state: {
      isCompressing,
      isProcessCompleted,
      media,
      commonConfigForBatchCompression,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const video =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config } = video ?? {}
  const { presetName, shouldDisableCompression, convertToExtension } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      appProxy.state.media[mediaIndex].config.shouldDisableCompression =
        !shouldDisableCompression
      appProxy.state.media[mediaIndex].isConfigDirty = true
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression.videoConfig.shouldDisableCompression =
          !shouldDisableCompression
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, shouldDisableCompression])

  const handleValueChange = useCallback(
    (value: keyof typeof compressionPresets) => {
      if (value?.length > 0) {
        if (
          mediaIndex >= 0 &&
          appProxy.state.media[mediaIndex].type === 'video' &&
          appProxy.state.media[mediaIndex]?.config
        ) {
          appProxy.state.media[mediaIndex].config.presetName = value
          appProxy.state.media[mediaIndex].isConfigDirty = true
        } else {
          if (appProxy.state.media.length > 1) {
            appProxy.state.commonConfigForBatchCompression.videoConfig.presetName =
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

  const isLossless = shouldDisableCompression

  return (
    <>
      <div className="flex items-center mb-4">
        <Switch
          isSelected={isLossless}
          onValueChange={handleSwitchToggle}
          className="flex justify-center items-center"
          isDisabled={shouldDisableInput}
          size="sm"
        >
          <div className="flex justify-center items-center">
            <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
              无损压缩
            </span>
          </div>
        </Switch>
      </div>
      <AnimatePresence mode="wait">
        {!isLossless ? (
          <motion.div {...slideDownTransition} className="mt-2">
            <div className="mt-8">
              <Select
                fullWidth
                label="压缩预设："
                labelPlacement="outside"
                className="block flex-shrink-0 rounded-2xl"
                selectedKeys={[presetName!]}
                onChange={(evt) => {
                  const value = evt?.target
                    ?.value as unknown as keyof typeof compressionPresets
                  handleValueChange(value)
                }}
                selectionMode="single"
                isDisabled={
                  shouldDisableCompression ||
                  shouldDisableInput ||
                  convertToExtension === 'gif'
                }
                classNames={{
                  label: '!text-gray-600 dark:!text-gray-400 text-xs',
                }}
              >
                {PRESETS?.map((preset) => (
                  <SelectItem
                    key={preset.name}
                    textValue={preset.name}
                    className="flex justify-center items-center"
                    endContent={
                      preset.name === compressionPresets.ironclad ? (
                        <Tooltip content="推荐" aria-label="推荐">
                          <Icon
                            name="star"
                            className="inline-block ml-1 text-yellow-500"
                            size={15}
                          />
                        </Tooltip>
                      ) : null
                    }
                    description={preset.description}
                  >
                    {preset.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="mt-2">
              <CompressionQuality mediaIndex={mediaIndex} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default CompressionPreset
