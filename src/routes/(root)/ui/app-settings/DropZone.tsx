import { useSnapshot } from 'valtio'

import Switch from '@/components/Switch'
import { settingsStore } from '@/stores/settingsStore'
import { SettingsRow, SettingsSection } from './SettingsLayout'

/** Settings of the drop zone in the menu bar (macOS only) */
function DropZone() {
  const { showMenuBarIcon, watchClipboard } = useSnapshot(settingsStore)

  return (
    <>
      {/* Only needed while the drop zone cannot be used */}
      {!showMenuBarIcon ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">
          The drop zone is in the menu bar, so it only works when Show menu bar
          icon is turned on in General.
        </p>
      ) : null}
      <SettingsSection title="Clipboard">
        <SettingsRow
          title="Watch clipboard"
          description="Add media files you copy, for example in Finder, to the drop zone of the menu bar."
        >
          <Switch
            aria-label="Watch clipboard"
            isSelected={watchClipboard}
            isDisabled={!showMenuBarIcon}
            onValueChange={(isSelected) => {
              settingsStore.watchClipboard = isSelected
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  )
}

export default DropZone
