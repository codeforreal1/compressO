import { Divider, Tab } from '@heroui/react'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'

import Tabs from '@/components/Tabs'
import { getAudioStreams } from '@/tauri/commands/ffprobe'
import { isAudioExtension } from '@/types/compression'
import AudioBitrate from './audio/AudioBitrate'
import AudioChannels from './audio/AudioChannels'
import AudioCodec from './audio/AudioCodec'
import AudioTracks from './audio/AudioTracks'
import AudioVolume from './audio/AudioVolume'
import Others from './others/-index'
import VideoOnlySection from './VideoOnlySection'
import CompressionPreset from './video/CompressionPreset'
import CustomThumbnail from './video/CustomThumbnail'
import VideoDimensions from './video/Dimensions'
import VideoExtension from './video/Extension'
import VideoFPS from './video/FPS'
import VideoSpeed from './video/Speed'
import TransformVideo from './video/TransformVideo'
import TrimVideo from './video/TrimVideo'
import VideoCodec from './video/VideoCodec'
import { appProxy } from '../../../-state'

type VideoSettingsProps = {
  mediaIndex: number // if mediaIndex < 0, we'll only show settings that applies to all videos
}

const TABS = {
  video: {
    id: 'video',
    title: 'Video',
  },
  audio: {
    id: 'audio',
    title: 'Audio',
  },
  others: {
    id: 'others',
    title: 'Others',
  },
} as const

function VideoSettings({ mediaIndex }: VideoSettingsProps) {
  const {
    state: { media, commonConfigForBatchCompression },
  } = useSnapshot(appProxy)
  const video =
    media.length && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { dimensions, pathRaw: videoPathRaw, videoInfoRaw } = video ?? {}
  // Extracting audio: only the trim, speed & audio settings apply
  const isAudioOutput = isAudioExtension(
    (video?.config ?? commonConfigForBatchCompression.videoConfig)
      ?.convertToExtension,
  )

  const [tab, setTab] = useState<keyof typeof TABS>('video')

  useEffect(() => {
    tab === 'audio' &&
      mediaIndex > -1 &&
      appProxy.state.media[mediaIndex] &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      !appProxy.state.media[mediaIndex]?.videoInfoRaw?.audioStreams &&
      videoPathRaw &&
      (async () => {
        const streams = await getAudioStreams(videoPathRaw)
        if (streams && appProxy.state.media[mediaIndex].type === 'video') {
          const targetVideo = appProxy.state.media[mediaIndex]
          if (!targetVideo?.videoInfoRaw) {
            appProxy.state.media[mediaIndex].videoInfoRaw = {}
          }
          if (targetVideo.videoInfoRaw) {
            targetVideo.videoInfoRaw.audioStreams = streams
          }
        }
      })()
  }, [videoPathRaw, mediaIndex, tab])

  const hasNoAudio = videoInfoRaw?.audioStreams?.length === 0

  return (
    <>
      <section>
        <Tabs
          aria-label="Compression Settings"
          size="sm"
          selectedKey={tab}
          onSelectionChange={(t) => setTab(t as keyof typeof TABS)}
          className="w-full"
          fullWidth
          classNames={{
            tab: 'h-6',
            tabContent: 'text-[11px]',
          }}
        >
          {Object.values(TABS).map((t) => (
            <Tab key={t.id} value={t.id} title={t.title} />
          ))}
        </Tabs>
        <div className="my-4">
          {tab === 'video' ? (
            <div>
              {/* Video-only settings stay in place but are disabled when extracting audio */}
              <VideoOnlySection isDisabled={isAudioOutput}>
                <CompressionPreset mediaIndex={mediaIndex} />
                <Divider className="my-3" />
                <VideoCodec mediaIndex={mediaIndex} />
                <Divider className="my-3" />
              </VideoOnlySection>

              {mediaIndex >= 0 && dimensions ? (
                <>
                  <VideoOnlySection isDisabled={isAudioOutput}>
                    <VideoDimensions mediaIndex={mediaIndex} />
                    <Divider className="my-3" />
                    <TransformVideo mediaIndex={mediaIndex} />
                    <Divider className="my-3" />
                  </VideoOnlySection>
                  <TrimVideo mediaIndex={mediaIndex} />
                  <Divider className="my-3" />
                </>
              ) : null}
              <>
                <VideoSpeed mediaIndex={mediaIndex} />
                <Divider className="my-3" />
              </>
              <VideoOnlySection isDisabled={isAudioOutput}>
                <VideoFPS mediaIndex={mediaIndex} />
                <Divider className="my-3" />
                <CustomThumbnail mediaIndex={mediaIndex} />
              </VideoOnlySection>
              <>
                <div className="mt-8">
                  <VideoExtension mediaIndex={mediaIndex} />
                </div>
              </>
            </div>
          ) : null}
          {tab === 'audio' ? (
            <div className="relative">
              <div className="mb-4">
                <AudioVolume mediaIndex={mediaIndex} />
                <Divider className="mt-8" />
              </div>
              <>
                <>
                  <AudioCodec mediaIndex={mediaIndex} />
                  <Divider className="my-3" />
                </>
                <AudioChannels mediaIndex={mediaIndex} />
                <Divider className="my-3" />
              </>
              <>
                <AudioBitrate mediaIndex={mediaIndex} />
                <Divider className="my-3" />
              </>
              <>
                <AudioTracks mediaIndex={mediaIndex} />
              </>
              {hasNoAudio ? (
                <div className="flex justify-center items-center absolute left-0 top-0 w-full h-full bg-white1/50 dark:bg-black1/50">
                  <p className="text-xs text-center mt-1 text-zinc-600 dark:text-zinc-400">
                    No audio found
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          {tab === 'others' ? (
            <>
              <Others
                mediaIndex={mediaIndex}
                disableSubtitles={isAudioOutput}
              />
            </>
          ) : null}
        </div>
      </section>
    </>
  )
}

export default VideoSettings
