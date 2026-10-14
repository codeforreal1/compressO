import { core } from '@tauri-apps/api'
import {
  type CSSProperties,
  forwardRef,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  Cropper,
  type CropperBackgroundImageProps,
  CropperRef,
  type CropperState,
  getBackgroundStyle,
} from 'react-advanced-cropper'
import 'react-advanced-cropper/dist/style.css'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import {
  type CropAspectRatio,
  cropAspectRatios,
  MediaTransformHistory,
  MediaTransforms,
} from '@/types/compression'
import { getAspectRatioCrop } from '@/utils/transform'
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
    aspectRatio: CropAspectRatio | null,
  ) => {
    const targetMedia = appProxy.state.media[mediaIndex]
    if (!targetMedia?.config) return

    let previousPreviewUrl: string | undefined
    if (targetMedia.type === 'video') {
      const transformConfig = targetMedia.config.transformVideoConfig
      previousPreviewUrl = transformConfig?.previewUrl
      targetMedia.config.transformVideoConfig = {
        ...transformConfig,
        transforms: transforms as MediaTransforms,
        previewUrl,
        aspectRatio,
        transformHistory:
          transformConfig?.transformHistory ?? ([] as MediaTransformHistory[]),
      }
    } else if (mediaItem.type === 'image') {
      const transformConfig = targetMedia.config.transformImageConfig
      previousPreviewUrl = transformConfig?.previewUrl
      targetMedia.config.transformImageConfig = {
        ...transformConfig,
        transforms: transforms as MediaTransforms,
        previewUrl,
        aspectRatio,
        transformHistory:
          transformConfig?.transformHistory ?? ([] as MediaTransformHistory[]),
      }
    }

    // Each preview is a full-size blob, so release the old one once nothing points to it
    if (previousPreviewUrl && previousPreviewUrl !== previewUrl) {
      if (targetMedia.thumbnailPath === previousPreviewUrl) {
        targetMedia.thumbnailPath = previewUrl
      }
      URL.revokeObjectURL(previousPreviewUrl)
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
        // Changed in the editor, so it is the media's own transform
        isFromPreset: false,
      }
    } else if (mediaItem.type === 'image') {
      const transformConfig = targetMedia.config.transformImageConfig
      const transformHistory = transformConfig?.transformHistory ?? []

      transformHistory.push(action)

      targetMedia.config.transformImageConfig = {
        ...(transformConfig! ?? {}),
        transformHistory,
        isFromPreset: false,
      }
    }
  }

  const src = core.convertFileSrc(mediaItem.thumbnailPathRaw!)

  const initialTransforms =
    mediaItem.type === 'video'
      ? mediaItem.config.transformVideoConfig?.transforms
      : mediaItem.config.transformImageConfig?.transforms
  const initialAspectRatio =
    (mediaItem.type === 'video'
      ? mediaItem.config.transformVideoConfig?.aspectRatio
      : mediaItem.config.transformImageConfig?.aspectRatio) ?? null

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
      initialAspectRatio={initialAspectRatio}
      onTransformChange={handleTransformChange}
      onTransformHistoryChange={handleTransformHistoryChange}
    />
  )
}

/**
 * The default cropper background lays the image out at ≤512px and scales it up with `translate3d`,
 * which makes WebKit rasterize it as a 512px GPU layer and stretch it (very blurry for large video
 * frames). A 2D translate keeps it on the normal paint path, drawn from the full resolution image.
 */
const SharpCropperBackground = forwardRef<
  HTMLImageElement,
  CropperBackgroundImageProps
>(({ cropper, className, style }, ref) => {
  const state = cropper.getState()
  const image = cropper.getImage()
  if (!image || !state) return null

  const backgroundStyle = getBackgroundStyle(
    image,
    state,
    cropper.getTransitions(),
  ) as CSSProperties

  return (
    <img
      key={image.src}
      ref={ref}
      alt=""
      className={`advanced-cropper-background-image ${className ?? ''}`}
      src={image.src}
      crossOrigin="anonymous"
      style={{
        ...backgroundStyle,
        transform: backgroundStyle.transform?.replace(
          /translate3d\(([^,]+),([^,]+),[^)]+\)/,
          'translate($1,$2)',
        ),
        ...style,
      }}
      onMouseDown={(e) => e.preventDefault()}
    />
  )
})
SharpCropperBackground.displayName = 'SharpCropperBackground'

const ASPECT_RATIO_OPTIONS: (CropAspectRatio | null)[] = [
  null,
  ...(Object.keys(cropAspectRatios) as CropAspectRatio[]),
]

type TransformerProps = {
  src: string
  initialTransforms?: MediaTransforms
  /** Shape the crop is locked to (`null` for a free crop) */
  initialAspectRatio: CropAspectRatio | null
  onTransformChange: (
    transforms: MediaTransforms,
    previewUrl: string,
    aspectRatio: CropAspectRatio | null,
  ) => void
  onTransformHistoryChange: (action: MediaTransformHistory) => void
}

function Transformer({
  src,
  initialTransforms,
  initialAspectRatio,
  onTransformChange,
  onTransformHistoryChange,
}: TransformerProps) {
  const cropperRef = useRef<CropperRef>(null)
  const debouncedRef = useRef<NodeJS.Timeout | null>(null)
  const [aspectRatio, setAspectRatio] = useState(initialAspectRatio)
  // Read by the debounced change handler
  const aspectRatioRef = useRef(aspectRatio)
  aspectRatioRef.current = aspectRatio

  // Counts the picks of a shape; the crop is moved once the cropper has the new shape (otherwise it
  // is fitted to the previous shape, and ends up elsewhere). Picking the current shape again centers
  // it again.
  const [aspectRatioPicks, setAspectRatioPicks] = useState(0)

  /** Locks the crop to a shape: the largest centered area of it in the (rotated) media */
  const changeAspectRatio = (ratio: CropAspectRatio | null) => {
    aspectRatioRef.current = ratio
    setAspectRatio(ratio)
    setAspectRatioPicks((picks) => picks + 1)
  }

  // Runs after the cropper received the new shape, a frame later so it has applied it
  useEffect(() => {
    // The free crop keeps the current area
    if (!aspectRatioPicks || !aspectRatio) return
    const frame = requestAnimationFrame(() => {
      const cropper = cropperRef.current
      const state = cropper?.getState()
      if (!cropper || !state?.imageSize) return
      const isQuarterTurned = Math.abs(state.transforms.rotate % 180) === 90
      cropper.setCoordinates(
        getAspectRatioCrop(
          isQuarterTurned
            ? {
                width: state.imageSize.height,
                height: state.imageSize.width,
              }
            : state.imageSize,
          aspectRatio,
        ),
        // Animated from the area the cropper fitted to the new shape
        { transitions: true },
      )
    })
    return () => cancelAnimationFrame(frame)
  }, [aspectRatio, aspectRatioPicks])

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

        onTransformChange(
          newTransforms,
          URL.createObjectURL(blob!),
          aspectRatioRef.current,
        )
      }
    }, 500)
  }

  return (
    <>
      <Cropper
        ref={cropperRef}
        src={src}
        backgroundComponent={SharpCropperBackground}
        // Photos stored sideways with an EXIF orientation are already shown upright by the webview.
        // The cropper's own handling would show the raw (sideways) pixels, rotated by its default
        // rotation, which `defaultTransforms` replaces with the user's. The crop & rotations are for
        // the image as it is displayed, like the backend makes it upright before transforming it.
        checkOrientation={false}
        stencilProps={{
          grid: true,
          aspectRatio: aspectRatio
            ? cropAspectRatios[aspectRatio][0] /
              cropAspectRatios[aspectRatio][1]
            : undefined,
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
      <div className="mx-auto flex flex-wrap items-center justify-center gap-2 mt-4">
        {ASPECT_RATIO_OPTIONS.map((ratio) => (
          <Button
            key={ratio ?? 'free'}
            size="sm"
            radius="md"
            color={aspectRatio === ratio ? 'primary' : 'default'}
            variant={aspectRatio === ratio ? 'solid' : 'flat'}
            aria-pressed={aspectRatio === ratio}
            onPress={() => changeAspectRatio(ratio)}
            className="min-w-[unset] h-7 px-3 text-xs"
          >
            {ratio ?? 'Free'}
          </Button>
        ))}
      </div>
      <div className="mx-auto flex items-center justify-center gap-2 mt-2">
        <>
          <Button size="sm" isIconOnly onPress={() => rotate(-90)}>
            <Tooltip content="Rotate Left" aria-label="Rotate Left">
              <Icon name="rotateLeft" size={20} />
            </Tooltip>
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={() => flip(false, true)}>
            <Tooltip content="Flip Vertical" aria-label="Flip Vertical">
              <Icon name="flipVertical" size={20} />
            </Tooltip>
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={() => flip(true, false)}>
            <Tooltip content="Flip Horizontal" aria-label="Flip Horizontal">
              <Icon name="flipHorizontal" size={20} />
            </Tooltip>
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={resetZoom}>
            <Tooltip content="Reset Zoom" aria-label="Reset Zoom">
              <Icon name="zoom" size={20} />
            </Tooltip>
            <Divider className="my-3 h-5" orientation="vertical" />
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={expandCropArea}>
            <Tooltip content="Expand" aria-label="Expand">
              <Icon name="expand" size={20} />
            </Tooltip>
          </Button>
        </>
      </div>
    </>
  )
}

export default MediaTransformer
