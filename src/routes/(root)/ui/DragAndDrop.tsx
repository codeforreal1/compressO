import { event } from '@tauri-apps/api'
import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import ReactDOM from 'react-dom'

import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import { extensions } from '@/types/compression'
import { zoomInTransition } from '@/utils/animation'

const videoExtensions = Object.keys(extensions?.video)

type DragAndDropProps = {
  disable?: boolean
  onFile?: (filePath: string) => void
}

function DragAndDrop({ disable = false, onFile }: DragAndDropProps) {
  const [dragAndDropState, setDragAndDropState] = React.useState<
    'idle' | 'dragging' | 'dropped'
  >('idle')

  const dragAndDropListenerIsDroppedRef = React.useRef<boolean>(false)
  const dragAndDropListenerRef = React.useRef<{
    drag: event.UnlistenFn | undefined
    dragCancelled: event.UnlistenFn | undefined
    drop: event.UnlistenFn | undefined
  }>({
    drag: undefined,
    dragCancelled: undefined,
    drop: undefined,
  })
  const dragAndDropContainerRef = React.useRef<HTMLDivElement>(null)

  const cancelDragAndDropEvents = React.useCallback(() => {
    dragAndDropListenerRef.current?.drag?.()
    dragAndDropListenerRef.current?.dragCancelled?.()
    dragAndDropListenerRef.current?.drop?.()
  }, [])

  React.useEffect(() => {
    ;(async function iife() {
      cancelDragAndDropEvents()

      if (!disable) {
        dragAndDropListenerRef.current.drop = await event.listen<{
          paths: string[]
        }>('tauri://drop', (evt) => {
          setDragAndDropState('dropped')
          if (!dragAndDropListenerIsDroppedRef.current) {
            dragAndDropListenerIsDroppedRef.current = true
            setTimeout(() => {
              dragAndDropListenerIsDroppedRef.current = false
            }, 1000)
            toast.dismiss()
            const paths = evt?.payload?.paths
            if (paths.length > 0) {
              const filePath = paths?.[0]
              const filePathSplitted = filePath?.split('.')
              if (filePathSplitted.length) {
                const fileExtension =
                  filePathSplitted?.[filePathSplitted.length - 1]
                if (!videoExtensions?.includes(fileExtension)) {
                  toast.error('Invalid video file.')
                } else {
                  onFile?.(filePath)
                }
              }
            }
          }
        })
        dragAndDropListenerRef.current.drag = await event.listen(
          'tauri://drag',
          () => {
            setDragAndDropState('dragging')
          },
        )
        dragAndDropListenerRef.current.dragCancelled = await event.listen(
          'tauri://drag-cancelled',
          () => {
            setDragAndDropState('idle')
          },
        )
      } else {
        cancelDragAndDropEvents()
      }
    })()

    return () => {
      cancelDragAndDropEvents()
    }
  }, [onFile, disable, cancelDragAndDropEvents])

  return (
    <>
      {ReactDOM.createPortal(
        <AnimatePresence mode="wait">
          {dragAndDropState === 'dragging' ? (
            <div
              ref={dragAndDropContainerRef}
              className="fixed top-0 right-0 bottom-0 left-0 w-screen h-screen bg-zinc-200 dark:bg-zinc-900 flex justify-center items-center flex-col z-[2]"
            >
              <motion.div
                className="flex justify-center items-center flex-col py-16 px-20 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-3xl"
                {...zoomInTransition}
              >
                <Icon name="dragAndDrop" className="text-primary" size={50} />
                <p className="my-2 text-gray-600 dark:text-gray-400 italic text-sm">
                  Drop anywhere...
                </p>
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>,
        document.getElementById('portal') as HTMLDivElement,
      )}
    </>
  )
}

export default React.memo(DragAndDrop)
