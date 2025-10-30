import React, { useRef } from 'react'
import { Cropper, CropperRef } from 'react-advanced-cropper'
import 'react-advanced-cropper/dist/style.css'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { videoProxy } from '../-state'

function VideoTransformer() {
  const {
    state: { thumbnailPath },
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
    debouncedRef.current = setTimeout(() => {
      const coords = cropper.getCoordinates()
      if (coords) {
        videoProxy.state.config.transformVideoCoordinates = {
          top: coords?.top!,
          left: coords?.left!,
          width: coords?.width!,
          height: coords?.height!,
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
        boundaryClassName="w-full max-w-[50vw] xxl:max-w-[60vw] max-h-[60vh] object-contain"
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

export default VideoTransformer
