import { SelectItem } from '@heroui/react'
import { useSnapshot } from 'valtio'

import Select from '@/components/Select'
import {
  type BatchResolution as BatchResolutionKey,
  batchResolutions,
} from '@/types/compression'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'

const RESOLUTION_LABELS: Record<keyof typeof batchResolutions, string> = {
  original: 'Original',
  '480p': '480p',
  '720p': '720p',
  '1080p': '1080p',
  '2k': '2K',
  '4k': '4K',
}

/**
 * Resolution for all videos of a batch (the per-video dimensions need a single video's size). Each
 * video's longer side (the width of a landscape video, the height of a portrait one) is scaled to
 * the resolution, keeping its aspect ratio; smaller videos are upscaled. Videos with their own
 * custom dimensions keep those.
 */
function BatchResolution() {
  const {
    state: {
      isCompressing,
      isProcessCompleted,
      isLoadingMediaFiles,
      commonConfigForBatchCompression,
    },
  } = useSnapshot(appProxy)
  const batchConfigKey = useBatchVideoConfigKey()
  const batchResolution =
    commonConfigForBatchCompression[batchConfigKey].batchResolution ??
    'original'
  // A size that is not listed (from a preset, e.g. `1700px`) is shown as an extra option
  const resolutions: BatchResolutionKey[] = [
    ...(Object.keys(batchResolutions) as BatchResolutionKey[]),
    ...(batchResolution in batchResolutions ? [] : [batchResolution]),
  ]

  return (
    <div>
      <Select
        fullWidth
        label="Resolution:"
        size="sm"
        selectedKeys={[batchResolution]}
        disallowEmptySelection
        onSelectionChange={(keys) => {
          const [key] = [...keys]
          if (!key) return
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].batchResolution = key as BatchResolutionKey
          normalizeBatchMediaConfig()
        }}
        isDisabled={isCompressing || isProcessCompleted || isLoadingMediaFiles}
        classNames={{
          label: '!text-gray-600 dark:!text-gray-400 text-sm',
        }}
      >
        {resolutions.map((key) => {
          const label =
            RESOLUTION_LABELS[key as keyof typeof batchResolutions] ??
            key.replace('px', ' px')
          return (
            <SelectItem key={key} textValue={label}>
              {label}
            </SelectItem>
          )
        })}
      </Select>
    </div>
  )
}

export default BatchResolution
