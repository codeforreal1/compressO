import { SelectItem, SelectSection } from '@heroui/react'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Select from '@/components/Select'
import { extensions } from '@/types/compression'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

const videoExtensions = Object.keys(extensions?.video)

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
  const { config } = video ?? {}
  const { convertToExtension } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const handleValueChange = useCallback(
    (value: keyof typeof extensions.video) => {
      if (value?.length > 0) {
        if (
          mediaIndex >= 0 &&
          appProxy.state.media[mediaIndex].type === 'video' &&
          appProxy.state.media[mediaIndex]?.config
        ) {
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
      label="扩展名："
      className="block flex-shrink-0 rounded-2xl"
      size="sm"
      value={convertToExtension}
      selectedKeys={[convertToExtension!]}
      onChange={(evt) => {
        const value = evt?.target
          ?.value as unknown as keyof typeof extensions.video
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
        textValue="与输入相同"
        className="flex justify-center items-center"
      >
        与输入相同
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
    </Select>
  )
}

export default Extension
