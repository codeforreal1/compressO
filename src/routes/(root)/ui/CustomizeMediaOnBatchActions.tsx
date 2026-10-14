import { Button } from '@heroui/react'
import { core } from '@tauri-apps/api'
import { motion } from 'framer-motion'
import { cloneDeep } from 'lodash'
import { memo, useCallback, useEffect } from 'react'
import { snapshot, useSnapshot } from 'valtio'

import { zoomInTransition } from '@/utils/animation'
import { isOverlayOpen, isTextEntryElement } from '@/utils/keyboard'
import PreviewSingleVideo from './PreviewSingleMedia'
import { appProxy, normalizeBatchMediaConfig } from '../-state'

function CustomizeMediaOnBatchActions() {
  const {
    state: {
      selectedMediaIndexForCustomization,
      isProcessCompleted,
      showMediaInfo,
    },
  } = useSnapshot(appProxy)

  const handleApplyVideoConfig = useCallback(() => {
    const selectedMediaIndexForCustomization =
      appProxy.state.selectedMediaIndexForCustomization
    if (selectedMediaIndexForCustomization >= 0) {
      appProxy.state.selectedMediaIndexForCustomization = -1

      if (
        appProxy.state.media[selectedMediaIndexForCustomization].type ===
        'video'
      ) {
        if (
          appProxy.state.media[selectedMediaIndexForCustomization]?.config
            ?.shouldTransformVideo &&
          appProxy.state.media[selectedMediaIndexForCustomization].config
            ?.transformVideoConfig?.previewUrl
        ) {
          appProxy.state.media[
            selectedMediaIndexForCustomization
          ].thumbnailPath =
            appProxy.state.media[
              selectedMediaIndexForCustomization
            ]?.config?.transformVideoConfig?.previewUrl
          appProxy.state.media[
            selectedMediaIndexForCustomization
          ].config.isVideoTransformEditMode = false
        }
      } else if (
        appProxy.state.media[selectedMediaIndexForCustomization].type ===
        'image'
      ) {
        if (
          appProxy.state.media[selectedMediaIndexForCustomization]?.config
            ?.shouldTransformImage &&
          appProxy.state.media[selectedMediaIndexForCustomization].config
            ?.transformImageConfig?.previewUrl
        ) {
          appProxy.state.media[
            selectedMediaIndexForCustomization
          ].thumbnailPath =
            appProxy.state.media[
              selectedMediaIndexForCustomization
            ]?.config?.transformImageConfig?.previewUrl
          appProxy.state.media[
            selectedMediaIndexForCustomization
          ].config.isImageTransformEditMode = false
        }
      }
    }
  }, [])

  const handleResetMediaConfig = useCallback(() => {
    const selectedMediaIndexForCustomization =
      appProxy.state.selectedMediaIndexForCustomization
    if (selectedMediaIndexForCustomization >= 0) {
      const mediaSnapshot =
        appProxy.state.media[selectedMediaIndexForCustomization]
      if (mediaSnapshot?.type === 'video') {
        mediaSnapshot.thumbnailPath = core.convertFileSrc(
          mediaSnapshot.thumbnailPathRaw!,
        )
        mediaSnapshot.config = cloneDeep(
          appProxy.state.commonConfigForBatchCompression.videoConfig,
        )
        appProxy.state.media[selectedMediaIndexForCustomization].isConfigDirty =
          false
      } else if (mediaSnapshot?.type === 'image') {
        mediaSnapshot.thumbnailPath = core.convertFileSrc(
          mediaSnapshot.thumbnailPathRaw!,
        )
        mediaSnapshot.config = cloneDeep(
          appProxy.state.commonConfigForBatchCompression.imageConfig,
        )
      }
      appProxy.state.media[selectedMediaIndexForCustomization].isConfigDirty =
        false
      // Also sets the batch's resolution as its own dimensions
      normalizeBatchMediaConfig()
      appProxy.state.selectedMediaIndexForCustomization = -1
    }
  }, [])

  // Escape acts like the Apply button (Close after compression), back to the batch
  useEffect(() => {
    // Capture phase, so it runs before the Escape handler of the full media info, which is skipped
    // below (Escape closes the info first)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== 'Escape' ||
        e.repeat ||
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        isTextEntryElement(e.target as HTMLElement | null) ||
        isOverlayOpen()
      ) {
        return
      }
      const { state } = snapshot(appProxy)
      // Escape saves an open crop or trim editor instead (see `PreviewSingleMedia`)
      const isEditing = state.media.some(
        (mediaFile) =>
          (mediaFile.type === 'video' &&
            (mediaFile.config.isVideoTransformEditMode ||
              mediaFile.config.isVideoTrimEditMode)) ||
          (mediaFile.type === 'image' &&
            mediaFile.config.isImageTransformEditMode),
      )
      if (
        isEditing ||
        state.showMediaInfo ||
        state.selectedMediaIndexForCustomization < 0
      ) {
        return
      }
      e.preventDefault()
      if (state.isProcessCompleted) {
        appProxy.state.selectedMediaIndexForCustomization = -1
      } else {
        handleApplyVideoConfig()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [handleApplyVideoConfig])

  return (
    <div
      data-tint-overlay=""
      // The same spacing as the media section, so the preview's header is where it is for a single
      // media
      className="absolute top-0 right-0 bottom-0 left-0 w-full h-full z-[10] flex flex-col justify-center px-4 py-6 bg-white1 dark:bg-black1"
    >
      <motion.div
        className="w-full h-full flex flex-col justify-center items-center"
        {...zoomInTransition}
      >
        <PreviewSingleVideo
          mediaIndex={selectedMediaIndexForCustomization}
          headerEnd={
            // The full media info covers the media with its own close button in this corner
            !showMediaInfo ? (
              isProcessCompleted ? (
                <Button
                  size="sm"
                  onPress={() => {
                    appProxy.state.selectedMediaIndexForCustomization = -1
                  }}
                  variant="flat"
                  radius="md"
                  className="h-7"
                >
                  Close
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    onPress={handleResetMediaConfig}
                    color="danger"
                    variant="flat"
                    radius="md"
                    className="h-7"
                  >
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    variant="flat"
                    radius="md"
                    onPress={handleApplyVideoConfig}
                    className="h-7"
                  >
                    Apply
                  </Button>
                </>
              )
            ) : null
          }
        />
      </motion.div>
    </div>
  )
}

export default memo(CustomizeMediaOnBatchActions)
