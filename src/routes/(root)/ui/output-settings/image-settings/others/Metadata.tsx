import cloneDeep from 'lodash/cloneDeep'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Switch from '@/components/Switch'
import {
  appProxy,
  normalizeBatchMediaConfig,
  videoMetadataConfigInitialState,
} from '@/routes/(root)/-state'
import { ImageExtension } from '@/types/compression'

type MetadataProps = {
  mediaIndex: number
}

function Metadata({ mediaIndex }: MetadataProps) {
  const {
    state: {
      isCompressing,
      isProcessCompleted,
      media,
      commonConfigForBatchCompression,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const image =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type == 'image'
      ? media[mediaIndex]
      : null
  const { config } = image ?? {}
  const { shouldStripMetadata, convertToExtension } =
    config ?? commonConfigForBatchCompression.imageConfig ?? {}

  const handleStripMetadataToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'image' &&
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
        appProxy.state.commonConfigForBatchCompression.imageConfig.shouldStripMetadata =
          !appProxy.state.commonConfigForBatchCompression.imageConfig
            .shouldStripMetadata

        if (
          appProxy.state.commonConfigForBatchCompression.imageConfig
            .shouldStripMetadata
        ) {
          appProxy.state.commonConfigForBatchCompression.imageConfig.metadataConfig =
            null
        } else {
          appProxy.state.commonConfigForBatchCompression.imageConfig.metadataConfig =
            cloneDeep(videoMetadataConfigInitialState)
        }

        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex])

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    (['gif', 'svg', 'webp'] as ImageExtension[]).includes(
      image?.extension as ImageExtension,
    ) ||
    (['svg', 'webp'] as ImageExtension[]).includes(
      convertToExtension as ImageExtension,
    )

  return (
    <>
      <Switch
        isSelected={shouldStripMetadata}
        onValueChange={handleStripMetadataToggle}
        isDisabled={shouldDisableInput}
      >
        <div className="flex justify-center items-center">
          <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
            移除元数据
          </span>
        </div>
      </Switch>
    </>
  )
}

export default Metadata
