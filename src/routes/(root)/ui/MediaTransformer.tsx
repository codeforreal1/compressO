import { core } from '@tauri-apps/api'
import { useEffect, useRef } from 'react'
import { Cropper, CropperRef, type CropperState } from 'react-advanced-cropper'
import 'react-advanced-cropper/dist/style.css'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { MediaTransformHistory, MediaTransforms } from '@/types/compression'
import { appProxy } from '../-state'

type MediaTransformerProps = {
  mediaIndex: number
}

function MediaTransformer({ mediaIndex }: MediaTransformerProps) {
  if (mediaIndex < 0) return null

  const {
    state: { media },
  } = useSnapshot(appProxy)

  const mediaItem = media[mediaIndex]

  const handleTransformChange = (
    transforms: MediaTransforms,
    previewUrl: string,
  ) => {
    const targetMedia = appProxy.state.media[mediaIndex]
    if (!targetMedia?.config) return

    if (targetMedia.type === 'video') {
      const transformConfig = targetMedia.config.transformVideoConfig
      targetMedia.config.transformVideoConfig = {
        ...transformConfig,
        transforms: transforms as MediaTransforms,
        previewUrl,
        transformHistory:
          transformConfig?.transformHistory ?? ([] as MediaTransformHistory[]),
      }
    } else if (mediaItem.type === 'image') {
      const transformConfig = targetMedia.config.transformImageConfig
      targetMedia.config.transformImageConfig = {
        ...transformConfig,
        transforms: transforms as MediaTransforms,
        previewUrl,
        transformHistory:
          transformConfig?.transformHistory ?? ([] as MediaTransformHistory[]),
      }
    }
  }

  const handleTransformHistoryChange = (action: MediaTransformHistory) => {
    const targetMedia = appProxy.state.media[mediaIndex]
    if (!targetMedia?.config) return

    if (targetMedia.type === 'video') {
      const transformConfig = targetMedia.config.transformVideoConfig
      const transformHistory = transformConfig?.transformHistory ?? []

      transformHistory.push(action)

      targetMedia.config.transformVideoConfig = {
        ...(transformConfig! ?? {}),
        transformHistory,
      }
    } else if (mediaItem.type === 'image') {
      const transformConfig = targetMedia.config.transformImageConfig
      const transformHistory = transformConfig?.transformHistory ?? []

      transformHistory.push(action)

      targetMedia.config.transformImageConfig = {
        ...(transformConfig! ?? {}),
        transformHistory,
      }
    }
  }

  const src = core.convertFileSrc(mediaItem.thumbnailPathRaw!)

  const initialTransforms =
    mediaItem.type === 'video'
      ? mediaItem.config.transformVideoConfig?.transforms
      : mediaItem.config.transformImageConfig?.transforms

  const shouldTransform =
    mediaItem.type === 'video'
      ? mediaItem.config.shouldTransformVideo
      : mediaItem.config.shouldTransformImage

  useEffect(() => {
    if (shouldTransform && mediaItem.config) {
      // Trigger cropper refresh if needed
      const targetMedia = appProxy.state.media[mediaIndex]
      if (targetMedia) {
        // Force re-render by updating a timestamp or similar if needed
      }
    }
  }, [shouldTransform, mediaIndex, mediaItem.config])

  if (!src) return null

  return (
    <Transformer
      src={src}
      initialTransforms={initialTransforms}
      onTransformChange={handleTransformChange}
      onTransformHistoryChange={handleTransformHistoryChange}
    />
  )
}

type TransformerProps = {
  src: string
  initialTransforms?: MediaTransforms
  onTransformChange: (transforms: MediaTransforms, previewUrl: string) => void
  onTransformHistoryChange: (action: MediaTransformHistory) => void
}

function Transformer({
  src,
  initialTransforms,
  onTransformChange,
  onTransformHistoryChange,
}: TransformerProps) {
  const cropperRef = useRef<CropperRef>(null)
  const debouncedRef = useRef<NodeJS.Timeout | null>(null)

  const flip = (horizontal: boolean, vertical: boolean) => {
    if (cropperRef.current) {
      cropperRef.current.flipImage(horizontal, vertical)
      onTransformHistoryChange({
        type: 'flip',
        value: { horizontal, vertical },
      })
    }
  }

  const resetZoom = () => {
    if (cropperRef.current) {
      cropperRef.current.zoomImage({
        factor: 0,
        center: { left: 0, top: 0 },
      })
      // This is related to crop so it's history will be recorded on `onChange` handler
    }
  }

  const rotate = (angle: number) => {
    if (cropperRef.current) {
      cropperRef.current.rotateImage(angle)
      onTransformHistoryChange({
        type: 'rotate',
        value: angle,
      })
      resetZoom()
    }
  }

  const expandCropArea = () => {
    if (cropperRef.current) {
      const visibleArea = cropperRef.current.getState()?.visibleArea
      if (visibleArea) {
        cropperRef.current.setCoordinates({
          top: 0,
          left: 0,
          width: visibleArea.width,
          height: visibleArea.height,
        })
        // This is related to crop so it's history will be recorded on `onChange` handler
      }
    }
  }

  const onChange = (cropper: CropperRef) => {
    if (debouncedRef.current) {
      clearTimeout(debouncedRef.current)
    }
    debouncedRef.current = setTimeout(async () => {
      const cropperState = cropper.getState()
      if (cropperState) {
        const canvas = cropper.getCanvas()!
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png'),
        )
        const coordinates = cropperState.coordinates
        const transforms = cropperState.transforms

        const newTransforms: MediaTransforms = {
          crop: {
            top: coordinates?.top!,
            left: coordinates?.left!,
            width: coordinates?.width!,
            height: coordinates?.height!,
          },
          rotate: transforms.rotate,
          flip: {
            horizontal: transforms.flip.horizontal,
            vertical: transforms.flip.vertical,
          },
        }

        // Check if crop changed and record history
        const prevCrop = initialTransforms?.crop
        if (
          !prevCrop ||
          JSON.stringify(prevCrop) !== JSON.stringify(newTransforms.crop)
        ) {
          onTransformHistoryChange({
            type: 'crop',
            value: newTransforms.crop,
          })
        }

        onTransformChange(newTransforms, URL.createObjectURL(blob!))
      }
    }, 500)
  }

  return (
    <>
      <Cropper
        ref={cropperRef}
        src={src}
        stencilProps={{
          grid: true,
        }}
        onChange={onChange}
        className="w-full h-full"
        boundaryClassName="max-w-full max-h-full w-full h-full object-contain"
        defaultCoordinates={(state: CropperState) => {
          const crop = initialTransforms?.crop
          return {
            left: crop?.left ?? 0,
            top: crop?.top ?? 0,
            width: crop?.width ?? state.imageSize.width,
            height: crop?.height ?? state.imageSize.height,
          }
        }}
        defaultPosition={() => {
          const crop = initialTransforms?.crop
          return {
            left: crop?.left ?? 0,
            top: crop?.top ?? 0,
          }
        }}
        defaultSize={(state: CropperState) => {
          const crop = initialTransforms?.crop
          return {
            width: crop?.width ?? state.imageSize.width,
            height: crop?.height ?? state.imageSize.height,
          }
        }}
        defaultTransforms={() => {
          const transforms = initialTransforms
          return {
            rotate: transforms?.rotate ?? 0,
            flip: {
              horizontal: transforms?.flip?.horizontal ?? false,
              vertical: transforms?.flip?.vertical ?? false,
            },
          }
        }}
      />
      <div className="mx-auto flex items-center justify-center gap-2 mt-4">
        <>
          <Button size="sm" isIconOnly onPress={() => rotate(-90)}>
            <Tooltip content="向左旋转" aria-label="向左旋转">
              <Icon name="rotateLeft" size={20} />
            </Tooltip>
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={() => flip(false, true)}>
            <Tooltip content="垂直翻转" aria-label="垂直翻转">
              <Icon name="flipVertical" size={20} />
            </Tooltip>
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={() => flip(true, false)}>
            <Tooltip content="水平翻转" aria-label="水平翻转">
              <Icon name="flipHorizontal" size={20} />
            </Tooltip>
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={resetZoom}>
            <Tooltip content="重置缩放" aria-label="重置缩放">
              <Icon name="zoom" size={20} />
            </Tooltip>
            <Divider className="my-3 h-5" orientation="vertical" />
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={expandCropArea}>
            <Tooltip content="扩大裁剪区域" aria-label="扩大裁剪区域">
              <Icon name="expand" size={20} />
            </Tooltip>
          </Button>
        </>
      </div>
    </>
  )
}

export default MediaTransformer
