import { memo } from 'react'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { useCommandShiftShortcut } from '@/hooks/useCommandEnterShortcut'
import { getPlatform } from '@/utils/fs'
import { appProxy } from '../-state'

const { isMacOS } = getPlatform()

/** Reconfigure: back to the settings used for the compression, to change them and compress again */
function CompressionActions() {
  const {
    state: { media, isProcessCompleted, isLoadingMediaFiles, isSaving },
  } = useSnapshot(appProxy)

  const handleReconfigure = () => {
    appProxy.timeTravel('beforeCompressionStarted')
  }

  // ⌘+Shift+R acts like the Reconfigure button
  useCommandShiftShortcut(
    'r',
    !!media.length && isProcessCompleted && !isLoadingMediaFiles && !isSaving,
    handleReconfigure,
  )

  return media.length && !isLoadingMediaFiles && isProcessCompleted ? (
    <div className="w-fit flex justify-center items-center z-[10]">
      <Tooltip
        content={`Reconfigure (${isMacOS ? '⌘⇧R' : 'Ctrl+Shift+R'})`}
        aria-label="Reconfigure"
      >
        <Button
          size="sm"
          onPress={handleReconfigure}
          variant="light"
          radius="full"
          className="gap-1"
          isDisabled={isSaving}
          isIconOnly
        >
          <Icon name="redo" size={22} />{' '}
        </Button>
      </Tooltip>
    </div>
  ) : null
}

export default memo(CompressionActions)
