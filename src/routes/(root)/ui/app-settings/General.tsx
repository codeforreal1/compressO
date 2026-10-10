import ColorPicker from '@/components/ColorPicker'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { usePrimaryColor } from '@/hooks/usePrimaryColor'
import { SettingsRow, SettingsSection } from './SettingsLayout'

function General() {
  const { color, setColor } = usePrimaryColor()

  return (
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
  )
}

export default General
