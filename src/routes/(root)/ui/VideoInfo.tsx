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

const TABS = {
  container: {
    id: 'container',
    title: '文件容器',
  },
  video: {
    id: 'video',
    title: '视频',
  },
  audio: {
    id: 'audio',
    title: '音频',
  },
  subtitles: {
    id: 'subtitles',
    title: '字幕',
  },
  chapters: {
    id: 'chapters',
    title: '章节',
  },
  metadata: {
    id: 'metadata',
    title: '元数据',
  },
} as const

function VideoInfo({ mediaIndex, onClose }: VideoInfoProps) {
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
    <section className="w-full h-full bg-white1 dark:bg-black1 p-6">
      <div className="w-full flex justify-center">
        <Tabs
          aria-label="视频信息"
          size="sm"
          selectedKey={tab}
          onSelectionChange={(t) => setTab(t as keyof typeof TABS)}
          classNames={{
            tabContent: 'text-[11px]',
            tab: 'h-6',
          }}
        >
          {Object.values(TABS).map((t) => (
            <Tab key={t.id} value={t.id} title={t.title} />
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
  return (
    <div className="space-y-4 select-text">
      {info.filename ? (
        <>
          <InfoItem
            label="文件完整路径"
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
          <InfoItem label="格式名称" value={info.formatName} />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.formatLongName ? (
        <>
          <InfoItem label="格式" value={info.formatLongName} />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.duration ? (
        <>
          <InfoItem label="时长" value={`${formatDuration(info.duration)}`} />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.size > 0 ? (
        <>
          <InfoItem label="大小" value={formatBytes(info.size)} />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.bitRate ? (
        <>
          <InfoItem
            label="比特率"
            value={`${(info.bitRate / 1000).toFixed(0)} kbps`}
          />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.nbStreams > 0 ? (
        <>
          <InfoItem label="流总数" value={info.nbStreams.toString()} />
          <Divider className="my-1" />
        </>
      ) : null}
    </div>
  )
}

function MetadataDisplay({ info }: { info: ContainerInfo }) {
  if (!info.tags || info.tags.length === 0) {
    return (
      <p className="text-center text-zinc-500 py-8 select-text">未找到元数据</p>
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
              {value ?? 'N/A'}
            </span>
            <Divider className="mt-2" />
          </div>
        ))}
      </div>
    </div>
  )
}

function VideoStreamsDisplay({ streams }: { streams: VideoStream[] }) {
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
            视频流 {streams.length > 1 ? `${index + 1}` : ''}
          </h3>

          <InfoItem
            label="编码器"
            value={`${stream.codec} (${stream.codecLongName ?? 'N/A'})`}
          />
          <Divider className="my-3" />

          {stream.profile && (
            <>
              <InfoItem label="配置文件" value={stream.profile} />
              <Divider className="my-3" />
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <InfoItem label="宽度" value={`${stream.width ?? '-'}px`} />
              <Divider className="my-3" />
            </div>
            <div>
              <InfoItem label="高度" value={`${stream.height ?? '-'}px`} />
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
                    label="编码宽度"
                    value={`${stream.codedWidth ?? '-'}px`}
                  />
                  <Divider className="my-3" />
                </div>
                <div>
                  <InfoItem
                    label="编码高度"
                    value={`${stream.codedHeight ?? '-'}px`}
                  />
                  <Divider className="my-3" />
                </div>
              </div>
            </>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <InfoItem label="帧率" value={stream.rFrameRate} />
              <Divider className="my-3" />
            </div>
            <div>
              <InfoItem label="平均帧率" value={stream.avgFrameRate} />
              <Divider className="my-3" />
            </div>
          </div>

          <InfoItem label="像素格式" value={stream.pixFmt} />
          <Divider className="my-3" />

          {stream.colorSpace ? (
            <>
              <InfoItem label="色彩空间" value={stream.colorSpace} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.colorRange ? (
            <>
              <InfoItem label="色彩范围" value={stream.colorRange} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.colorPrimaries ? (
            <>
              <InfoItem label="色彩原色" value={stream.colorPrimaries} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.colorTransfer ? (
            <>
              <InfoItem label="色彩传递" value={stream.colorTransfer} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.chromaLocation ? (
            <>
              <InfoItem label="色度位置" value={stream.chromaLocation} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.bitRate ? (
            <>
              <InfoItem label="比特率" value={stream.bitRate} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.duration ? (
            <>
              <InfoItem label="时长" value={formatDuration(+stream.duration)} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.nbFrames ? (
            <>
              <InfoItem label="总帧数" value={stream.nbFrames} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.refs ? (
            <>
              <InfoItem label="参考帧数" value={stream.refs.toString()} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.gopSize ? (
            <>
              <InfoItem label="GOP 大小" value={stream.gopSize.toString()} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.level ? (
            <>
              <InfoItem label="编码级别" value={stream.level.toString()} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.fieldOrder && stream.fieldOrder !== 'progressive' ? (
            <>
              <InfoItem label="场序" value={stream.fieldOrder} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.timeBase && stream.timeBase !== '0/0' ? (
            <>
              <InfoItem label="时间基准" value={stream.timeBase} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.rotation && stream.rotation !== 0 ? (
            <>
              <InfoItem label="旋转角度" value={`${stream.rotation}°`} />
              <Divider className="my-3" />
            </>
          ) : null}
        </motion.div>
      ))}
    </div>
  )
}

function AudioStreamsDisplay({ streams }: { streams: AudioStream[] }) {
  if (streams.length === 0) {
    return (
      <p className="text-center text-zinc-500 py-8 select-text">未找到音频流</p>
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
            音频流 {streams.length > 1 ? `${index + 1}` : ''}
          </h3>

          <InfoItem
            label="编码器"
            value={`${upperCase(stream.codec ?? 'N/A')} / ${stream.codecLongName ?? 'N/A'}`}
          />
          <Divider className="my-3" />

          {stream.profile ? (
            <>
              <InfoItem label="配置文件" value={stream.profile} />
              <Divider className="my-3" />
            </>
          ) : null}

          <InfoItem label="声道数" value={stream.channels} />
          <Divider className="my-3" />

          {stream.channelLayout ? (
            <>
              <InfoItem label="声道布局" value={stream.channelLayout} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.sampleRate ? (
            <>
              <InfoItem
                label="采样率"
                value={`${stream.sampleRate ?? 'N/A'} Hz`}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.sampleFmt ? (
            <>
              <InfoItem label="采样格式" value={stream.sampleFmt} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.bitsPerSample ? (
            <>
              <InfoItem
                label="每样本位数"
                value={stream.bitsPerSample.toString()}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.bitRate ? (
            <>
              <InfoItem
                label="比特率"
                value={`${formatBytes(+stream.bitRate).toLowerCase?.() ?? '-'}ps (${stream.bitRate})`}
              />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.duration ? (
            <>
              <InfoItem label="时长" value={formatDuration(+stream.duration)} />
              <Divider className="my-3" />
            </>
          ) : null}

          {stream.tags && stream.tags.length > 0 ? (
            <div>
              <InfoItem label="元数据标签" value=" " />
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
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null)
  const [selectedFormat, setSelectedFormat] = useState<SubtitleFormat>('srt')

  if (streams.length === 0) {
    return (
      <p className="text-center text-zinc-500 py-8 select-text">未找到字幕流</p>
    )
  }

  const handleDownload = async (
    stream: SubtitleStream,
    index: number,
    format: SubtitleFormat,
  ) => {
    if (!videoPath) {
      toast.error('视频路径不可用。')
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
            name: '字幕文件',
            extensions: ['srt', 'vtt'],
          },
        ],
      })

      if (!filePath) {
        setDownloadingIndex(null)
        return
      }

      await extractSubtitle(videoPath, stream.index, filePath, format)

      toast.success(`字幕已提取并保存为 ${format.toUpperCase()}。`)
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
                字幕流 {index + 1}
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
                        此字幕格式（{stream.codec}）无法转换为
                        SRT。它可能是基于图像的格式（例如 Blu-ray PGS 或 DVD
                        VobSub），因此无法下载。
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
                      ? '正在下载……'
                      : !isExtractable
                        ? '不支持'
                        : `下载为 ${formatConfig.name}`}
                  </Button>
                  <Dropdown size="sm">
                    <DropdownTrigger>
                      <Button isIconOnly radius="lg">
                        <Icon name="chevron" />
                      </Button>
                    </DropdownTrigger>
                    <DropdownMenu
                      disallowEmptySelection
                      aria-label="字幕格式"
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
              label="编码器"
              value={`${stream.codec} (${stream.codecLongName})`}
            />
            <Divider className="my-3" />

            {stream.language ? (
              <>
                <InfoItem label="语言" value={stream.language} />
                <Divider className="my-3" />
              </>
            ) : null}

            {stream.title ? (
              <>
                <InfoItem label="标题" value={stream.title} />
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
                <InfoItem label="属性" value=" " />
                <div className="mt-2 space-y-1 ml-4">
                  {stream.disposition.default ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - 默认
                    </div>
                  ) : null}
                  {stream.disposition.forced ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - 强制
                    </div>
                  ) : null}
                  {stream.disposition.attachedPic ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - 附加图片
                    </div>
                  ) : null}
                  {stream.disposition.comment ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - 评论
                    </div>
                  ) : null}
                  {stream.disposition.karaoke ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - 卡拉 OK
                    </div>
                  ) : null}
                  {stream.disposition.lyrics ? (
                    <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                      - 歌词
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
  if (chapters.length === 0) {
    return (
      <p className="text-center text-zinc-500 py-8 select-text">未找到章节</p>
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
              章节 {index + 1} {chapter.id ? `（#${chapter.id}）` : ''}
            </h3>
            {chapter.title && (
              <span className="text-sm text-zinc-600 dark:text-zinc-400 ml-4">
                {chapter.title}
              </span>
            )}
          </div>

          <div className="mt-3 space-y-4">
            <InfoItem label="开始" value={`${chapter.start.toFixed(2)}s`} />
            <Divider className="my-3" />

            <InfoItem label="结束" value={`${chapter.end.toFixed(2)}s`} />
            <Divider className="my-3" />

            <InfoItem
              label="时长"
              value={`${formatDuration(chapter.end - chapter.start)}`}
            />
            <Divider className="my-3" />

            {chapter.timeBase && chapter.timeBase !== '0/0' ? (
              <>
                <InfoItem label="时间基准" value={chapter.timeBase} />
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
  return (
    <div className="flex items-baseline justify-between select-text">
      <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
        {label}:
      </span>
      <span className="text-[13px] text-zinc-800 dark:text-zinc-200 ml-2 max-w-[75%] text-end">
        {value || 'N/A'}
      </span>
    </div>
  )
}

export default VideoInfo
