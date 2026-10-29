import { core } from '@tauri-apps/api'
import { moveToImage } from 'advanced-cropper/extensions/fit-to-image'
import {
  fitStencilToImage,
  resizeCoordinates,
  transformImage,
} from 'advanced-cropper/showcase/mobile'
import {
  type MoveAlgorithm,
  moveCoordinates,
  type ResizeAlgorithm,
} from 'advanced-cropper/state'
import {
  type CSSProperties,
  forwardRef,
  useEffect,
  useLayoutEffect,
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
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Slider from '@/components/Slider'
import Tooltip from '@/components/Tooltip'
import {
  type CropAspectRatio,
  cropAspectRatios,
  MAX_STRAIGHTEN_ANGLE,
  MediaTransformHistory,
  MediaTransforms,
} from '@/types/compression'
import {
  getAspectRatioCrop,
  getRotatedSize,
  getStraightenedCrop,
  normalizeRotation,
} from '@/utils/transform'
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

/** Moves the crop like the cropper does, then back inside the (tilted) media */
const moveCoordinatesInsideImage: MoveAlgorithm = (
  state,
  settings,
  directions,
) => {
  const result = moveCoordinates(state, settings, directions)
  if (!result.coordinates || !result.imageSize) return result
  return {
    ...result,
    coordinates: moveToImage(result.coordinates, {
      ...result.imageSize,
      angle: result.transforms.rotate,
    }),
  }
}

/** Resizes the crop inside the (tilted) media; the cropper gives all four directions, as needed */
const resizeCoordinatesInsideImage = resizeCoordinates as ResizeAlgorithm

/** A tilt in degrees as text, e.g. -3.5° */
const formatDegrees = (degrees: number) => `${Number(degrees.toFixed(1))}°`

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
  const { t } = useTranslation()
  const cropperRef = useRef<CropperRef>(null)
  const debouncedRef = useRef<NodeJS.Timeout | null>(null)
  const [aspectRatio, setAspectRatio] = useState(initialAspectRatio)
  // Read by the debounced change handler
  const aspectRatioRef = useRef(aspectRatio)
  aspectRatioRef.current = aspectRatio
  // A slight tilt on top of the quarter turns; the cropper's rotation is the sum of both
  const [straighten, setStraighten] = useState(
    initialTransforms?.straighten ?? 0,
  )
  const straightenRef = useRef(straighten)

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
      // Centered in the (tilted) media; the cropper then fits it inside the media
      cropper.setCoordinates(
        getAspectRatioCrop(
          getRotatedSize(state.imageSize, state.transforms.rotate),
          aspectRatio,
        ),
        // Animated from the area the cropper fitted to the new shape
        { transitions: true },
      )
    })
    return () => cancelAnimationFrame(frame)
  }, [aspectRatio, aspectRatioPicks])

  /** The quarter turns of the cropper's rotation (without the tilt) */
  const getQuarterRotation = (cropper: CropperRef) =>
    normalizeRotation(
      (cropper.getState()?.transforms.rotate ?? 0) - straightenRef.current,
    )

  /** Tilts the media slightly, by an angle from its upright position */
  const changeStraighten = (angle: number) => {
    const cropper = cropperRef.current
    const change = angle - straightenRef.current
    if (!cropper || !change) return
    straightenRef.current = angle
    setStraighten(angle)
    cropper.rotateImage(change, { transitions: false })
  }

  const flip = (horizontal: boolean, vertical: boolean) => {
    const cropper = cropperRef.current
    if (cropper) {
      const tilt = straightenRef.current
      if (tilt) {
        // Mirrors the whole picture, its tilt too: the tilt turns the other way. The cropper flips in
        // the media's own axes, swapped by a quarter turn.
        const isQuarterTurned = getQuarterRotation(cropper) % 180 === 90
        cropper.flipImage(
          isQuarterTurned ? vertical : horizontal,
          isQuarterTurned ? horizontal : vertical,
          { normalize: false },
        )
        straightenRef.current = -tilt
        setStraighten(-tilt)
        cropper.rotateImage(-2 * tilt, { transitions: false })
      } else {
        cropper.flipImage(horizontal, vertical)
      }
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
      const state = cropperRef.current.getState()
      const tilt = straightenRef.current
      if (tilt && state?.imageSize) {
        // The largest area the tilt leaves covered
        cropperRef.current.setCoordinates(
          getStraightenedCrop(
            getRotatedSize(
              state.imageSize,
              getQuarterRotation(cropperRef.current),
            ),
            tilt,
          ),
        )
        return
      }
      const visibleArea = state?.visibleArea
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

  /** Saves the cropper's current crop, rotation, flips & shape, with its preview */
  const saveChange = async (cropper: CropperRef) => {
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
        // Quarter turns, kept apart from the tilt
        rotate: Math.round(transforms.rotate - straightenRef.current),
        straighten: straightenRef.current,
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

      if ((initialTransforms?.straighten ?? 0) !== newTransforms.straighten) {
        onTransformHistoryChange({
          type: 'straighten',
          value: newTransforms.straighten ?? 0,
        })
      }

      onTransformChange(
        newTransforms,
        URL.createObjectURL(blob!),
        aspectRatioRef.current,
      )
    }
  }
  // Read when the editor closes, with the latest props
  const saveChangeRef = useRef(saveChange)
  const openedAspectRatioRef = useRef(initialAspectRatio)
  saveChangeRef.current = saveChange

  const onChange = (cropper: CropperRef) => {
    if (debouncedRef.current) {
      clearTimeout(debouncedRef.current)
    }
    debouncedRef.current = setTimeout(() => {
      debouncedRef.current = null
      saveChange(cropper)
    }, 500)
  }

  // A change still waiting when the editor closes (e.g. Save pressed right after picking a shape),
  // or a shape picked that did not move the crop, is saved at once, not lost. A layout effect, so
  // the cropper is still there.
  useLayoutEffect(
    () => () => {
      const isPending = !!debouncedRef.current
      if (debouncedRef.current) clearTimeout(debouncedRef.current)
      debouncedRef.current = null
      if (
        cropperRef.current &&
        (isPending || aspectRatioRef.current !== openedAspectRatioRef.current)
      ) {
        saveChangeRef.current(cropperRef.current)
      }
    },
    [],
  )

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
        // Keeps the crop inside the media when it is tilted, so no empty corners are kept
        postProcess={fitStencilToImage}
        transformImageAlgorithm={transformImage}
        resizeCoordinatesAlgorithm={resizeCoordinatesInsideImage}
        moveCoordinatesAlgorithm={moveCoordinatesInsideImage}
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
            rotate: (transforms?.rotate ?? 0) + (transforms?.straighten ?? 0),
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
            {ratio ?? t('transform.free')}
          </Button>
        ))}
      </div>
      <div className="mx-auto flex items-center justify-center gap-2 mt-2">
        <>
          <Button size="sm" isIconOnly onPress={() => rotate(-90)}>
            <Tooltip
              content={t('transform.rotateLeft')}
              aria-label={t('transform.rotateLeft')}
            >
              <Icon name="rotateLeft" size={20} />
            </Tooltip>
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={() => flip(false, true)}>
            <Tooltip
              content={t('transform.flipVertical')}
              aria-label={t('transform.flipVertical')}
            >
              <Icon name="flipVertical" size={20} />
            </Tooltip>
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={() => flip(true, false)}>
            <Tooltip
              content={t('transform.flipHorizontal')}
              aria-label={t('transform.flipHorizontal')}
            >
              <Icon name="flipHorizontal" size={20} />
            </Tooltip>
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={resetZoom}>
            <Tooltip
              content={t('transform.resetZoom')}
              aria-label={t('transform.resetZoom')}
            >
              <Icon name="zoom" size={20} />
            </Tooltip>
            <Divider className="my-3 h-5" orientation="vertical" />
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button size="sm" isIconOnly onPress={expandCropArea}>
            <Tooltip
              content={t('transform.expand')}
              aria-label={t('transform.expand')}
            >
              <Icon name="expand" size={20} />
            </Tooltip>
          </Button>
        </>
      </div>
      <div className="mx-auto mt-2 w-72 max-w-full">
        <Slider
          label={t('transform.straighten')}
          aria-label={t('transform.straighten')}
          minValue={-MAX_STRAIGHTEN_ANGLE}
          maxValue={MAX_STRAIGHTEN_ANGLE}
          step={0.1}
          origin={0}
          resetValue={0}
          value={straighten}
          onChange={(value) => changeStraighten(value as number)}
          getValue={(value) => formatDegrees(value as number)}
        />
      </div>
    </>
  )
}

export default MediaTransformer
