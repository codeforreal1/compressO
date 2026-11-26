import { ScrollShadow } from '@heroui/react'
import { core } from '@tauri-apps/api'
import { AnimatePresence, motion } from 'framer-motion'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
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
import VideoPlayer from '@/components/VideoPlayer'
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
  /** Shown at the end of the header (e.g. the Close button of a batch's media) */
  headerEnd?: ReactNode
  /** A media of a batch is closed with its own button, not the batch's exit */
  showExit?: boolean
}

/** A time as shown, with hundredths only when they are not zero (e.g. `00:05` or `00:05.25`) */
const formatClipTime = (seconds: number) => {
  const text = formatDuration(seconds)
  return text.endsWith('.00') ? text.slice(0, -3) : text
}

/** The clips of a single video, shown as the cards of a batch */
function PreviewClips({
  mediaIndex,
  headerEnd,
  showExit = true,
}: PreviewClipsProps) {
  const { t } = useTranslation()
  const {
    state: { media },
  } = useSnapshot(appProxy)
  const mediaFile = media[mediaIndex]
  const clips =
    mediaFile?.type === 'video' ? (mediaFile.compressedFile?.clips ?? []) : []
  const [previewClip, setPreviewClip] = useState<VideoClipOutput | null>(null)
  const previewClipSrc = previewClip
    ? previewClip.savedPath
      ? core.convertFileSrc(previewClip.savedPath)
      : previewClip.path
    : null

  // The output settings apply to the whole video, not to a clip being previewed
  useEffect(() => {
    appProxy.state.isPreviewingClip = !!previewClip
    return () => {
      appProxy.state.isPreviewingClip = false
    }
  }, [previewClip])

  useEffect(() => {
    if (!previewClip) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setPreviewClip(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [previewClip])

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

  if (previewClip && previewClipSrc) {
    return (
      <div
        className="relative flex h-full w-full flex-col justify-center"
        role="dialog"
        aria-label={t('clips.clipName', { number: previewClip.index })}
      >
        <div className="z-[1] flex w-full items-center justify-between gap-2 pb-4">
          <div className="flex min-w-0 items-center gap-1">
            <Code
              size="sm"
              className="min-w-0 max-w-[25%] rounded-xl px-4 text-xs truncate"
            >
              {previewClip.fileNameToDisplay ?? previewClip.fileName}
            </Code>
            <div className="ml-2 flex shrink-0 items-center gap-2">
              <span className="text-xs font-medium text-primary">
                {t('clips.clipName', { number: previewClip.index })}
              </span>
              <Divider orientation="vertical" className="h-4" />
              <span className="text-sm font-bold">{previewClip.size}</span>
              <Divider orientation="vertical" className="h-4" />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formatClipTime(previewClip.startSeconds)} –{' '}
                {formatClipTime(previewClip.endSeconds)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip
              content={t('batch.copyOutput')}
              aria-label={t('batch.copyOutput')}
            >
              <Button
                size="sm"
                isIconOnly
                variant="flat"
                onPress={() => handleCopy(previewClip)}
              >
                <Icon name="copy" size={24} />
              </Button>
            </Tooltip>
            {previewClip.savedPath ? (
              <Tooltip
                content={t('common.showInFileManager')}
                aria-label={t('common.showInFileManager')}
              >
                <Button
                  size="sm"
                  isIconOnly
                  variant="flat"
                  onPress={() => handleOpenInFileManager(previewClip)}
                >
                  <Icon name="fileExplorer" size={18} />
                </Button>
              </Tooltip>
            ) : null}
            <Button
              size="sm"
              variant="flat"
              radius="md"
              className="h-7"
              onPress={() => setPreviewClip(null)}
            >
              {t('common.close')}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center">
          <VideoPlayer
            url={previewClipSrc}
            controls={false}
            playPauseOnSpaceKeydown={false}
            disableClosedCaptions
            containerClassName="w-full h-full"
            style={{ width: '100%', height: '100%' }}
            config={{
              file: {
                attributes: {
                  // ReactPlayer replaces the video's default style with these attributes, so
                  // the size must be repeated alongside the fit.
                  style: {
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  },
                },
              },
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 w-full min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <div className="flex w-full min-w-0 items-center gap-2 pb-4">
        <div className="flex flex-1 min-w-0 items-center gap-1">
          {showExit ? <ExitMedia /> : null}
          <Code
            size="sm"
            className="min-w-0 max-w-[25%] rounded-xl px-4 text-xs truncate"
          >
            {mediaFile?.fileName ?? ''}
          </Code>
          {clips.length > 0 ? (
            <span className="ml-1 shrink-0 text-xs font-medium text-primary">
              {t('clips.count', { count: clips.length })}
            </span>
          ) : null}
        </div>
        {headerEnd ? <div className="shrink-0">{headerEnd}</div> : null}
      </div>

      <ScrollShadow
        className="min-h-0 w-full overflow-hidden overflow-y-auto"
        hideScrollBar
      >
        <AnimatePresence mode="wait">
          <motion.div
            variants={zoomInStaggerAnimation.container}
            initial="hidden"
            animate="show"
            exit="hidden"
            className="grid min-w-0 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 gap-4 pb-4"
          >
            {clips.map((clip) => (
              <motion.div
                key={`${clip.index}-${clip.pathRaw}`}
                layout
                variants={zoomInStaggerAnimation.item}
                role="button"
                tabIndex={0}
                onDoubleClick={() => setPreviewClip(clip)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setPreviewClip(clip)
                  }
                }}
                className="relative min-w-0 cursor-pointer overflow-hidden rounded-xl border-1 border-primary"
              >
                <Card
                  className="w-full min-w-0 bg-zinc-100/5 dark:bg-zinc-900 rounded-none overflow-hidden"
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
                    <div
                      className="absolute top-2 left-2 z-10 flex gap-2 items-center"
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
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
                  <section className="min-w-0 px-3 py-2 mt-1">
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
                        {formatClipTime(clip.startSeconds)} –{' '}
                        {formatClipTime(clip.endSeconds)}
                      </p>
                    </section>
                  </section>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      </ScrollShadow>
      <section className="shrink-0 pt-2 sm:pt-4">
        <OutputSizeSummary mediaIndex={mediaIndex} />
      </section>
    </div>
  )
}

export default PreviewClips
