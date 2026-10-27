import {
  ButtonGroup,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Tab,
} from '@heroui/react'
import { save } from '@tauri-apps/plugin-dialog'
import { motion } from 'framer-motion'
import { startCase, upperCase } from 'lodash'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Code from '@/components/Code'
import Divider from '@/components/Divider'
import Dropdown from '@/components/Dropdown'
import Icon from '@/components/Icon'
import Popover, { PopoverContent, PopoverTrigger } from '@/components/Popover'
import ScrollShadow from '@/components/ScrollShadow'
import Spinner from '@/components/Spinner'
import Tabs from '@/components/Tabs'
import { extractSubtitle } from '@/tauri/commands/ffmpeg'
import {
  getAudioStreams,
  getChapters,
  getContainerInfo,
  getSubtitleStreams,
  getVideoStreams,
} from '@/tauri/commands/ffprobe'
import {
  AudioStream,
  Chapter,
  ContainerInfo,
  SubtitleStream,
  VideoStream,
} from '@/types/compression'
import { formatBytes } from '@/utils/fs'
import { formatDuration } from '@/utils/string'
import { appProxy } from '../-state'

type VideoInfoProps = {
  mediaIndex: number
  onClose?: () => void
}

/** Titled with `mediaInfo.tabs.<id>` */
const TABS = {
  container: { id: 'container' },
  video: { id: 'video' },
  audio: { id: 'audio' },
  subtitles: { id: 'subtitles' },
  chapters: { id: 'chapters' },
  metadata: { id: 'metadata' },
} as const

function VideoInfo({ mediaIndex, onClose }: VideoInfoProps) {
  const { t } = useTranslation()
  if (mediaIndex < 0) return null

  const {
    state: { media },
  } = useSnapshot(appProxy)

  const video =
    media.length && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { pathRaw: videoPathRaw, videoInfoRaw } = video ?? {}
  if (!video) return null

  const [tab, setTab] = useState<keyof typeof TABS>('container')
  const [loading, setLoading] = useState(false)

  const fetchTabData = useCallback(
    async (tabKey: keyof typeof TABS) => {
      const video = appProxy.state.media[mediaIndex]

      if (!videoPathRaw || !video || video.type !== 'video') {
        return
      }

      if (!video.videoInfoRaw) {
        video.videoInfoRaw = {}
      }

      setLoading(true)
      try {
        switch (tabKey) {
          case 'container': {
            if (!video?.videoInfoRaw?.containerInfo) {
              const data = await getContainerInfo(videoPathRaw)
              if (data) {
                video.videoInfoRaw.containerInfo = data
              }
            }
            break
          }
          case 'video': {
            if (!video?.videoInfoRaw?.videoStreams) {
              const data = await getVideoStreams(videoPathRaw)
              if (data) {
                video.videoInfoRaw.videoStreams = data
              }
            }
            break
          }
          case 'audio': {
            if (!video?.videoInfoRaw?.audioStreams) {
              const data = await getAudioStreams(videoPathRaw)
              if (data) {
                video.videoInfoRaw.audioStreams = data
              }
            }
            break
          }
          case 'subtitles': {
            if (!video?.videoInfoRaw?.subtitleStreams) {
              const data = await getSubtitleStreams(videoPathRaw)
              if (data) {
                video.videoInfoRaw.subtitleStreams = data
              }
            }
            break
          }
          case 'chapters': {
            if (!video?.videoInfoRaw?.chapters) {
              const data = await getChapters(videoPathRaw)
              if (data) {
                video.videoInfoRaw.chapters = data
              }
            }
            break
          }
          case 'metadata': {
            if (!video?.videoInfoRaw?.containerInfo) {
              const data = await getContainerInfo(videoPathRaw)
              if (data) {
                video.videoInfoRaw.containerInfo = data
              }
            }
            break
          }
        }
      } catch {
        //
      } finally {
        setLoading(false)
      }
    },
    [videoPathRaw, mediaIndex],
  )

  useEffect(() => {
    fetchTabData(tab)
  }, [tab, fetchTabData])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <section
      data-tint-transparent=""
      className="w-full h-full bg-white1 dark:bg-black1 p-6"
    >
      <div className="w-full flex justify-center">
        <Tabs
          aria-label={t('mediaInfo.videoInformation')}
          size="sm"
          selectedKey={tab}
          onSelectionChange={(key) => setTab(key as keyof typeof TABS)}
          classNames={{
            tabContent: 'text-[11px]',
            tab: 'h-6',
          }}
        >
          {Object.values(TABS)
            // An audio file has no picture or subtitles (chapters, e.g. of audiobooks, are kept)
            .filter(
              (item) =>
                !video.isAudioFile ||
                (item.id !== 'video' && item.id !== 'subtitles'),
            )
            .map((item) => (
              <Tab
                key={item.id}
                value={item.id}
                title={t(`mediaInfo.tabs.${item.id}`)}
              />
            ))}
        </Tabs>
      </div>

      <ScrollShadow
        className="mt-6 overflow-y-auto max-h-[calc(100vh-200px)] pb-10"
        hideScrollBar
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="sm" />
          </div>
        ) : null}

        {!loading && tab === 'container' && videoInfoRaw?.containerInfo ? (
          <ContainerInfoDisplay info={videoInfoRaw?.containerInfo as any} />
        ) : null}

        {!loading && tab === 'video' && videoInfoRaw?.videoStreams ? (
          <VideoStreamsDisplay streams={videoInfoRaw?.videoStreams as any} />
        ) : null}

        {!loading && tab === 'audio' && videoInfoRaw?.audioStreams ? (
          <AudioStreamsDisplay streams={videoInfoRaw?.audioStreams as any} />
        ) : null}

        {!loading && tab === 'chapters' && videoInfoRaw?.chapters ? (
          <ChaptersDisplay chapters={videoInfoRaw?.chapters as any} />
        ) : null}

        {!loading && tab === 'subtitles' && videoInfoRaw?.subtitleStreams ? (
          <SubtitleStreamsDisplay
            streams={videoInfoRaw?.subtitleStreams as any}
            videoPath={videoPathRaw}
          />
        ) : null}

        {!loading && tab === 'metadata' && videoInfoRaw?.containerInfo ? (
          <MetadataDisplay info={videoInfoRaw?.containerInfo as any} />
        ) : null}
      </ScrollShadow>
    </section>
  )
}

function ContainerInfoDisplay({ info }: { info: ContainerInfo }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4 select-text">
      {info.filename ? (
        <>
          <InfoItem
            label={t('mediaInfo.fullPath')}
            value={
              <Code size="sm" className="text-xs max-w-[100%] truncate">
                {info.filename}
              </Code>
            }
          />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.formatName ? (
        <>
          <InfoItem label={t('mediaInfo.formatName')} value={info.formatName} />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.formatLongName ? (
        <>
          <InfoItem label={t('mediaInfo.format')} value={info.formatLongName} />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.duration ? (
        <>
          <InfoItem
            label={t('mediaInfo.duration')}
            value={`${formatDuration(info.duration)}`}
          />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.size > 0 ? (
        <>
          <InfoItem
            label={t('mediaInfo.size')}
            value={formatBytes(info.size)}
          />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.bitRate ? (
        <>
          <InfoItem
            label={t('mediaInfo.bitrate')}
            value={`${(info.bitRate / 1000).toFixed(0)} kbps`}
          />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.nbStreams > 0 ? (
        <>
          <InfoItem
            label={t('mediaInfo.totalStreams')}
            value={info.nbStreams.toString()}
          />
          <Divider className="my-1" />
        </>
      ) : null}
    </div>
  )
}

function MetadataDisplay({ info }: { info: ContainerInfo }) {
  const { t } = useTranslation()
  if (!info.tags || info.tags.length === 0) {
    return (
      <p className="text-center text-zinc-500 py-8 select-text">
        {t('mediaInfo.noMetadata')}
      </p>
    )
  }

  return (
    <div className="space-y-4 select-text">
      <div className="mt-2 space-y-2">
        {info.tags.map(([key, value]) => (
          <div key={key} className="select-text">
            <p className="font-bold text-zinc-600 dark:text-zinc-400 text-[13px]">
              {startCase(key)}:
            </p>{' '}
            <span className="text-zinc-800 dark:text-zinc-200 text-[13px]">
              {value ?? t('mediaInfo.notAvailable')}
            </span>
            <Divider className="mt-2" />
          </div>
        ))}
      </div>
    </div>
  )
}

function VideoStreamsDisplay({ streams }: { streams: VideoStream[] }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-6 select-text">
      {streams.map((stream, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          className="space-y-4"
        >
          <h3 className="text-lg font-semibold text-primary select-text">
            {t('mediaInfo.videoStream')}{' '}
            {streams.length > 1 ? `${index + 1}` : ''}
          </h3>

          <InfoItem
            label={t('mediaInfo.codec')}
            value={`${stream.codec} (${stream.codecLongName ?? t('mediaInfo.notAvailable')})`}
          />
          <Divider className="my-3" />

          {stream.profile && (
            <>
              <InfoItem label={t('mediaInfo.profile')} value={stream.profile} />
              <Divider className="my-3" />
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <InfoItem
                label={t('mediaInfo.width')}
                value={`${stream.width ?? '-'}px`}
              />
              <Divider className="my-3" />
            </div>
            <div>
              <InfoItem
                label={t('mediaInfo.height')}
                value={`${stream.height ?? '-'}px`}
              />
              <Divider className="my-3" />
            </div>
          </div>

          {stream.codedWidth &&
          stream.codedHeight &&
          (stream.codedWidth !== stream.width ||
            stream.codedHeight !== stream.height) ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <InfoItem
                    label={t('mediaInfo.codedWidth')}
                    value={`${stream.codedWidth ?? '-'}px`}
                  />
                  <Divider className="my-3" />
                </div>
                <div>
                  <InfoItem
                    label={t('mediaInfo.codedHeight')}
                    value={`${stream.codedHeight ?? '-'}px`}
                  />
                  <Divider className="my-3" />
                </div>
              </div>
            </>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <InfoItem
                label={t('mediaInfo.frameRate')}
                value={stream.rFrameRate}
              />
              <Divider className="my-3" />
            </div>
            <div>
              <InfoItem
                label={t('mediaInfo.avgFrameRate')}
                value={stream.avgFrameRate}
              />
              <Divider className="my-3" />
            </div>
          </div>

          <InfoItem label={t('mediaInfo.pixelFormat')} value={stream.pixFmt} />
          <Divider className="my-3" />

          {stream.colorSpace ? (
            <>
              <InfoItem
                label={t('mediaInfo.colorSpace')}
                value={stream.colorSpace}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.colorRange ? (
            <>
              <InfoItem
                label={t('mediaInfo.colorRange')}
                value={stream.colorRange}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.colorPrimaries ? (
            <>
              <InfoItem
                label={t('mediaInfo.colorPrimaries')}
                value={stream.colorPrimaries}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.colorTransfer ? (
            <>
              <InfoItem
                label={t('mediaInfo.colorTransfer')}
                value={stream.colorTransfer}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.chromaLocation ? (
            <>
              <InfoItem
                label={t('mediaInfo.chromaLocation')}
                value={stream.chromaLocation}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.bitRate ? (
            <>
              <InfoItem label={t('mediaInfo.bitrate')} value={stream.bitRate} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.duration ? (
            <>
              <InfoItem
                label={t('mediaInfo.duration')}
                value={formatDuration(+stream.duration)}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.nbFrames ? (
            <>
              <InfoItem
                label={t('mediaInfo.totalFrames')}
                value={stream.nbFrames}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.refs ? (
            <>
              <InfoItem
                label={t('mediaInfo.referenceFrames')}
                value={stream.refs.toString()}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.gopSize ? (
            <>
              <InfoItem
                label={t('mediaInfo.gopSize')}
                value={stream.gopSize.toString()}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.level ? (
            <>
              <InfoItem
                label={t('mediaInfo.codecLevel')}
                value={stream.level.toString()}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.fieldOrder && stream.fieldOrder !== 'progressive' ? (
            <>
              <InfoItem
                label={t('mediaInfo.fieldOrder')}
                value={stream.fieldOrder}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.timeBase && stream.timeBase !== '0/0' ? (
            <>
              <InfoItem
                label={t('mediaInfo.timeBase')}
                value={stream.timeBase}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.rotation && stream.rotation !== 0 ? (
            <>
              <InfoItem
                label={t('mediaInfo.rotation')}
                value={`${stream.rotation}°`}
              />
              <Divider className="my-3" />
            </>
          ) : null}
        </motion.div>
      ))}
    </div>
  )
}

function AudioStreamsDisplay({ streams }: { streams: AudioStream[] }) {
  const { t } = useTranslation()
  if (streams.length === 0) {
    return (
      <p className="text-center text-zinc-500 py-8 select-text">
        {t('mediaInfo.noAudioStreams')}
      </p>
    )
  }

  return (
    <div className="space-y-6 select-text">
      {streams.map((stream, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          className="space-y-4"
        >
          <h3 className="text-lg font-semibold text-primary select-text">
            {t('mediaInfo.audioStream')}{' '}
            {streams.length > 1 ? `${index + 1}` : ''}
          </h3>

          <InfoItem
            label={t('mediaInfo.codec')}
            value={`${upperCase(stream.codec ?? t('mediaInfo.notAvailable'))} / ${stream.codecLongName ?? t('mediaInfo.notAvailable')}`}
          />
          <Divider className="my-3" />

          {stream.profile ? (
            <>
              <InfoItem label={t('mediaInfo.profile')} value={stream.profile} />
              <Divider className="my-3" />
            </>
          ) : null}

          <InfoItem label={t('mediaInfo.channels')} value={stream.channels} />
          <Divider className="my-3" />

          {stream.channelLayout ? (
            <>
              <InfoItem
                label={t('mediaInfo.channelLayout')}
                value={stream.channelLayout}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.sampleRate ? (
            <>
              <InfoItem
                label={t('mediaInfo.sampleRate')}
                value={`${stream.sampleRate ?? t('mediaInfo.notAvailable')} Hz`}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.sampleFmt ? (
            <>
              <InfoItem
                label={t('mediaInfo.sampleFormat')}
                value={stream.sampleFmt}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.bitsPerSample ? (
            <>
              <InfoItem
                label={t('mediaInfo.bitsPerSample')}
                value={stream.bitsPerSample.toString()}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.bitRate ? (
            <>
              <InfoItem
                label={t('mediaInfo.bitrate')}
                value={`${formatBytes(+stream.bitRate).toLowerCase?.() ?? '-'}ps (${stream.bitRate})`}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.duration ? (
            <>
              <InfoItem
                label={t('mediaInfo.duration')}
                value={formatDuration(+stream.duration)}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.tags && stream.tags.length > 0 ? (
            <div>
              <InfoItem label={t('mediaInfo.metadataTags')} value=" " />
              <div className="mt-2 space-y-2 mx-4">
                {stream.tags.map(([key, value]) => (
                  <div key={key} className="select-text">
                    <span className="font-medium text-zinc-600 dark:text-zinc-400 text-[13px]">
                      {startCase(key)}:
                    </span>{' '}
                    <span className="text-zinc-800 dark:text-zinc-200 text-[13px]">
                      {value ?? '-'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </motion.div>
      ))}
    </div>
  )
}

const UNSUPPORTED_SUBTITLE_CODECS = [
  'hdmv_pgs_subtitle',
  'dvd_subtitle',
  'xsub',
]

function isSubtitleExtractable(codec: string): boolean {
  return !UNSUPPORTED_SUBTITLE_CODECS.includes(codec)
}

type SubtitleFormat = 'srt' | 'vtt'

const SUBTITLE_FORMATS = {
  srt: {
    name: 'SRT',
    extension: 'srt',
  },
  vtt: {
    name: 'VTT',
    extension: 'vtt',
  },
} as const

function SubtitleStreamsDisplay({
  streams,
  videoPath,
}: {
  streams: SubtitleStream[]
  videoPath?: string | null
}) {
  const { t } = useTranslation()
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null)
  const [selectedFormat, setSelectedFormat] = useState<SubtitleFormat>('srt')

  if (streams.length === 0) {
    return (
      <p className="text-center text-zinc-500 py-8 select-text">
        {t('mediaInfo.noSubtitleStreams')}
      </p>
    )
  }

  const handleDownload = async (
    stream: SubtitleStream,
    index: number,
    format: SubtitleFormat,
  ) => {
    if (!videoPath) {
      toast.error(t('mediaInfo.noVideoPath'))
      return
    }

    setDownloadingIndex(index)

    try {
      const language = stream.language || 'unknown'
      const formatConfig = SUBTITLE_FORMATS[format]
      const defaultFileName = `subtitle_${language}_${stream.index}.${formatConfig.extension}`

      const filePath = await save({
        defaultPath: defaultFileName,
        filters: [
          {
            name: t('mediaInfo.subtitleFiles'),
            extensions: ['srt', 'vtt'],
          },
        ],
      })

      if (!filePath) {
        setDownloadingIndex(null)
        return
      }

      await extractSubtitle(videoPath, stream.index, filePath, format)

      toast.success(
        t('mediaInfo.subtitleSaved', { format: format.toUpperCase() }),
      )
    } catch {
      //
    } finally {
      setDownloadingIndex(null)
    }
  }

  return (
    <div className="space-y-6 select-text">
      {streams.map((stream, index) => {
        const isExtractable = isSubtitleExtractable(stream.codec)
        const formatConfig = SUBTITLE_FORMATS[selectedFormat]
        return (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-primary select-text">
                {t('mediaInfo.subtitleStream', { number: index + 1 })}
              </h3>
              <div className="flex items-center">
                {!isExtractable ? (
                  <Popover>
                    <PopoverTrigger>
                      <button>
                        <Icon name="info" className="text-warning-400" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="max-w-xs">
                      <p className="text-xs text-amber-600 dark:text-amber-400 select-text max-w-[250px]">
                        {t('mediaInfo.subtitleNotExtractable', {
                          codec: stream.codec,
                        })}
                      </p>
                    </PopoverContent>
                  </Popover>
                ) : null}

                <ButtonGroup variant="flat" size="sm">
                  <Button
                    radius="lg"
                    onPress={() =>
                      handleDownload(stream, index, selectedFormat)
                    }
                    isDisabled={downloadingIndex === index || !isExtractable}
                    color={!isExtractable ? 'default' : undefined}
                    startContent={
                      downloadingIndex === index ? (
                        <Spinner size="sm" />
                      ) : !isExtractable ? (
                        <Icon name="cross" size={20} />
                      ) : (
                        <Icon name="download" size={20} />
                      )
                    }
                  >
                    {downloadingIndex === index
                      ? t('mediaInfo.downloading')
                      : !isExtractable
                        ? t('mediaInfo.unsupported')
                        : t('mediaInfo.downloadAs', {
                            format: formatConfig.name,
                          })}
                  </Button>
                  <Dropdown size="sm">
                    <DropdownTrigger>
                      <Button isIconOnly radius="lg">
                        <Icon name="chevron" />
                      </Button>
                    </DropdownTrigger>
                    <DropdownMenu
                      disallowEmptySelection
                      aria-label={t('mediaInfo.subtitleFormat')}
                      selectedKeys={new Set([selectedFormat])}
                      selectionMode="single"
                      onSelectionChange={(keys) => {
                        const format = Array.from(keys)[0] as SubtitleFormat
                        setSelectedFormat(format)
                      }}
                    >
                      <DropdownItem key="srt">
                        {SUBTITLE_FORMATS.srt.name}
                      </DropdownItem>
                      <DropdownItem key="vtt">
                        {SUBTITLE_FORMATS.vtt.name}
                      </DropdownItem>
                    </DropdownMenu>
                  </Dropdown>
                </ButtonGroup>
              </div>
            </div>

            <InfoItem
              label={t('mediaInfo.codec')}
              value={`${stream.codec} (${stream.codecLongName})`}
            />
            <Divider className="my-3" />

            {stream.language ? (
              <>
                <InfoItem
                  label={t('mediaInfo.language')}
                  value={stream.language}
                />
                <Divider className="my-3" />
              </>
            ) : null}

            {stream.title ? (
              <>
                <InfoItem label={t('mediaInfo.title')} value={stream.title} />
                <Divider className="my-3" />
              </>
            ) : null}

            {stream.disposition.default ||
            stream.disposition.forced ||
            stream.disposition.attachedPic ||
            stream.disposition.comment ||
            stream.disposition.karaoke ||
            stream.disposition.lyrics ? (
              <div className="select-text">
                <InfoItem label={t('mediaInfo.disposition')} value=" " />
                <div className="mt-2 space-y-1 ml-4">
                  {stream.disposition.default ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - {t('mediaInfo.dispositions.default')}
                    </div>
                  ) : null}
                  {stream.disposition.forced ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - {t('mediaInfo.dispositions.forced')}
                    </div>
                  ) : null}
                  {stream.disposition.attachedPic ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - {t('mediaInfo.dispositions.attachedPicture')}
                    </div>
                  ) : null}
                  {stream.disposition.comment ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - {t('mediaInfo.dispositions.comment')}
                    </div>
                  ) : null}
                  {stream.disposition.karaoke ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - {t('mediaInfo.dispositions.karaoke')}
                    </div>
                  ) : null}
                  {stream.disposition.lyrics ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - {t('mediaInfo.dispositions.lyrics')}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </motion.div>
        )
      })}
    </div>
  )
}

function ChaptersDisplay({ chapters }: { chapters: Chapter[] }) {
  const { t } = useTranslation()
  if (chapters.length === 0) {
    return (
      <p className="text-center text-zinc-500 py-8 select-text">
        {t('mediaInfo.noChapters')}
      </p>
    )
  }

  return (
    <div className="space-y-4 select-text">
      {chapters.map((chapter, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <div className="flex items-start justify-between select-text">
            <h3 className="text-lg font-semibold text-primary">
              {t('mediaInfo.chapter', { number: index + 1 })}{' '}
              {chapter.id ? `(#${chapter.id})` : ''}
            </h3>
            {chapter.title && (
              <span className="text-sm text-zinc-600 dark:text-zinc-400 ml-4">
                {chapter.title}
              </span>
            )}
          </div>

          <div className="mt-3 space-y-4">
            <InfoItem
              label={t('mediaInfo.start')}
              value={`${chapter.start.toFixed(2)}s`}
            />
            <Divider className="my-3" />

            <InfoItem
              label={t('mediaInfo.end')}
              value={`${chapter.end.toFixed(2)}s`}
            />
            <Divider className="my-3" />

            <InfoItem
              label={t('mediaInfo.duration')}
              value={`${formatDuration(chapter.end - chapter.start)}`}
            />
            <Divider className="my-3" />

            {chapter.timeBase && chapter.timeBase !== '0/0' ? (
              <>
                <InfoItem
                  label={t('mediaInfo.timeBase')}
                  value={chapter.timeBase}
                />
                <Divider className="my-3" />
              </>
            ) : null}
          </div>
        </motion.div>
      ))}
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-baseline justify-between select-text">
      <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
        {label}:
      </span>
      <span className="text-[13px] text-zinc-800 dark:text-zinc-200 ml-2 max-w-[75%] text-end">
        {value || t('mediaInfo.notAvailable')}
      </span>
    </div>
  )
}

export default VideoInfo
