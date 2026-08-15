import { event } from '@tauri-apps/api'
import { AnimatePresence, motion } from 'framer-motion'
import React, { useEffect } from 'react'
import ReactDOM from 'react-dom'

import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import { readFilesFromPaths } from '@/tauri/commands/fs'
import { zoomInTransition } from '@/utils/animation'

type DragAndDropFilesProps = {
  disable?: boolean
  onFile?: (filePath: string | string[]) => void
  multiple?: boolean
}

function DragAndDropFiles({
  disable = false,
  onFile,
  multiple = false,
}: DragAndDropFilesProps) {
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

  useEffect(() => {
    ;(async function iife() {
      cancelDragAndDropEvents()

      if (!disable) {
        dragAndDropListenerRef.current.drop = await event.listen<{
          paths: string[]
        }>(event.TauriEvent.DRAG_DROP, async (evt) => {
          setDragAndDropState('dropped')
          if (!dragAndDropListenerIsDroppedRef.current) {
            dragAndDropListenerIsDroppedRef.current = true
            setTimeout(() => {
              dragAndDropListenerIsDroppedRef.current = false
            }, 1000)
            toast.dismiss()
            const pathsPayload = evt?.payload?.paths
            const paths = multiple ? pathsPayload : pathsPayload.slice(0, 1)
            const files = await readFilesFromPaths(paths)
            if (Array.isArray(files)) {
              onFile?.(files)
            } else {
              toast.error('文件或文件夹无效。')
            }
          }
        })
        dragAndDropListenerRef.current.drag = await event.listen(
          event.TauriEvent.DRAG_ENTER,
          () => {
            setDragAndDropState('dragging')
          },
        )
        dragAndDropListenerRef.current.dragCancelled = await event.listen(
          event.TauriEvent.DRAG_LEAVE,
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
  }, [onFile, disable, cancelDragAndDropEvents, multiple])

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
                <p className="my-2 text-gray-600 dark:text-gray-400 text-sm">
                  将文件放到此处……
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

export default React.memo(DragAndDropFiles)
