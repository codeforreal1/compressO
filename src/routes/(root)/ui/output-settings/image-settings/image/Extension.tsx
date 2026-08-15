import { SelectItem, SelectSection } from '@heroui/react'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Select from '@/components/Select'
import { appProxy, normalizeBatchMediaConfig } from '@/routes/(root)/-state'
import { extensions } from '@/types/compression'

type ExtensionProps = {
  mediaIndex: number
  disabled?: boolean
}

const Extension = ({ mediaIndex, disabled }: ExtensionProps) => {
  const {
    state: {
      media,
      commonConfigForBatchCompression,
      isCompressing,
      isProcessCompleted,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const image =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'image'
      ? media[mediaIndex]
      : null
  const { config } = image ?? {}
  const { convertToExtension } =
    config ?? commonConfigForBatchCompression.imageConfig ?? {}

  const handleValueChange = useCallback(
    (value: keyof typeof extensions.image) => {
      if (value?.length > 0) {
        if (
          mediaIndex >= 0 &&
          appProxy.state.media[mediaIndex].type === 'image' &&
          appProxy.state.media[mediaIndex]?.config
        ) {
          appProxy.state.media[mediaIndex].config.convertToExtension = value
          appProxy.state.media[mediaIndex].isConfigDirty = true
        } else {
          if (appProxy.state.media.length > 1) {
            appProxy.state.commonConfigForBatchCompression.imageConfig.convertToExtension =
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
    isLoadingMediaFiles ||
    image?.extension === 'gif'

  return (
    <Select
      fullWidth
      label="扩展名："
      value={convertToExtension}
      selectedKeys={[convertToExtension]}
      onChange={(evt) => {
        const value = evt.target.value as keyof typeof extensions.image
        handleValueChange(value)
      }}
      disabled={disabled}
      className="w-full"
      classNames={{
        label: '!text-gray-600 dark:!text-gray-400 text-sm',
      }}
      isDisabled={shouldDisableInput}
    >
      <SelectItem key="-">与输入相同</SelectItem>
      <SelectSection>
        {Object.values(extensions.image)
          .filter(
            (ext) =>
              !(['gif'] as (keyof typeof extensions.image)[]).includes(ext),
          )
          .map((ext) => (
            <SelectItem key={ext}>{ext.toUpperCase()}</SelectItem>
          ))}
      </SelectSection>
    </Select>
  )
}

export default Extension
