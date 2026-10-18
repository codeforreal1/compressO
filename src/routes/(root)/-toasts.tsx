import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import { t } from '@/i18n'
import { openFilesAccessSettings } from '@/tauri/commands/app'
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
