import { core } from '@tauri-apps/api'
import { open } from '@tauri-apps/plugin-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Image from '@/components/Image'
import Switch from '@/components/Switch'
import TextInput from '@/components/TextInput'
import { slideDownTransition } from '@/utils/animation'
import { cn } from '@/utils/tailwind'
import { getOutputVideoContainer } from '@/utils/video'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'

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
  const batchConfigKey = useBatchVideoConfigKey()

  const video =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config } = video ?? {}
  const {
    customThumbnailPath,
    shouldEnableCustomThumbnail,
    convertToExtension,
  } = config ?? commonConfigForBatchCompression[batchConfigKey] ?? {}
  const outputContainer = getOutputVideoContainer(
    convertToExtension,
    video?.extension,
  )

  const thumbnailFileName = customThumbnailPath
    ? customThumbnailPath.split(/[/\\]/).pop()
    : null

  const handleThumbnailSelect = useCallback(async () => {
    try {
      const filePath = await open({
        directory: false,
        multiple: false,
        title: 'Select thumbnail image.',
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
            appProxy.state.commonConfigForBatchCompression[
              batchConfigKey
            ].customThumbnailPath = filePath
            normalizeBatchMediaConfig()
          }
        }
      }
    } catch (error: any) {
      toast.error(error?.message ?? 'Could not select thumbnail image.')
    }
  }, [mediaIndex, batchConfigKey])

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
        appProxy.state.commonConfigForBatchCompression[
          batchConfigKey
        ].customThumbnailPath = null
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, batchConfigKey])

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
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].shouldEnableCustomThumbnail = isSelected
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex, batchConfigKey],
  )

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    (['webm', 'ts', 'gif'] as string[]).includes(outputContainer)

  const isThumbnailUnsupported =
    outputContainer === 'webm' || outputContainer === 'ts'

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
                Thumbnail{' '}
              </span>
            </div>
          </Switch>
        </div>
        <AnimatePresence initial={false}>
          {shouldEnableCustomThumbnail ? (
            <motion.div {...slideDownTransition} className="pt-2">
              <TextInput
                type="text"
                label=""
                placeholder="No thumbnail selected"
                value={thumbnailFileName ?? 'No thumbnail selected'}
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
                    alt="custom thumbnail"
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
                    isDisabled={shouldDisableInput || isThumbnailUnsupported}
                  >
                    Choose
                    <Icon name="fileExplorer" size={14} />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onPress={handleClearThumbnail}
                    fullWidth
                    size="sm"
                    isDisabled={shouldDisableInput || isThumbnailUnsupported}
                    color="danger"
                  >
                    Clear
                  </Button>
                )}
                {isThumbnailUnsupported ? (
                  <p className="text-xs italic text-danger-300 mt-2">
                    {outputContainer} does not support custom thumbnail
                  </p>
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <Divider className="mt-3 mb-6" />
      </div>
    </>
  )
}

export default CustomThumbnail
