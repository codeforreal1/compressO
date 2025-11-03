import { useRef } from 'react'
import { Cropper, CropperRef, type CropperState } from 'react-advanced-cropper'
import 'react-advanced-cropper/dist/style.css'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { videoProxy } from '../-state'

function VideoTransformer() {
  const {
    state: {
      thumbnailPath,
      config: { shouldTransformVideo },
    },
  } = useSnapshot(videoProxy)

  const cropperRef = useRef<CropperRef>(null)
  const debouncedRef = useRef<NodeJS.Timeout | null>(null)

  const flip = (horizontal: boolean, vertical: boolean) => {
    if (cropperRef.current) {
      cropperRef.current.flipImage(horizontal, vertical)
    }
  }

  const resetZoom = () => {
    if (cropperRef.current) {
      cropperRef.current.zoomImage({
        factor: 0,
        center: { left: 0, top: 0 },
      })
    }
  }

  const rotate = (angle: number) => {
    if (cropperRef.current) {
      cropperRef.current.rotateImage(angle)
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
        const blob = await getCanvasBlob(cropper.getCanvas()!)
        if (videoProxy.state.config.transformVideoConfig?.previewUrl) {
          URL.revokeObjectURL(
            videoProxy.state.config.transformVideoConfig.previewUrl,
          )
        }
        const coordinates = cropperState.coordinates
        const transforms = cropperState.transforms
        videoProxy.state.config.transformVideoConfig = {
          transforms: {
            coordinates: {
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
          },
          previewUrl: URL.createObjectURL(blob!),
        }
      }
    }, 500)
  }

  return (
    <>
      <Cropper
        ref={cropperRef}
        src={thumbnailPath}
        stencilProps={{
          grid: true,
        }}
        onChange={onChange}
        className="w-full"
        boundaryClassName="max-w-[65vw] xxl:max-w-[80vw] max-h-[60vh] object-contain"
        {...(shouldTransformVideo
          ? {
              defaultCoordinates(state: CropperState) {
                const coordinates =
                  videoProxy.state.config.transformVideoConfig?.transforms
                    ?.coordinates
                return {
                  left: coordinates?.left ?? 0,
                  top: coordinates?.top ?? 0,
                  width: coordinates?.width ?? state.imageSize.width,
                  height: coordinates?.height ?? state.imageSize.height,
                }
              },
              defaultPosition() {
                const coordinates =
                  videoProxy.state.config.transformVideoConfig?.transforms
                    ?.coordinates
                return {
                  left: coordinates?.left ?? 0,
                  top: coordinates?.top ?? 0,
                }
              },
              defaultSize(state: CropperState) {
                const coordinates =
                  videoProxy.state.config.transformVideoConfig?.transforms
                    ?.coordinates
                return {
                  width: coordinates?.width ?? state.imageSize.width,
                  height: coordinates?.height ?? state.imageSize.height,
                }
              },
              defaultTransforms() {
                const transforms =
                  videoProxy.state.config.transformVideoConfig?.transforms
                return {
                  rotate: transforms?.rotate ?? 0,
                  flip: {
                    horizontal: transforms?.flip?.horizontal ?? false,
                    vertical: transforms?.flip?.vertical ?? false,
                  },
                }
              },
            }
          : {})}
      />
      <div className="mx-auto flex items-center justify-center gap-2 mt-4">
        <>
          <Button isIconOnly onPress={() => rotate(-90)}>
            <Tooltip content="Rotate Left" aria-label="Rotate Left">
              <Icon name="rotateLeft" size={25} />
            </Tooltip>
          </Button>
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button isIconOnly onPress={() => flip(false, true)}>
            <Tooltip content="Flip Vertical" aria-label="Flip Vertical">
              <Icon name="flipVertical" size={25} />
            </Tooltip>
          </Button>{' '}
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button isIconOnly onPress={() => flip(true, false)}>
            <Tooltip content="Flip Horizontal" aria-label="Flip Horizontal">
              <Icon name="flipHorizontal" size={25} />
            </Tooltip>
          </Button>{' '}
          <Divider className="my-3 h-5" orientation="vertical" />
        </>{' '}
        <>
          <Button isIconOnly onPress={resetZoom}>
            <Tooltip content="Reset Zoom" aria-label="Reset Zoom">
              <Icon name="resetZoom" size={25} />
            </Tooltip>
            <Divider className="my-3 h-5" orientation="vertical" />
          </Button>{' '}
          <Divider className="my-3 h-5" orientation="vertical" />
        </>
        <>
          <Button isIconOnly onPress={expandCropArea}>
            <Tooltip content="Expand" aria-label="Expand">
              <Icon name="expand" size={25} />
            </Tooltip>
          </Button>
        </>
      </div>
    </>
  )
}

async function getCanvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

export default VideoTransformer
