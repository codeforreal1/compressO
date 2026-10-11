import { useSnapshot } from 'valtio'

import ColorPicker from '@/components/ColorPicker'
import Switch from '@/components/Switch'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { usePrimaryColor } from '@/hooks/usePrimaryColor'
import { settingsStore } from '@/stores/settingsStore'
import { getPlatform } from '@/utils/fs'
import { SettingsRow, SettingsSection } from './SettingsLayout'

const { isMacOS } = getPlatform()

function General() {
  const { color, setColor } = usePrimaryColor()
  const { showMenuBarIcon } = useSnapshot(settingsStore)

  return (
    <>
      <SettingsSection title="Appearance">
        <SettingsRow
          title="Theme"
          description="Switch between the light and dark interface."
        >
          <ThemeSwitcher />
        </SettingsRow>
        <SettingsRow
          title="Accent color"
          description="Color used for buttons, highlights and progress."
        >
          <ColorPicker color={color} onChange={setColor} />
        </SettingsRow>
      </SettingsSection>
      {isMacOS ? (
        <SettingsSection title="Menu bar">
          <SettingsRow
            title="Show menu bar icon"
            description="Show the CompressO icon and the compression progress in the menu bar."
          >
            <Switch
              aria-label="Show menu bar icon"
              isSelected={showMenuBarIcon}
              onValueChange={(isSelected) => {
                settingsStore.showMenuBarIcon = isSelected
              }}
            />
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </>
  )
}

export default General
