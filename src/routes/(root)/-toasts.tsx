import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import { t } from '@/i18n'
import { logError, openFilesAccessSettings } from '@/tauri/commands/app'
import { showItemInFileManager } from '@/tauri/commands/fs'
import { getPlatform } from '@/utils/fs'

/**
 * Tells that the system did not allow opening `count` files; on macOS with a settings icon to the
 * privacy settings, where access is allowed again
 */
export function showAccessDeniedToast(count: number) {
  toast.error(t('media.accessDenied', { count }), {
    duration: 8000,
    action: getPlatform().isMacOS ? (
      <Tooltip
        content={t('media.openSettings')}
        aria-label={t('media.openSettings')}
      >
        <Button
          size="sm"
          variant="light"
          color="danger"
          radius="full"
          isIconOnly
          className="shrink-0"
          aria-label={t('media.openSettings')}
          onPress={() => {
            openFilesAccessSettings().catch(() => {})
          }}
        >
          <Icon name="setting" size={18} />
        </Button>
      </Tooltip>
    ) : undefined,
  })
}

/**
 * Confirms a JSON contract export with a file-manager action to reveal the saved `.json` file.
 */
export function showContractExportedToast(targetPath: string) {
  toast.success(t('contract.exported'), {
    duration: 5000,
    action: (
      <Tooltip
        content={t('common.showInFileManager')}
        aria-label={t('common.showInFileManager')}
      >
        <Button
          size="sm"
          variant="light"
          color="success"
          radius="full"
          isIconOnly
          className="shrink-0"
          aria-label={t('common.showInFileManager')}
          onPress={() => {
            showItemInFileManager(targetPath).catch((error) => {
              logError(
                `[contract] Could not reveal exported contract ${targetPath}`,
                error,
              )
              toast.error(t('preview.showFailed'))
            })
          }}
        >
          <Icon name="fileExplorer" size={16} />
        </Button>
      </Tooltip>
    ),
  })
}
