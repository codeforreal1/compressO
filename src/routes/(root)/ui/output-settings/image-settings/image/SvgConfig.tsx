import { motion } from 'framer-motion'
import cloneDeep from 'lodash/cloneDeep'
import { useCallback } from 'react'
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
          高级 SVG 设置
        </p>
      </Switch>

      {shouldEnableAdvancedSvgSetting ? (
        <motion.div
          {...slideDownTransition}
          className="mb-2 p-3 bg-default-50 rounded-xl border border-default-200 dark:border-default-100"
        >
          <div className="mt-2">
            <Slider
              label={
                <div className="flex items-center gap-1">
                  斑点过滤
                  <Tooltip content="数值越高，图像越干净、平滑">
                    <Icon
                      name="info"
                      size={20}
                      className="text-gray-400 dark:text-gray-500"
                    />
                  </Tooltip>
                </div>
              }
              aria-label="斑点过滤"
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
                return val < 50 ? '低' : val >= 50 && val < 100 ? '中' : '高'
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
                  颜色精度
                  <Tooltip content="数值越高，精度越高，但可能会过度饱和">
                    <Icon
                      name="info"
                      size={20}
                      className="text-gray-400 dark:text-gray-500"
                    />
                  </Tooltip>
                </div>
              }
              aria-label="颜色精度"
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
                return val < 4 ? '低' : val >= 4 && val < 7 ? '中' : '高'
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
                  图层差异
                  <Tooltip content="数值越高，图层越少">
                    <Icon
                      name="info"
                      size={20}
                      className="text-gray-400 dark:text-gray-500"
                    />
                  </Tooltip>
                </div>
              }
              aria-label="图层差异"
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
                return val < 50 ? '少' : val >= 50 && val < 100 ? '中' : '多'
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
                  角点阈值
                  <Tooltip content="数值越高，图像越平滑">
                    <Icon
                      name="info"
                      size={20}
                      className="text-gray-400 dark:text-gray-500"
                    />
                  </Tooltip>
                </div>
              }
              aria-label="角点阈值"
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
                  ? '锐利'
                  : val >= 60 && val < 120
                    ? '中'
                    : '平滑'
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
                  段长度
                  <Tooltip content="数值越高，结果越粗糙">
                    <Icon
                      name="info"
                      size={20}
                      className="text-gray-400 dark:text-gray-500"
                    />
                  </Tooltip>
                </div>
              }
              aria-label="段长度"
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
                return val < 3 ? '细' : val >= 3 && val < 7 ? '中' : '粗'
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
                  拼接阈值
                  <Tooltip content="数值越高，精度越低">
                    <Icon
                      name="info"
                      size={20}
                      className="text-gray-400 dark:text-gray-500"
                    />
                  </Tooltip>
                </div>
              }
              aria-label="拼接阈值"
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
                return val < 60 ? '准确' : val >= 60 && val < 120 ? '中' : '低'
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
              黑白
            </p>
          </Switch>
        </motion.div>
      ) : null}
    </div>
  )
}

export default SvgConfig
