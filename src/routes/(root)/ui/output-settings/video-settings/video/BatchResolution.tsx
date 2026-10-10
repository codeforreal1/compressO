import { SelectItem } from '@heroui/react'
import { useSnapshot } from 'valtio'

import Select from '@/components/Select'
import {
  type BatchResolution as BatchResolutionKey,
  batchResolutions,
} from '@/types/compression'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

const RESOLUTION_LABELS: Record<BatchResolutionKey, string> = {
  original: 'Original',
  '480p': '480p',
  '720p': '720p',
  '1080p': '1080p',
  '2k': '2K',
  '4k': '4K',
}

/**
 * Resolution for all videos of a batch (the per-video dimensions need a single video's size). Each
 * video's shorter side is scaled to the resolution, keeping its aspect ratio; smaller videos keep
 * their size. Videos with their own custom dimensions keep those.
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
  const batchResolution =
    commonConfigForBatchCompression.videoConfig.batchResolution ?? 'original'

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
          appProxy.state.commonConfigForBatchCompression.videoConfig.batchResolution =
            key as BatchResolutionKey
          normalizeBatchMediaConfig()
        }}
        isDisabled={isCompressing || isProcessCompleted || isLoadingMediaFiles}
        classNames={{
          label: '!text-gray-600 dark:!text-gray-400 text-sm',
        }}
      >
        {(Object.keys(batchResolutions) as BatchResolutionKey[]).map((key) => (
          <SelectItem key={key} textValue={RESOLUTION_LABELS[key]}>
            {RESOLUTION_LABELS[key]}
          </SelectItem>
        ))}
      </Select>
    </div>
  )
}

export default BatchResolution
