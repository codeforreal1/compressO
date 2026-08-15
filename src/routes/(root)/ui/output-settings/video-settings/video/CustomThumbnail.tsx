import { core } from '@tauri-apps/api'
import { open } from '@tauri-apps/plugin-dialog'
import { motion } from 'framer-motion'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Image from '@/components/Image'
import Switch from '@/components/Switch'
import TextInput from '@/components/TextInput'
import { ImageExtension } from '@/types/compression'
import { slideDownTransition } from '@/utils/animation'
import { cn } from '@/utils/tailwind'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

type CustomThumbnailProps = {
  mediaIndex: number
}

const THUMBNAIL_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

function CustomThumbnail({ mediaIndex }: CustomThumbnailProps) {
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
  const {
    customThumbnailPath,
    shouldEnableCustomThumbnail,
    convertToExtension,
  } = config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const thumbnailFileName = customThumbnailPath
    ? customThumbnailPath.split(/[/\\]/).pop()
    : null

  const handleThumbnailSelect = useCallback(async () => {
    try {
      const filePath = await open({
        directory: false,
        multiple: false,
        title: '选择缩略图。',
        filters: [
          {
            name: 'image',
            extensions: THUMBNAIL_EXTENSIONS,
          },
        ],
      })
      if (typeof filePath === 'string') {
        if (
          mediaIndex >= 0 &&
          appProxy.state.media[mediaIndex].type === 'video' &&
          appProxy.state.media[mediaIndex]?.config
        ) {
          appProxy.state.media[mediaIndex].config.customThumbnailPath = filePath
          appProxy.state.media[mediaIndex].isConfigDirty = true
        } else {
          if (appProxy.state.media.length > 1) {
            appProxy.state.commonConfigForBatchCompression.videoConfig.customThumbnailPath =
              filePath
            normalizeBatchMediaConfig()
          }
        }
      }
    } catch (error: any) {
      toast.error(error?.message ?? '无法选择缩略图。')
    }
  }, [mediaIndex])

  const handleClearThumbnail = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      appProxy.state.media[mediaIndex].config.customThumbnailPath = ''
      appProxy.state.media[mediaIndex].isConfigDirty = true
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression.videoConfig.customThumbnailPath =
          null
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex])

  const handleToggleChange = useCallback(
    (isSelected: boolean) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.shouldEnableCustomThumbnail =
          isSelected
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression.videoConfig.shouldEnableCustomThumbnail =
            isSelected
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
    (['webm', 'gif'] as ImageExtension[]).includes(
      convertToExtension as ImageExtension,
    )

  return (
    <>
      <div>
        <div className="flex items-center">
          <Switch
            isSelected={Boolean(shouldEnableCustomThumbnail)}
            onValueChange={handleToggleChange}
            className="flex justify-center items-center"
            isDisabled={shouldDisableInput}
            size="sm"
          >
            <div className="flex justify-center items-center">
              <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
                自定义缩略图{' '}
              </span>
            </div>
          </Switch>
        </div>
        {shouldEnableCustomThumbnail ? (
          <motion.div {...slideDownTransition} className="mt-2">
            <TextInput
              type="text"
              label=""
              placeholder="未选择缩略图"
              value={thumbnailFileName ?? '未选择缩略图'}
              isDisabled={shouldDisableInput}
              isReadOnly
              classNames={{
                input: 'text-xs',
                mainWrapper: 'my-3',
              }}
            />
            {customThumbnailPath ? (
              <div
                className={cn(
                  'flex justify-center items-center w-full',
                  shouldDisableInput ? 'opacity-50' : '',
                )}
              >
                <Image
                  alt="自定义缩略图"
                  src={core.convertFileSrc(customThumbnailPath)}
                  className={
                    'max-w-[200px] max-h-[200px] mx-auto object-contain mb-4'
                  }
                />
              </div>
            ) : null}
            <div>
              {!thumbnailFileName ? (
                <Button
                  type="button"
                  onPress={handleThumbnailSelect}
                  fullWidth
                  size="sm"
                  isDisabled={
                    shouldDisableInput || convertToExtension === 'webm'
                  }
                >
                  选择
                  <Icon name="fileExplorer" size={14} />
                </Button>
              ) : (
                <Button
                  type="button"
                  onPress={handleClearThumbnail}
                  fullWidth
                  size="sm"
                  isDisabled={
                    shouldDisableInput || convertToExtension === 'webm'
                  }
                  color="danger"
                >
                  清除
                </Button>
              )}
              {convertToExtension === 'webm' ? (
                <p className="text-xs italic text-danger-300 mt-2">
                  webm 不支持自定义缩略图
                </p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
        <Divider className="mt-3 mb-6" />
      </div>
    </>
  )
}

export default CustomThumbnail
