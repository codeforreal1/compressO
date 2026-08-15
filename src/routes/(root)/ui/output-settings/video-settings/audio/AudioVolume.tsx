import React, { useCallback } from 'react'
import { snapshot, useSnapshot } from 'valtio'

import Slider from '@/components/Slider'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

type AudioVolumeProps = {
  mediaIndex: number
}

function AudioVolume({ mediaIndex }: AudioVolumeProps) {
  const {
    state: {
      media,
      isCompressing,
      isProcessCompleted,
      commonConfigForBatchCompression,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const video =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config, videoInfoRaw } = video ?? {}
  const { audioConfig, convertToExtension } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const [volume, setVolume] = React.useState<number>(audioConfig?.volume ?? 100)
  const debounceRef = React.useRef<NodeJS.Timeout>()
  const volumeRef = React.useRef<number>(volume)

  React.useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  React.useEffect(() => {
    const appSnapshot = snapshot(appProxy)
    if (
      appSnapshot.state.media.length &&
      volume !==
        (mediaIndex >= 0 && appSnapshot.state.media[mediaIndex].type === 'video'
          ? appSnapshot.state.media[mediaIndex]?.config?.audioConfig?.volume
          : appSnapshot.state.media.length > 1
            ? appSnapshot.state.commonConfigForBatchCompression?.videoConfig
                ?.audioConfig?.volume
            : undefined)
    ) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      debounceRef.current = setTimeout(() => {
        if (
          mediaIndex >= 0 &&
          appProxy.state.media[mediaIndex].type === 'video' &&
          appProxy.state.media[mediaIndex]?.config
        ) {
          if (!appProxy.state.media[mediaIndex].config.audioConfig) {
            appProxy.state.media[mediaIndex].config.audioConfig = {
              volume: 100,
            }
          }
          appProxy.state.media[mediaIndex].config.audioConfig.volume = volume
          appProxy.state.media[mediaIndex].isConfigDirty = true
        } else {
          if (appProxy.state.media.length > 1) {
            if (
              !appProxy.state.commonConfigForBatchCompression.videoConfig
                .audioConfig
            ) {
              appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig =
                {
                  volume: 100,
                }
            }
            appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig.volume =
              volume
            normalizeBatchMediaConfig()
          }
        }
      }, 500)
    }
    return () => {
      clearTimeout(debounceRef.current)
    }
  }, [volume, mediaIndex])

  React.useEffect(() => {
    if (audioConfig?.volume !== volumeRef.current) {
      if (
        typeof audioConfig?.volume === 'number' &&
        !Number.isNaN(+audioConfig.volume)
      ) {
        setVolume(audioConfig.volume)
      }
    }
  }, [audioConfig?.volume])

  const handleVolumeChange = useCallback((value: number | number[]) => {
    if (typeof value === 'number') {
      setVolume(value)
    }
  }, [])

  const hasNoAudio = videoInfoRaw?.audioStreams?.length === 0
  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    hasNoAudio ||
    convertToExtension === 'gif'

  return (
    <>
      <Slider
        label="音量："
        aria-label="音量"
        maxValue={200}
        marks={[
          {
            value: 0,
            label: '静音',
          },
          {
            value: 100,
            label: '100%',
          },
          {
            value: 200,
            label: '200%',
          },
        ]}
        classNames={{
          mark: 'text-[11px] mt-3',
          label: 'text-sm text-gray-600 dark:text-gray-400 font-bold',
        }}
        getValue={(value) => {
          const val = Array.isArray(value) ? value?.[0] : +value
          return `${Math.round(val)}%`
        }}
        renderValue={(props) => (
          <p className="text-primary text-xs font-bold">{props?.children}</p>
        )}
        value={volume}
        onChange={handleVolumeChange}
        isDisabled={shouldDisableInput}
      />
    </>
  )
}

export default AudioVolume
