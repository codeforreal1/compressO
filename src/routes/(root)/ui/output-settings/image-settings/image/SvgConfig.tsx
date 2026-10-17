import { AnimatePresence, motion } from 'framer-motion'
import cloneDeep from 'lodash/cloneDeep'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Icon from '@/components/Icon'
import Slider from '@/components/Slider'
import Switch from '@/components/Switch'
import Tooltip from '@/components/Tooltip'
import { useSyncState } from '@/hooks/useSyncState'
import {
  appProxy,
  normalizeBatchMediaConfig,
  svgSettingInitialState,
} from '@/routes/(root)/-state'
import { slideDownTransition } from '@/utils/animation'

type SvgConfigProps = {
  mediaIndex: number
}

const svgSettingInitialStateCloned = cloneDeep(svgSettingInitialState)

function SvgConfig({ mediaIndex }: SvgConfigProps) {
  const { t } = useTranslation()
  const {
    state: {
      isCompressing,
      isProcessCompleted,
      media,
      commonConfigForBatchCompression,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const image =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type == 'image'
      ? media[mediaIndex]
      : null
  const { config } = image ?? {}
  const { svgConfig, shouldEnableAdvancedSvgSetting } =
    config ?? commonConfigForBatchCompression.imageConfig ?? {}

  const createSetter = useCallback(
    <K extends keyof typeof svgSettingInitialStateCloned>(key: K) =>
      (value: (typeof svgSettingInitialStateCloned)[K]) => {
        const targetSvgConfig =
          mediaIndex >= 0 &&
          appProxy.state.media[mediaIndex].type === 'image' &&
          appProxy.state.media[mediaIndex]?.config
            ? appProxy.state.media[mediaIndex].config.svgConfig
            : appProxy.state.media.length > 1
              ? appProxy.state.commonConfigForBatchCompression.imageConfig
                  .svgConfig
              : null

        if (targetSvgConfig) {
          ;(targetSvgConfig as any)[key] = value

          if (
            mediaIndex >= 0 &&
            appProxy.state.media[mediaIndex]?.type === 'image'
          ) {
            appProxy.state.media[mediaIndex].isConfigDirty = true
          } else {
            normalizeBatchMediaConfig()
          }
        }
      },
    [mediaIndex],
  )

  const [filterSpeckle, setFilterSpeckle] = useSyncState({
    globalValue: svgConfig?.filterSpeckle ?? undefined,
    setGlobalValue: createSetter('filterSpeckle'),
    defaultValue: svgSettingInitialStateCloned.filterSpeckle,
    debounceMs: 500,
  })

  const [colorPrecision, setColorPrecision] = useSyncState({
    globalValue: svgConfig?.colorPrecision ?? undefined,
    setGlobalValue: createSetter('colorPrecision'),
    defaultValue: svgSettingInitialStateCloned.colorPrecision,
    debounceMs: 500,
  })

  const [layerDifference, setLayerDifference] = useSyncState({
    globalValue: svgConfig?.layerDifference ?? undefined,
    setGlobalValue: createSetter('layerDifference'),
    defaultValue: svgSettingInitialStateCloned.layerDifference,
    debounceMs: 500,
  })

  const [cornerThreshold, setCornerThreshold] = useSyncState({
    globalValue: svgConfig?.cornerThreshold ?? undefined,
    setGlobalValue: createSetter('cornerThreshold'),
    defaultValue: svgSettingInitialStateCloned.cornerThreshold,
    debounceMs: 500,
  })

  const [lengthThreshold, setLengthThreshold] = useSyncState({
    globalValue: svgConfig?.lengthThreshold ?? undefined,
    setGlobalValue: createSetter('lengthThreshold'),
    defaultValue: svgSettingInitialStateCloned.lengthThreshold,
    debounceMs: 500,
  })

  const [spliceThreshold, setSpliceThreshold] = useSyncState({
    globalValue: svgConfig?.spliceThreshold ?? undefined,
    setGlobalValue: createSetter('spliceThreshold'),
    defaultValue: svgSettingInitialStateCloned.spliceThreshold,
    debounceMs: 500,
  })

  const [isBw, setIsBw] = useSyncState<boolean>({
    globalValue: svgConfig?.isBw ?? undefined,
    setGlobalValue: createSetter('isBw'),
    defaultValue: svgSettingInitialStateCloned.isBw,
  })

  const handleAdvancedSwitchSettingsToggle = useCallback(
    (isSelected: boolean) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'image' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.shouldEnableAdvancedSvgSetting =
          isSelected

        if (!isSelected) {
          appProxy.state.media[mediaIndex].config.svgConfig = cloneDeep(
            svgSettingInitialStateCloned,
          )
        }
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression.imageConfig.shouldEnableAdvancedSvgSetting =
            isSelected

          if (!isSelected) {
            appProxy.state.commonConfigForBatchCompression.imageConfig.svgConfig =
              cloneDeep(svgSettingInitialStateCloned)
          }
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  return (
    <div className="space-y-4">
      <Switch
        isSelected={shouldEnableAdvancedSvgSetting}
        onValueChange={handleAdvancedSwitchSettingsToggle}
        isDisabled={shouldDisableInput}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          {t('svg.advanced')}
        </p>
      </Switch>

      <AnimatePresence initial={false}>
        {shouldEnableAdvancedSvgSetting ? (
          <motion.div {...slideDownTransition} className="pb-2">
            {/* The card is inside the animated element, so its padding & border collapse with it */}
            <div className="p-3 bg-default-50 rounded-xl border border-default-200 dark:border-default-100">
              <div className="mt-2">
                <Slider
                  label={
                    <div className="flex items-center gap-1">
                      {t('svg.filterSpeckle.title')}
                      <Tooltip content={t('svg.filterSpeckle.tooltip')}>
                        <Icon
                          name="info"
                          size={20}
                          className="text-gray-400 dark:text-gray-500"
                        />
                      </Tooltip>
                    </div>
                  }
                  aria-label={t('svg.filterSpeckle.title')}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 128, label: '128' },
                  ]}
                  minValue={0}
                  maxValue={128}
                  className="mb-6 mt-1 mx-auto"
                  classNames={{
                    mark: 'text-[11px] mt-2',
                    base: 'mt-[-10px]',
                    label: 'text-xs',
                  }}
                  getValue={(value) => {
                    const val = Array.isArray(value) ? value?.[0] : +value
                    return val < 50
                      ? t('svg.levels.low')
                      : val >= 50 && val < 100
                        ? t('svg.levels.medium')
                        : t('svg.levels.high')
                  }}
                  renderValue={() => (
                    <p className="text-primary text-xs">{filterSpeckle}</p>
                  )}
                  value={filterSpeckle}
                  onChange={(value) => {
                    if (typeof value === 'number') {
                      setFilterSpeckle(value)
                    }
                  }}
                  isDisabled={shouldDisableInput}
                />
              </div>

              <div>
                <Slider
                  label={
                    <div className="flex items-center gap-1">
                      {t('svg.colorPrecision.title')}
                      <Tooltip content={t('svg.colorPrecision.tooltip')}>
                        <Icon
                          name="info"
                          size={20}
                          className="text-gray-400 dark:text-gray-500"
                        />
                      </Tooltip>
                    </div>
                  }
                  aria-label={t('svg.colorPrecision.title')}
                  marks={[
                    { value: 1, label: '1' },
                    { value: 8, label: '8' },
                  ]}
                  minValue={1}
                  maxValue={8}
                  step={1}
                  className="mb-6 mt-1 mx-auto"
                  classNames={{
                    mark: 'text-[11px] mt-2',
                    base: 'mt-[-10px]',
                    label: 'text-xs',
                  }}
                  getValue={(value) => {
                    const val = Array.isArray(value) ? value?.[0] : +value
                    return val < 4
                      ? t('svg.levels.low')
                      : val >= 4 && val < 7
                        ? t('svg.levels.medium')
                        : t('svg.levels.high')
                  }}
                  renderValue={() => (
                    <p className="text-primary text-xs">{colorPrecision}</p>
                  )}
                  value={colorPrecision}
                  onChange={(value) => {
                    if (typeof value === 'number') {
                      setColorPrecision(value)
                    }
                  }}
                  isDisabled={shouldDisableInput}
                />
              </div>

              <div>
                <Slider
                  label={
                    <div className="flex items-center gap-1">
                      {t('svg.layerDifference.title')}
                      <Tooltip content={t('svg.layerDifference.tooltip')}>
                        <Icon
                          name="info"
                          size={20}
                          className="text-gray-400 dark:text-gray-500"
                        />
                      </Tooltip>
                    </div>
                  }
                  aria-label={t('svg.layerDifference.title')}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 128, label: '128' },
                  ]}
                  minValue={0}
                  maxValue={128}
                  className="mb-6 mt-1 mx-auto"
                  classNames={{
                    mark: 'text-[11px] mt-2',
                    base: 'mt-[-10px]',
                    label: 'text-xs',
                  }}
                  getValue={(value) => {
                    const val = Array.isArray(value) ? value?.[0] : +value
                    return val < 50
                      ? t('svg.levels.few')
                      : val >= 50 && val < 100
                        ? t('svg.levels.medium')
                        : t('svg.levels.many')
                  }}
                  renderValue={() => (
                    <p className="text-primary text-xs">{layerDifference}</p>
                  )}
                  value={layerDifference}
                  onChange={(value) => {
                    if (typeof value === 'number') {
                      setLayerDifference(value)
                    }
                  }}
                  isDisabled={shouldDisableInput}
                />
              </div>

              <div>
                <Slider
                  label={
                    <div className="flex items-center gap-1">
                      {t('svg.cornerThreshold.title')}
                      <Tooltip content={t('svg.cornerThreshold.tooltip')}>
                        <Icon
                          name="info"
                          size={20}
                          className="text-gray-400 dark:text-gray-500"
                        />
                      </Tooltip>
                    </div>
                  }
                  aria-label={t('svg.cornerThreshold.title')}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 180, label: '180' },
                  ]}
                  minValue={0}
                  maxValue={180}
                  className="mb-6 mt-1 mx-auto"
                  classNames={{
                    mark: 'text-[11px] mt-2',
                    base: 'mt-[-10px]',
                    label: 'text-xs',
                  }}
                  getValue={(value) => {
                    const val = Array.isArray(value) ? value?.[0] : +value
                    return val < 60
                      ? t('svg.levels.sharp')
                      : val >= 60 && val < 120
                        ? t('svg.levels.medium')
                        : t('svg.levels.smooth')
                  }}
                  renderValue={() => (
                    <p className="text-primary text-xs">{cornerThreshold}</p>
                  )}
                  value={cornerThreshold}
                  onChange={(value) => {
                    if (typeof value === 'number') {
                      setCornerThreshold(value)
                    }
                  }}
                  isDisabled={shouldDisableInput}
                />
              </div>

              <div>
                <Slider
                  label={
                    <div className="flex items-center gap-1">
                      {t('svg.segmentLength.title')}
                      <Tooltip content={t('svg.segmentLength.tooltip')}>
                        <Icon
                          name="info"
                          size={20}
                          className="text-gray-400 dark:text-gray-500"
                        />
                      </Tooltip>
                    </div>
                  }
                  aria-label={t('svg.segmentLength.title')}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 10, label: '10' },
                  ]}
                  minValue={0}
                  maxValue={10}
                  step={0.5}
                  className="mb-6 mt-1 mx-auto"
                  classNames={{
                    mark: 'text-[11px] mt-2',
                    base: 'mt-[-10px]',
                    label: 'text-xs',
                  }}
                  getValue={(value) => {
                    const val = Array.isArray(value) ? value?.[0] : +value
                    return val < 3
                      ? t('svg.levels.fine')
                      : val >= 3 && val < 7
                        ? t('svg.levels.medium')
                        : t('svg.levels.coarse')
                  }}
                  renderValue={() => (
                    <p className="text-primary text-xs">{lengthThreshold}</p>
                  )}
                  value={lengthThreshold}
                  onChange={(value) => {
                    if (typeof value === 'number') {
                      setLengthThreshold(value)
                    }
                  }}
                  isDisabled={shouldDisableInput}
                />
              </div>

              <div>
                <Slider
                  label={
                    <div className="flex items-center gap-1">
                      {t('svg.spliceThreshold.title')}
                      <Tooltip content={t('svg.spliceThreshold.tooltip')}>
                        <Icon
                          name="info"
                          size={20}
                          className="text-gray-400 dark:text-gray-500"
                        />
                      </Tooltip>
                    </div>
                  }
                  aria-label={t('svg.spliceThreshold.title')}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 180, label: '180' },
                  ]}
                  minValue={0}
                  maxValue={180}
                  className="mb-6 mt-1 mx-auto"
                  classNames={{
                    mark: 'text-[11px] mt-2',
                    base: 'mt-[-10px]',
                    label: 'text-xs',
                  }}
                  getValue={(value) => {
                    const val = Array.isArray(value) ? value?.[0] : +value
                    return val < 60
                      ? t('svg.levels.accurate')
                      : val >= 60 && val < 120
                        ? t('svg.levels.medium')
                        : t('svg.levels.less')
                  }}
                  renderValue={() => (
                    <p className="text-primary text-xs">{spliceThreshold}</p>
                  )}
                  value={spliceThreshold}
                  onChange={(value) => {
                    if (typeof value === 'number') {
                      setSpliceThreshold(value)
                    }
                  }}
                  isDisabled={shouldDisableInput}
                />
              </div>
              <Switch
                isSelected={isBw}
                onValueChange={setIsBw}
                isDisabled={shouldDisableInput}
              >
                <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
                  {t('svg.blackAndWhite')}
                </p>
              </Switch>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export default SvgConfig
