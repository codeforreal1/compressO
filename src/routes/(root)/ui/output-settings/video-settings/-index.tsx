import { Divider, Tab } from '@heroui/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Tabs from '@/components/Tabs'
import { getAudioStreams } from '@/tauri/commands/ffprobe'
import { isAudioExtension } from '@/types/compression'
import {
  type BatchVideoConfigKey,
  BatchVideoConfigKeyContext,
} from './-batchConfig'
import AudioBitrate from './audio/AudioBitrate'
import AudioChannels from './audio/AudioChannels'
import AudioCodec from './audio/AudioCodec'
import AudioCompression from './audio/AudioCompression'
import AudioTracks from './audio/AudioTracks'
import AudioVolume from './audio/AudioVolume'
import Others from './others/-index'
import VideoOnlySection from './VideoOnlySection'
import BatchResolution from './video/BatchResolution'
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
import PresetSelector from '../PresetSelector'

type VideoSettingsProps = {
  mediaIndex: number // if mediaIndex < 0, we'll only show settings that applies to all videos
  /** With `mediaIndex` < 0: the batch settings edited, its videos' or its audio files' */
  batchConfigKey?: BatchVideoConfigKey
}

/** Titled with `outputSettings.tabs.<id>` */
const TABS = {
  video: { id: 'video' },
  audio: { id: 'audio' },
  others: { id: 'others' },
} as const

/** Tabs of an audio file (or a batch's audio files): no video settings */
const AUDIO_FILE_TABS = {
  audio: TABS.audio,
  others: TABS.others,
} as const

function VideoSettings({
  mediaIndex,
  batchConfigKey = 'videoConfig',
}: VideoSettingsProps) {
  const { t } = useTranslation()
  const {
    state: { media, commonConfigForBatchCompression },
  } = useSnapshot(appProxy)
  const video =
    media.length && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const isAudioFileSettings =
    mediaIndex >= 0
      ? !!video?.isAudioFile
      : batchConfigKey === 'audioFileConfig'
  const settingsConfig =
    video?.config ?? commonConfigForBatchCompression[batchConfigKey]
  const { dimensions, pathRaw: videoPathRaw, videoInfoRaw } = video ?? {}
  // Extracting audio: only the trim, speed & audio settings apply
  const isAudioOutput = isAudioExtension(settingsConfig?.convertToExtension)

  const [tab, setTab] = useState<keyof typeof TABS>(
    isAudioFileSettings ? 'audio' : 'video',
  )
  const tabs = isAudioFileSettings ? AUDIO_FILE_TABS : TABS
  // Audio files have no Video tab (e.g. when the same settings switch to an audio file)
  useEffect(() => {
    if (isAudioFileSettings && tab === 'video') setTab('audio')
  }, [isAudioFileSettings, tab])

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
    <BatchVideoConfigKeyContext.Provider value={batchConfigKey}>
      <section>
        {/* Audio files have presets of their own */}
        <PresetSelector
          mediaType={isAudioFileSettings ? 'audio' : 'video'}
          mediaIndex={mediaIndex}
        />
        <Tabs
          aria-label={t('outputSettings.compressionSettings')}
          size="sm"
          selectedKey={tab}
          onSelectionChange={(key) => setTab(key as keyof typeof TABS)}
          className="w-full"
          fullWidth
          classNames={{
            tab: 'h-6',
            tabContent: 'text-[11px]',
          }}
        >
          {Object.values(tabs).map((item) => (
            <Tab
              key={item.id}
              value={item.id}
              title={t(`outputSettings.tabs.${item.id}`)}
            />
          ))}
        </Tabs>
        <div className="my-4">
          {tab === 'video' ? (
            <div>
              {/* Video-only settings stay in place but are disabled when extracting audio */}
              {isAudioOutput ? (
                <AudioCompression mediaIndex={mediaIndex} />
              ) : (
                <CompressionPreset mediaIndex={mediaIndex} />
              )}
              <Divider className="my-3" />
              <VideoOnlySection isDisabled={isAudioOutput}>
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
              ) : mediaIndex < 0 ? (
                <div className="mt-8">
                  <VideoOnlySection isDisabled={isAudioOutput}>
                    <BatchResolution />
                    <Divider className="my-3" />
                  </VideoOnlySection>
                </div>
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
          {tab === 'audio' && isAudioFileSettings ? (
            <div>
              <AudioCompression mediaIndex={mediaIndex} />
              <Divider className="my-3" />
              {mediaIndex >= 0 && video?.videoDuration ? (
                <>
                  <TrimVideo mediaIndex={mediaIndex} />
                  <Divider className="my-3" />
                </>
              ) : null}
              <VideoSpeed mediaIndex={mediaIndex} />
              <Divider className="my-3" />
              <div className="mb-4">
                <AudioVolume mediaIndex={mediaIndex} />
                <Divider className="mt-8" />
              </div>
              <AudioCodec mediaIndex={mediaIndex} />
              <Divider className="my-3" />
              <AudioChannels mediaIndex={mediaIndex} />
              <Divider className="my-3" />
              <AudioBitrate mediaIndex={mediaIndex} />
              <Divider className="my-3" />
              <div className="mt-10">
                <VideoExtension mediaIndex={mediaIndex} />
              </div>
            </div>
          ) : null}
          {tab === 'audio' && !isAudioFileSettings ? (
            <div className="relative">
              {hasNoAudio ? (
                <p className="text-sm text-center mb-4 text-zinc-600 dark:text-zinc-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                  {t('outputSettings.noAudio')}
                </p>
              ) : null}
              {/* Without audio, the controls are dimmed & cannot be used */}
              <div
                className={
                  hasNoAudio ? 'opacity-40 pointer-events-none' : undefined
                }
                aria-disabled={hasNoAudio || undefined}
              >
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
              </div>
            </div>
          ) : null}
          {tab === 'others' ? (
            <>
              <Others
                mediaIndex={mediaIndex}
                disableSubtitles={isAudioOutput}
                hideSubtitles={isAudioFileSettings}
              />
            </>
          ) : null}
        </div>
      </section>
    </BatchVideoConfigKeyContext.Provider>
  )
}

export default VideoSettings
