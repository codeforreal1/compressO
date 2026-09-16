import { AutocompleteItem } from '@heroui/react'
import { open } from '@tauri-apps/plugin-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { useSnapshot } from 'valtio'

import Autocomplete from '@/components/AutoComplete'
import Button from '@/components/Button'
import Card from '@/components/Card'
import Icon from '@/components/Icon'
import Switch from '@/components/Switch'
import {
  slideDownStaggerAnimation,
  slideDownTransition,
} from '@/utils/animation'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

type SubtitlesProps = {
  mediaIndex: number
}

const SUBTITLE_EXTENSIONS = ['srt']

type Subtitle = { code: string; name: string }
const LANGUAGE_OPTIONS: Subtitle[] = [
  { code: 'afr', name: '南非荷兰语' },
  { code: 'sqi', name: '阿尔巴尼亚语' },
  { code: 'amh', name: '阿姆哈拉语' },
  { code: 'ara', name: '阿拉伯语' },
  { code: 'hye', name: '亚美尼亚语' },
  { code: 'asm', name: '阿萨姆语' },
  { code: 'aze', name: '阿塞拜疆语' },
  { code: 'bam', name: '班巴拉语' },
  { code: 'ben', name: '孟加拉语' },
  { code: 'bul', name: '保加利亚语' },
  { code: 'bur', name: '缅甸语' },
  { code: 'cat', name: '加泰罗尼亚语' },
  { code: 'ceb', name: '宿务语' },
  { code: 'ces', name: '捷克语' },
  { code: 'chi', name: '中文' },
  { code: 'zul', name: '祖鲁语' },
  { code: 'yor', name: '约鲁巴语' },
  { code: 'xho', name: '科萨语' },
  { code: 'wol', name: '沃洛夫语' },
  { code: 'wel', name: '威尔士语' },
  { code: 'uzb', name: '乌兹别克语' },
  { code: 'ukr', name: '乌克兰语' },
  { code: 'tur', name: '土耳其语' },
  { code: 'tmh', name: '塔马舍克语' },
  { code: 'tgl', name: '他加禄语' },
  { code: 'taj', name: '塔吉克语' },
  { code: 'tam', name: '泰米尔语' },
  { code: 'tel', name: '泰卢固语' },
  { code: 'tha', name: '泰语' },
  { code: 'tir', name: '提格雷尼亚语' },
  { code: 'ton', name: '汤加语' },
  { code: 'tsn', name: '茨瓦纳语' },
  { code: 'tso', name: '聪加语' },
  { code: 'tuk', name: '土库曼语' },
  { code: 'twi', name: '特威语' },
  { code: 'sag', name: '桑戈语' },
  { code: 'san', name: '梵语' },
  { code: 'sin', name: '僧伽罗语' },
  { code: 'slk', name: '斯洛伐克语' },
  { code: 'slv', name: '斯洛文尼亚语' },
  { code: 'sme', name: '北萨米语' },
  { code: 'smo', name: '萨摩亚语' },
  { code: 'sna', name: '修纳语' },
  { code: 'snd', name: '信德语' },
  { code: 'som', name: '索马里语' },
  { code: 'sot', name: '南索托语' },
  { code: 'spa', name: '西班牙语' },
  { code: 'srp', name: '塞尔维亚语' },
  { code: 'swa', name: '斯瓦希里语' },
  { code: 'swe', name: '瑞典语' },
  { code: 'rus', name: '俄语' },
  { code: 'ron', name: '罗马尼亚语' },
  { code: 'run', name: '基隆迪语' },
  { code: 'que', name: '克丘亚语' },
  { code: 'pus', name: '普什图语' },
  { code: 'pan', name: '旁遮普语' },
  { code: 'pol', name: '波兰语' },
  { code: 'por', name: '葡萄牙语' },
  { code: 'pra', name: '普拉克里特语' },
  { code: 'pes', name: '波斯语' },
  { code: 'oci', name: '奥克语' },
  { code: 'ori', name: '奥里亚语' },
  { code: 'nya', name: '尼扬贾语' },
  { code: 'nep', name: '尼泊尔语' },
  { code: 'nld', name: '荷兰语' },
  { code: 'nor', name: '挪威语' },
  { code: 'nno', name: '新挪威语' },
  { code: 'mar', name: '马拉地语' },
  { code: 'mkd', name: '马其顿语' },
  { code: 'mal', name: '马拉雅拉姆语' },
  { code: 'mon', name: '蒙古语' },
  { code: 'mlt', name: '马耳他语' },
  { code: 'msa', name: '马来语' },
  { code: 'lao', name: '老挝语' },
  { code: 'lat', name: '拉丁语' },
  { code: 'lav', name: '拉脱维亚语' },
  { code: 'lin', name: '林加拉语' },
  { code: 'lit', name: '立陶宛语' },
  { code: 'lub', name: '卢巴-加丹加语' },
  { code: 'lug', name: '卢干达语' },
  { code: 'kur', name: '库尔德语' },
  { code: 'kan', name: '卡纳达语' },
  { code: 'kor', name: '韩语' },
  { code: 'kau', name: '卡努里语' },
  { code: 'kaz', name: '哈萨克语' },
  { code: 'khm', name: '高棉语' },
  { code: 'kik', name: '基库尤语' },
  { code: 'kin', name: '基尼亚卢旺达语' },
  { code: 'kir', name: '吉尔吉斯语' },
  { code: 'kom', name: '科米语' },
  { code: 'kon', name: '刚果语' },
  { code: 'jpn', name: '日语' },
  { code: 'jav', name: '爪哇语' },
  { code: 'ibo', name: '伊博语' },
  { code: 'ido', name: '伊多语' },
  { code: 'ind', name: '印尼语' },
  { code: 'ina', name: '国际语' },
  { code: 'ile', name: '国际语E' },
  { code: 'iku', name: '因纽特语' },
  { code: 'ipk', name: '因纽皮亚特语' },
  { code: 'gle', name: '爱尔兰语' },
  { code: 'ita', name: '意大利语' },
  { code: 'jpr', name: '犹太-波斯语' },
  { code: 'geo', name: '格鲁吉亚语' },
  { code: 'deu', name: '德语' },
  { code: 'grn', name: '瓜拉尼语' },
  { code: 'guj', name: '古吉拉特语' },
  { code: 'gla', name: '苏格兰盖尔语' },
  { code: 'fra', name: '法语' },
  { code: 'fin', name: '芬兰语' },
  { code: 'fao', name: '法罗语' },
  { code: 'fas', name: '波斯语' },
  { code: 'fij', name: '斐济语' },
  { code: 'est', name: '爱沙尼亚语' },
  { code: 'eus', name: '巴斯克语' },
  { code: 'ewe', name: '埃维语' },
  { code: 'dzo', name: '宗喀语' },
  { code: 'eng', name: '英语' },
  { code: 'ell', name: '希腊语' },
  { code: 'dan', name: '丹麦语' },
  { code: 'dak', name: '达科他语' },
  { code: 'cze', name: '捷克语' },
  { code: 'crh', name: '克里米亚鞑靼语' },
  { code: 'hrv', name: '克罗地亚语' },
  { code: 'hun', name: '匈牙利语' },
  { code: 'hat', name: '海地语' },
  { code: 'hau', name: '豪萨语' },
  { code: 'heb', name: '希伯来语' },
  { code: 'her', name: '赫雷罗语' },
  { code: 'hin', name: '印地语' },
  { code: 'hmo', name: '希里莫图语' },
  { code: 'hil', name: '希利盖农语' },
  { code: 'isl', name: '冰岛语' },
  { code: 'iii', name: '四川彝语' },
  { code: 'kal', name: '格陵兰语' },
  { code: 'kas', name: '克什米尔语' },
  { code: 'kua', name: '宽亚玛语' },
  { code: 'lim', name: '林堡语' },
  { code: 'ltz', name: '卢森堡语' },
  { code: 'luo', name: '卢奥语' },
  { code: 'und', name: '未知' },
]

function Subtitles({ mediaIndex }: SubtitlesProps) {
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
  const { subtitlesConfig, convertToExtension } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const subtitles = subtitlesConfig?.subtitles ?? []
  const shouldEnableSubtitles = subtitlesConfig?.shouldEnableSubtitles ?? false
  const preserveExistingSubtitles =
    subtitlesConfig?.preserveExistingSubtitles ?? false

  const handleToggleChange = useCallback(
    (isSelected: boolean) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        if (!appProxy.state.media[mediaIndex].config.subtitlesConfig) {
          appProxy.state.media[mediaIndex].config.subtitlesConfig = {
            subtitles: [],
            shouldEnableSubtitles: isSelected,
            preserveExistingSubtitles: false,
          }
        } else {
          appProxy.state.media[mediaIndex].config
            .subtitlesConfig!.shouldEnableSubtitles = isSelected
        }
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          if (
            !appProxy.state.commonConfigForBatchCompression.videoConfig
              .subtitlesConfig
          ) {
            appProxy.state.commonConfigForBatchCompression.videoConfig.subtitlesConfig =
              {
                subtitles: [],
                shouldEnableSubtitles: isSelected,
                preserveExistingSubtitles: false,
              }
          } else {
            appProxy.state.commonConfigForBatchCompression.videoConfig
              .subtitlesConfig!.shouldEnableSubtitles = isSelected
          }
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const handlePreserveExistingChange = useCallback(
    (isSelected: boolean) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        if (!appProxy.state.media[mediaIndex].config.subtitlesConfig) {
          appProxy.state.media[mediaIndex].config.subtitlesConfig = {
            subtitles: [],
            shouldEnableSubtitles: true,
            preserveExistingSubtitles: isSelected,
          }
        } else {
          appProxy.state.media[mediaIndex].config
            .subtitlesConfig!.preserveExistingSubtitles = isSelected
        }
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          if (
            !appProxy.state.commonConfigForBatchCompression.videoConfig
              .subtitlesConfig
          ) {
            appProxy.state.commonConfigForBatchCompression.videoConfig.subtitlesConfig =
              {
                subtitles: [],
                shouldEnableSubtitles: true,
                preserveExistingSubtitles: isSelected,
              }
          } else {
            appProxy.state.commonConfigForBatchCompression.videoConfig
              .subtitlesConfig!.preserveExistingSubtitles = isSelected
          }
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const handleAddSubtitle = useCallback(async () => {
    try {
      const filePath = await open({
        directory: false,
        multiple: false,
        title: '选择字幕文件 (SRT)',
        filters: [
          {
            name: '字幕',
            extensions: SUBTITLE_EXTENSIONS,
          },
        ],
      })
      if (typeof filePath === 'string') {
        const fileName = filePath.split(/[/\\]/).pop() ?? null
        const newSubtitle = {
          subtitlePath: filePath,
          language: 'eng',
          title: '英语',
          fileName,
        }
        if (
          mediaIndex >= 0 &&
          appProxy.state.media[mediaIndex].type === 'video' &&
          appProxy.state.media[mediaIndex]?.config
        ) {
          if (!appProxy.state.media[mediaIndex].config.subtitlesConfig) {
            appProxy.state.media[mediaIndex].config.subtitlesConfig = {
              subtitles: [],
              shouldEnableSubtitles: true,
              preserveExistingSubtitles: false,
            }
          }
          appProxy.state.media[
            mediaIndex
          ].config.subtitlesConfig!.subtitles.push(newSubtitle)
          appProxy.state.media[mediaIndex].isConfigDirty = true
        } else {
          if (appProxy.state.media.length > 1) {
            if (
              !appProxy.state.commonConfigForBatchCompression.videoConfig
                .subtitlesConfig
            ) {
              appProxy.state.commonConfigForBatchCompression.videoConfig.subtitlesConfig =
                {
                  subtitles: [],
                  shouldEnableSubtitles: true,
                  preserveExistingSubtitles: false,
                }
            }
            appProxy.state.commonConfigForBatchCompression.videoConfig.subtitlesConfig!.subtitles.push(
              newSubtitle,
            )
            normalizeBatchMediaConfig()
          }
        }
      }
    } catch (error: any) {
      toast.error(error?.message ?? '无法选择字幕文件。')
    }
  }, [mediaIndex])

  const handleRemoveSubtitle = useCallback(
    (index: number) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        if (appProxy.state.media[mediaIndex].config.subtitlesConfig) {
          appProxy.state.media[
            mediaIndex
          ].config.subtitlesConfig!.subtitles.splice(index, 1)
          appProxy.state.media[mediaIndex].isConfigDirty = true
        }
      } else {
        if (appProxy.state.media.length > 1) {
          if (
            appProxy.state.commonConfigForBatchCompression.videoConfig
              .subtitlesConfig
          ) {
            appProxy.state.commonConfigForBatchCompression.videoConfig.subtitlesConfig!.subtitles.splice(
              index,
              1,
            )
            normalizeBatchMediaConfig()
          }
        }
      }
    },
    [mediaIndex],
  )

  const handleLanguageChange = useCallback(
    (index: number, languageCode: string) => {
      const languageValue = languageCode === 'und' ? '' : languageCode
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        if (appProxy.state.media[mediaIndex].config.subtitlesConfig) {
          appProxy.state.media[mediaIndex].config.subtitlesConfig!.subtitles[
            index
          ].language = languageValue
          appProxy.state.media[mediaIndex].config.subtitlesConfig!.subtitles[
            index
          ].title =
            LANGUAGE_OPTIONS.find((lang) => lang.code === languageCode)?.name ??
            undefined
          appProxy.state.media[mediaIndex].isConfigDirty = true
        }
      } else {
        if (appProxy.state.media.length > 1) {
          if (
            appProxy.state.commonConfigForBatchCompression.videoConfig
              .subtitlesConfig
          ) {
            appProxy.state.commonConfigForBatchCompression.videoConfig
              .subtitlesConfig!.subtitles[index].language = languageValue
            normalizeBatchMediaConfig()
          }
        }
      }
    },
    [mediaIndex],
  )

  const getDisplayLanguageCode = (code: string) => {
    return code === '' ? 'und' : code
  }

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    convertToExtension === 'gif'

  const isUnsupported = convertToExtension === 'avi'

  return (
    <>
      <div>
        <div className="flex items-center">
          <Switch
            isSelected={shouldEnableSubtitles}
            onValueChange={handleToggleChange}
            className="flex justify-center items-center"
            isDisabled={shouldDisableInput}
            size="sm"
          >
            <div className="flex justify-center items-center">
              <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
                字幕
              </span>
            </div>
          </Switch>
        </div>
        {shouldEnableSubtitles ? (
          <Card className="px-2 my-2 pb-4 shadow-none border-1 dark:border-none">
            <motion.div {...slideDownTransition} className="mt-2">
              <div className="flex items-center gap-2 mb-3">
                <Switch
                  isSelected={preserveExistingSubtitles}
                  onValueChange={handlePreserveExistingChange}
                  isDisabled={shouldDisableInput}
                  size="sm"
                >
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    保留已有字幕
                  </span>
                </Switch>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  variants={slideDownStaggerAnimation.container}
                  initial="hidden"
                  animate="show"
                  exit="hidden"
                >
                  {subtitles.map((subtitle, index) => (
                    <motion.div
                      key={`${subtitle.subtitlePath}-${index}`}
                      layout
                      variants={slideDownStaggerAnimation.item}
                      className="mb-2 p-3 bg-default-50 rounded-xl border border-default-200 dark:border-default-100"
                    >
                      <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate mb-2 text-center">
                        {subtitle.fileName || `字幕 ${index + 1}`}
                      </div>
                      <div className="flex items-center justify-center gap-2">
                        <div className="flex-1 min-w-0">
                          <Autocomplete
                            fullWidth
                            label="语言"
                            size="sm"
                            defaultItems={LANGUAGE_OPTIONS}
                            defaultSelectedKey={getDisplayLanguageCode(
                              subtitle.language ?? 'eng',
                            )}
                            onSelectionChange={(key) => {
                              handleLanguageChange(index, key as string)
                            }}
                            isDisabled={shouldDisableInput || isUnsupported}
                            classNames={{
                              listboxWrapper: 'flex-1',
                            }}
                          >
                            {(lang) => {
                              const language = lang as Subtitle
                              return (
                                <AutocompleteItem
                                  key={language.code}
                                  textValue={language.name}
                                >
                                  {language.name}
                                </AutocompleteItem>
                              )
                            }}
                          </Autocomplete>
                        </div>
                        <Button
                          type="button"
                          onPress={() => handleRemoveSubtitle(index)}
                          size="sm"
                          isDisabled={shouldDisableInput || isUnsupported}
                          color="danger"
                          isIconOnly
                          className="self-end"
                        >
                          <Icon name="cross" size={20} />
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              </AnimatePresence>

              <Button
                type="button"
                onPress={handleAddSubtitle}
                fullWidth
                size="sm"
                isDisabled={shouldDisableInput || isUnsupported}
                className="mt-2"
              >
                添加字幕
                <Icon name="fileExplorer" size={14} />
              </Button>

              {isUnsupported ? (
                <p className="text-xs italic text-danger-300 mt-2">
                  {convertToExtension} 不支持软字幕
                </p>
              ) : null}
            </motion.div>
          </Card>
        ) : null}
      </div>
    </>
  )
}

export default Subtitles
