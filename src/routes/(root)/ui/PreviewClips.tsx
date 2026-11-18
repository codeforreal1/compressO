import { ScrollShadow } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Card from '@/components/Card'
import Code from '@/components/Code'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Image from '@/components/Image'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import {
  copyFilesToClipboard,
  showItemInFileManager,
} from '@/tauri/commands/fs'
import type { VideoClipOutput } from '@/types/app'
import { zoomInStaggerAnimation } from '@/utils/animation'
import { formatDuration } from '@/utils/string'
import ExitMedia from './ExitMedia'
import OutputSizeSummary from './OutputSizeSummary'
import { getClipClipboardFile } from '../-save'
import { appProxy } from '../-state'

type PreviewClipsProps = {
  mediaIndex: number
}

/** The clips of a single video, shown as the cards of a batch */
function PreviewClips({ mediaIndex }: PreviewClipsProps) {
  const { t } = useTranslation()
  const {
    state: { media },
  } = useSnapshot(appProxy)
  const mediaFile = media[mediaIndex]
  const clips =
    mediaFile?.type === 'video' ? (mediaFile.compressedFile?.clips ?? []) : []

  const handleCopy = useCallback(
    async (clip: VideoClipOutput) => {
      if (!mediaFile) return
      const file = getClipClipboardFile(mediaFile, clip)
      if (!file) return
      try {
        await copyFilesToClipboard([file])
        toast.success(t('common.copied'))
      } catch {}
    },
    [mediaFile, t],
  )

  const handleOpenInFileManager = useCallback(async (clip: VideoClipOutput) => {
    if (!clip.savedPath) return
    try {
      await showItemInFileManager(clip.savedPath)
    } catch {}
  }, [])

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 pb-4">
        <div className="flex min-w-0 items-center gap-1">
          <ExitMedia />
          <Code size="sm" className="w-fit rounded-xl px-4 text-xs truncate">
            {mediaFile?.fileName ?? ''}
          </Code>
        </div>
      </div>

      <ScrollShadow
        className="h-[65vh] hlg:h-[70vh] shrink-0 overflow-hidden overflow-y-auto"
        hideScrollBar
      >
        <AnimatePresence mode="wait">
          <motion.div
            variants={zoomInStaggerAnimation.container}
            initial="hidden"
            animate="show"
            exit="hidden"
            className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 gap-4 pb-4"
          >
            {clips.map((clip) => (
              <motion.div
                key={`${clip.index}-${clip.pathRaw}`}
                layout
                variants={zoomInStaggerAnimation.item}
                className="relative overflow-hidden rounded-xl border-1 border-zinc-200 dark:border-zinc-900"
              >
                <Card
                  className="bg-zinc-100/5 dark:bg-zinc-900 rounded-none overflow-hidden"
                  radius="lg"
                >
                  <div className="relative w-full overflow-hidden">
                    {mediaFile?.thumbnailPath ? (
                      <>
                        <Image
                          src={mediaFile.thumbnailPath}
                          alt={clip.fileNameToDisplay ?? clip.fileName}
                          className="w-full max-w-[unset] h-[180px] hlg:h-[220px] object-cover drop-shadow-xl rounded-xl"
                          removeWrapper
                        />
                        <Icon
                          name="video"
                          size={40}
                          className="text-zinc-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10]"
                        />
                      </>
                    ) : (
                      <div className="w-full aspect-video bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                        <Icon
                          name="video"
                          size={40}
                          className="text-zinc-400"
                        />
                      </div>
                    )}
                    <div className="absolute top-2 left-2 z-10 flex gap-2 items-center">
                      <Tooltip
                        content={t('batch.copyOutput')}
                        aria-label={t('batch.copyOutput')}
                      >
                        <Button
                          size="sm"
                          isIconOnly
                          onPress={() => handleCopy(clip)}
                          className="rounded-full text-white"
                        >
                          <Icon
                            name="copy"
                            size={28}
                            className="text-primary"
                          />
                        </Button>
                      </Tooltip>
                      {clip.savedPath ? (
                        <Tooltip
                          content={t('common.showInFileManager')}
                          aria-label={t('common.showInFileManager')}
                        >
                          <Button
                            size="sm"
                            isIconOnly
                            onPress={() => handleOpenInFileManager(clip)}
                            className="p-2 rounded-full text-white"
                          >
                            <Icon
                              name="fileExplorer"
                              size={20}
                              className="text-primary"
                            />
                          </Button>
                        </Tooltip>
                      ) : null}
                    </div>
                  </div>
                  <section className="px-3 py-2 mt-1">
                    <p className="font-medium text-sm truncate">
                      {t('clips.clipName', { number: clip.index })}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {clip.fileNameToDisplay ?? clip.fileName}
                    </p>
                    <Divider className="mt-2" />
                    <section className="flex min-h-[48px] items-center justify-between gap-2 text-[12px]">
                      <p className="text-[16px] font-bold">{clip.size}</p>
                      <p className="text-gray-500 dark:text-gray-400">
                        {formatDuration(clip.startSeconds, {
                          disableMilliseconds: true,
                        })}{' '}
                        –{' '}
                        {formatDuration(clip.endSeconds, {
                          disableMilliseconds: true,
                        })}
                      </p>
                    </section>
                  </section>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      </ScrollShadow>
      <section className="shrink-0 pt-4">
        <OutputSizeSummary mediaIndex={mediaIndex} />
        <p className="mt-1 text-center text-xs text-gray-600 dark:text-gray-400">
          {t('clips.count', { count: clips.length })}
        </p>
      </section>
    </div>
  )
}

export default PreviewClips
