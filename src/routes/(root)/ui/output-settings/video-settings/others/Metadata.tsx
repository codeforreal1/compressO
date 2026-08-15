import { AnimatePresence, motion } from 'framer-motion'
import cloneDeep from 'lodash/cloneDeep'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Card from '@/components/Card'
import DatePicker from '@/components/DatePicker'
import Divider from '@/components/Divider'
import Switch from '@/components/Switch'
import TextArea from '@/components/TextArea'
import TextInput from '@/components/TextInput'
import type { MediaMetadataConfig } from '@/types/app'
import { slideDownTransition } from '@/utils/animation'
import {
  appProxy,
  normalizeBatchMediaConfig,
  videoMetadataConfigInitialState,
} from '../../../../-state'

type MetadataProps = {
  mediaIndex: number
}

function Metadata({ mediaIndex }: MetadataProps) {
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
  const { config } = video ?? {}
  const { shouldStripMetadata, metadataConfig, convertToExtension } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const updateMetadataField = useCallback(
    (
      field: keyof MediaMetadataConfig,
      value: string | boolean | null | undefined,
    ) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        if (!appProxy.state.media[mediaIndex]?.config?.metadataConfig) {
          appProxy.state.media[mediaIndex].config.metadataConfig = cloneDeep(
            videoMetadataConfigInitialState,
          )
        }
        ;(appProxy.state.media[mediaIndex].config.metadataConfig![
          field
        ] as any) = value

        if (
          field === 'creationTimeRaw' &&
          appProxy.state.media[mediaIndex]?.config?.metadataConfig
        ) {
          appProxy.state.media[mediaIndex].config.metadataConfig![
            'creationTime'
          ] = (value as any)?.toDate?.('')?.toISOString()
        }

        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          if (
            !appProxy.state?.commonConfigForBatchCompression?.videoConfig
              ?.metadataConfig
          ) {
            appProxy.state.commonConfigForBatchCompression.videoConfig.metadataConfig =
              cloneDeep(videoMetadataConfigInitialState)
          }
          ;(appProxy.state.commonConfigForBatchCompression.videoConfig
            .metadataConfig![field] as any) = value

          if (
            field === 'creationTimeRaw' &&
            appProxy.state.commonConfigForBatchCompression?.videoConfig
              ?.metadataConfig
          ) {
            appProxy.state.commonConfigForBatchCompression.videoConfig
              .metadataConfig!['creationTime'] = (value as any)
              ?.toDate?.('')
              ?.toISOString()
          }

          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const handleStripMetadataToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      appProxy.state.media[mediaIndex].config.shouldStripMetadata =
        !appProxy.state.media[mediaIndex].config.shouldStripMetadata
      appProxy.state.media[mediaIndex].isConfigDirty = true

      if (appProxy.state.media[mediaIndex].config.shouldStripMetadata) {
        appProxy.state.media[mediaIndex].config.metadataConfig = null
      } else {
        appProxy.state.media[mediaIndex].config.metadataConfig = cloneDeep(
          videoMetadataConfigInitialState,
        )
      }
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression.videoConfig.shouldStripMetadata =
          !appProxy.state.commonConfigForBatchCompression.videoConfig
            .shouldStripMetadata

        if (
          appProxy.state.commonConfigForBatchCompression.videoConfig
            .shouldStripMetadata
        ) {
          appProxy.state.commonConfigForBatchCompression.videoConfig.metadataConfig =
            null
        } else {
          appProxy.state.commonConfigForBatchCompression.videoConfig.metadataConfig =
            cloneDeep(videoMetadataConfigInitialState)
        }

        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex])

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    convertToExtension === 'gif'

  return (
    <>
      <Switch
        isSelected={shouldStripMetadata}
        onValueChange={handleStripMetadataToggle}
        isDisabled={shouldDisableInput}
      >
        <div className="flex justify-center items-center">
          <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
            移除元数据
          </span>
        </div>
      </Switch>
      <AnimatePresence mode="wait">
        {!shouldStripMetadata ? (
          <Card className="px-2 my-2 pb-4 shadow-none border-1 dark:border-none">
            <motion.div {...slideDownTransition} className="space-y-4 mt-2">
              <div className="text-zinc-700 dark:text-zinc-400">
                <p className="text-xs  italic">- 留空以保留原始信息</p>{' '}
                <p className="text-xs  italic">- 或输入空格以移除原始信息</p>
              </div>
              <div>
                <TextInput
                  type="text"
                  label="标题"
                  placeholder="输入视频标题"
                  value={metadataConfig?.title ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) => updateMetadataField('title', value)}
                  classNames={{ mainWrapper: 'my-3' }}
                />
                <Divider className="mb-6" />
              </div>
              <div>
                <TextInput
                  type="text"
                  label="作者"
                  placeholder="输入作者名称"
                  value={metadataConfig?.artist ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) =>
                    updateMetadataField('artist', value)
                  }
                  classNames={{ mainWrapper: 'my-3' }}
                />
                <Divider className="mb-6" />
              </div>
              <div>
                <TextInput
                  type="text"
                  label="专辑"
                  placeholder="输入专辑名称"
                  value={metadataConfig?.album ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) => updateMetadataField('album', value)}
                  classNames={{ mainWrapper: 'my-3' }}
                />
                <Divider className="mb-6" />
              </div>
              <div>
                <TextInput
                  type="text"
                  label="流派"
                  placeholder="输入流派"
                  value={metadataConfig?.genre ?? ''}
                  isDisabled={shouldDisableInput}
                  classNames={{ mainWrapper: 'my-3' }}
                  onValueChange={(value) => updateMetadataField('genre', value)}
                />
                <Divider className="mb-6" />
              </div>
              <div>
                <TextInput
                  type="text"
                  label="年份/日期"
                  placeholder="输入年份或日期"
                  value={metadataConfig?.year ?? ''}
                  isDisabled={shouldDisableInput}
                  classNames={{ mainWrapper: 'my-3' }}
                  onValueChange={(value) => updateMetadataField('year', value)}
                />
                <Divider className="mb-6" />
              </div>
              <div className="!mt-[-10px]">
                <TextArea
                  type="text"
                  label="描述"
                  placeholder="输入描述"
                  value={metadataConfig?.description ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) =>
                    updateMetadataField('description', value)
                  }
                  className="mb-3"
                />
                <Divider className="mb-6" />
              </div>
              <div className="!mt-[-10px]">
                <TextArea
                  type="text"
                  label="概要"
                  placeholder="输入概要"
                  value={metadataConfig?.synopsis ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) =>
                    updateMetadataField('synopsis', value)
                  }
                  className="mb-3"
                />
                <Divider className="mb-6" />
              </div>
              <div className="!mt-[-10px]">
                <TextArea
                  type="text"
                  label="评论"
                  placeholder="输入评论"
                  value={metadataConfig?.comment ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) =>
                    updateMetadataField('comment', value)
                  }
                  className="mb-3"
                />
                <Divider className="mb-6" />
              </div>
              <div className="!mt-[-10px]">
                <TextArea
                  type="text"
                  label="版权"
                  placeholder="输入版权信息"
                  value={metadataConfig?.copyright ?? ''}
                  isDisabled={shouldDisableInput}
                  onValueChange={(value) =>
                    updateMetadataField('copyright', value)
                  }
                  className="mb-3"
                />
                <Divider className="mb-6" />
              </div>

              <div>
                <div className="flex items-center mt-[-10px]">
                  <Switch
                    isSelected={Boolean(
                      metadataConfig?.shouldEnableCreationTime,
                    )}
                    onValueChange={(isSelected) => {
                      updateMetadataField(
                        'shouldEnableCreationTime',
                        isSelected,
                      )
                    }}
                    className="flex justify-center items-center"
                    isDisabled={shouldDisableInput}
                    size="sm"
                  >
                    <div className="flex justify-center items-center">
                      <span className="text-black1 dark:text-white1 block mr-2 text-xs opacity-90">
                        创建时间
                      </span>
                    </div>
                  </Switch>
                </div>
                {metadataConfig?.shouldEnableCreationTime &&
                metadataConfig?.creationTimeRaw ? (
                  <DatePicker
                    hideTimeZone
                    showMonthAndYearPickers
                    label=""
                    placeholder="输入创建时间"
                    isDisabled={
                      shouldDisableInput ||
                      !metadataConfig?.shouldEnableCreationTime
                    }
                    onChange={(value) => {
                      updateMetadataField('creationTimeRaw', value as any)
                    }}
                    value={metadataConfig?.creationTimeRaw as any}
                    className="mt-2"
                  />
                ) : null}
              </div>
            </motion.div>
          </Card>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default Metadata
