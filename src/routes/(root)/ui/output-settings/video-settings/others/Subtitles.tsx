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
  { code: 'afr', name: 'Afrikaans' },
  { code: 'sqi', name: 'Albanian' },
  { code: 'amh', name: 'Amharic' },
  { code: 'ara', name: 'Arabic' },
  { code: 'hye', name: 'Armenian' },
  { code: 'asm', name: 'Assamese' },
  { code: 'aze', name: 'Azerbaijani' },
  { code: 'bam', name: 'Bambara' },
  { code: 'ben', name: 'Bengali' },
  { code: 'bul', name: 'Bulgarian' },
  { code: 'bur', name: 'Burmese' },
  { code: 'cat', name: 'Catalan' },
  { code: 'ceb', name: 'Cebuano' },
  { code: 'ces', name: 'Czech' },
  { code: 'chi', name: 'Chinese' },
  { code: 'zul', name: 'Zulu' },
  { code: 'yor', name: 'Yoruba' },
  { code: 'xho', name: 'Xhosa' },
  { code: 'wol', name: 'Wolof' },
  { code: 'wel', name: 'Welsh' },
  { code: 'uzb', name: 'Uzbek' },
  { code: 'ukr', name: 'Ukrainian' },
  { code: 'tur', name: 'Turkish' },
  { code: 'tmh', name: 'Tamashek' },
  { code: 'tgl', name: 'Tagalog' },
  { code: 'taj', name: 'Tajik' },
  { code: 'tam', name: 'Tamil' },
  { code: 'tel', name: 'Telugu' },
  { code: 'tha', name: 'Thai' },
  { code: 'tir', name: 'Tigrinya' },
  { code: 'ton', name: 'Tonga' },
  { code: 'tsn', name: 'Tswana' },
  { code: 'tso', name: 'Tsonga' },
  { code: 'tuk', name: 'Turkmen' },
  { code: 'twi', name: 'Twi' },
  { code: 'sag', name: 'Sango' },
  { code: 'san', name: 'Sanskrit' },
  { code: 'sin', name: 'Sinhala' },
  { code: 'slk', name: 'Slovak' },
  { code: 'slv', name: 'Slovenian' },
  { code: 'sme', name: 'Northern Sami' },
  { code: 'smo', name: 'Samoan' },
  { code: 'sna', name: 'Shona' },
  { code: 'snd', name: 'Sindhi' },
  { code: 'som', name: 'Somali' },
  { code: 'sot', name: 'Southern Sotho' },
  { code: 'spa', name: 'Spanish' },
  { code: 'srp', name: 'Serbian' },
  { code: 'swa', name: 'Swahili' },
  { code: 'swe', name: 'Swedish' },
  { code: 'rus', name: 'Russian' },
  { code: 'ron', name: 'Romanian' },
  { code: 'run', name: 'Rundi' },
  { code: 'que', name: 'Quechua' },
  { code: 'pus', name: 'Pashto' },
  { code: 'pan', name: 'Punjabi' },
  { code: 'pol', name: 'Polish' },
  { code: 'por', name: 'Portuguese' },
  { code: 'pra', name: 'Prakrit' },
  { code: 'pes', name: 'Persian' },
  { code: 'oci', name: 'Occitan' },
  { code: 'ori', name: 'Oriya' },
  { code: 'nya', name: 'Nyanja' },
  { code: 'nep', name: 'Nepali' },
  { code: 'nld', name: 'Dutch' },
  { code: 'nor', name: 'Norwegian' },
  { code: 'nno', name: 'Norwegian Nynorsk' },
  { code: 'mar', name: 'Marathi' },
  { code: 'mkd', name: 'Macedonian' },
  { code: 'mal', name: 'Malayalam' },
  { code: 'mon', name: 'Mongolian' },
  { code: 'mlt', name: 'Maltese' },
  { code: 'msa', name: 'Malay' },
  { code: 'lao', name: 'Lao' },
  { code: 'lat', name: 'Latin' },
  { code: 'lav', name: 'Latvian' },
  { code: 'lin', name: 'Lingala' },
  { code: 'lit', name: 'Lithuanian' },
  { code: 'lub', name: 'Luba-Katanga' },
  { code: 'lug', name: 'Ganda' },
  { code: 'kur', name: 'Kurdish' },
  { code: 'kan', name: 'Kannada' },
  { code: 'kor', name: 'Korean' },
  { code: 'kau', name: 'Kanuri' },
  { code: 'kaz', name: 'Kazakh' },
  { code: 'khm', name: 'Khmer' },
  { code: 'kik', name: 'Kikuyu' },
  { code: 'kin', name: 'Kinyarwanda' },
  { code: 'kir', name: 'Kyrgyz' },
  { code: 'kom', name: 'Komi' },
  { code: 'kon', name: 'Kongo' },
  { code: 'jpn', name: 'Japanese' },
  { code: 'jav', name: 'Javanese' },
  { code: 'ibo', name: 'Igbo' },
  { code: 'ido', name: 'Ido' },
  { code: 'ind', name: 'Indonesian' },
  { code: 'ina', name: 'Interlingua' },
  { code: 'ile', name: 'Interlingue' },
  { code: 'iku', name: 'Inuktitut' },
  { code: 'ipk', name: 'Inupiaq' },
  { code: 'gle', name: 'Irish' },
  { code: 'ita', name: 'Italian' },
  { code: 'jpr', name: 'Judeo-Persian' },
  { code: 'geo', name: 'Georgian' },
  { code: 'deu', name: 'German' },
  { code: 'grn', name: 'Guarani' },
  { code: 'guj', name: 'Gujarati' },
  { code: 'gla', name: 'Scottish Gaelic' },
  { code: 'fra', name: 'French' },
  { code: 'fin', name: 'Finnish' },
  { code: 'fao', name: 'Faroese' },
  { code: 'fas', name: 'Persian (Farsi)' },
  { code: 'fij', name: 'Fijian' },
  { code: 'est', name: 'Estonian' },
  { code: 'eus', name: 'Basque' },
  { code: 'ewe', name: 'Ewe' },
  { code: 'dzo', name: 'Dzongkha' },
  { code: 'eng', name: 'English' },
  { code: 'ell', name: 'Greek' },
  { code: 'dan', name: 'Danish' },
  { code: 'dak', name: 'Dakota' },
  { code: 'cze', name: 'Czech' },
  { code: 'crh', name: 'Crimean Tatar' },
  { code: 'hrv', name: 'Croatian' },
  { code: 'hun', name: 'Hungarian' },
  { code: 'hat', name: 'Haitian' },
  { code: 'hau', name: 'Hausa' },
  { code: 'heb', name: 'Hebrew' },
  { code: 'her', name: 'Herero' },
  { code: 'hin', name: 'Hindi' },
  { code: 'hmo', name: 'Hiri Motu' },
  { code: 'hil', name: 'Hiligaynon' },
  { code: 'isl', name: 'Icelandic' },
  { code: 'iii', name: 'Sichuan Yi' },
  { code: 'kal', name: 'Kalaallisut' },
  { code: 'kas', name: 'Kashmiri' },
  { code: 'kua', name: 'Kuanyama' },
  { code: 'lim', name: 'Limburgish' },
  { code: 'ltz', name: 'Luxembourgish' },
  { code: 'luo', name: 'Luo' },
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
        title: '选择字幕文件（SRT）',
        filters: [
          {
            name: 'subtitle',
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
                    保留现有字幕
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
                        {subtitle.fileName || `Subtitle ${index + 1}`}
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
