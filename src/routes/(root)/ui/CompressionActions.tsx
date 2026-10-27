import { memo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import SettingLink from '@/components/SettingLink'
import Tooltip from '@/components/Tooltip'
import { useCommandShiftShortcut } from '@/hooks/useCommandEnterShortcut'
import { getPlatform, isSamePath } from '@/utils/fs'
import { appProxy } from '../-state'

const { isMacOS, isWindows } = getPlatform()

/** Reconfigure: back to the settings used for the compression, to change them and compress again */
function CompressionActions() {
  const { t } = useTranslation()
  const {
    state: { media, isProcessCompleted, isLoadingMediaFiles, isSaving },
  } = useSnapshot(appProxy)

  // Saved over their originals ("Replace original files"), which went to the Trash: compressing
  // again would compress the compressed files, so it is not offered
  const replacedOriginalCount = media.filter((mediaFile) =>
    isSamePath(mediaFile.compressedFile?.savedPath, mediaFile.pathRaw),
  ).length
  const canReconfigure = replacedOriginalCount === 0

  const handleReconfigure = () => {
    if (!canReconfigure) return
    appProxy.timeTravel('beforeCompressionStarted')
  }

  // ⌘+Shift+R acts like the Reconfigure button
  useCommandShiftShortcut(
    'r',
    !!media.length &&
      isProcessCompleted &&
      !isLoadingMediaFiles &&
      !isSaving &&
      canReconfigure,
    handleReconfigure,
  )

  return media.length && !isLoadingMediaFiles && isProcessCompleted ? (
    <div className="w-fit flex justify-center items-center z-[10]">
      <Tooltip
        content={
          canReconfigure ? (
            `${t('compression.reconfigure')} (${isMacOS ? '⌘⇧R' : 'Ctrl+Shift+R'})`
          ) : (
            // Names the setting that replaced it, as a link to it
            <Trans
              i18nKey="compression.reconfigureOriginalReplaced"
              count={replacedOriginalCount}
              context={isWindows ? 'windows' : undefined}
              components={{
                setting: (
                  <SettingLink target={{ settingId: 'replaceOriginal' }} />
                ),
              }}
            />
          )
        }
        // Shown at once when it explains why it is unavailable
        delay={canReconfigure ? undefined : 0}
        aria-label={t('compression.reconfigure')}
      >
        <Button
          size="sm"
          onPress={handleReconfigure}
          variant="light"
          radius="full"
          className="gap-1"
          isDisabled={isSaving || !canReconfigure}
          isIconOnly
        >
          <Icon name="redo" size={22} />{' '}
        </Button>
      </Tooltip>
    </div>
  ) : null
}

export default memo(CompressionActions)
