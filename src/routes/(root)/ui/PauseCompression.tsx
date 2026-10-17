import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import { setBatchPaused } from '@/tauri/commands/media'
import { cn } from '@/utils/tailwind'
import { appProxy } from '../-state'

/**
 * Pauses a batch after the media being compressed (or resumes it). Only for batches: a single media
 * has nothing after it to pause before.
 */
function PauseCompression() {
  const { t } = useTranslation()
  const {
    state: { media, batchId, isBatchPaused, isCompressing },
  } = useSnapshot(appProxy)

  if (!isCompressing || media.length < 2 || !batchId) return null

  const label = isBatchPaused ? t('queue.resume') : t('queue.pauseAfterCurrent')

  return (
    <Tooltip content={label} aria-label={label}>
      <Button
        isIconOnly
        variant="flat"
        aria-label={isBatchPaused ? t('queue.resume') : t('queue.pause')}
        className="relative flex-shrink-0"
        onPress={async () => {
          const paused = !appProxy.state.isBatchPaused
          try {
            await setBatchPaused(batchId, paused)
            appProxy.state.isBatchPaused = paused
          } catch {
            toast.error(
              paused
                ? t('compression.pauseFailed')
                : t('compression.resumeFailed'),
            )
          }
        }}
      >
        {/* Both icons in one place, crossfading, so the button does not change */}
        <Icon
          name="pause"
          size={18}
          className={cn(
            'absolute transition-opacity duration-150',
            isBatchPaused ? 'opacity-0' : 'opacity-100',
          )}
        />
        <Icon
          name="play"
          size={18}
          className={cn(
            'absolute transition-opacity duration-150',
            isBatchPaused ? 'opacity-100' : 'opacity-0',
          )}
        />
      </Button>
    </Tooltip>
  )
}

export default PauseCompression
