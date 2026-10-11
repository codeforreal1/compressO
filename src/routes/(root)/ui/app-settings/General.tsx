import { useSnapshot } from 'valtio'

import ColorPicker from '@/components/ColorPicker'
import Slider from '@/components/Slider'
import Switch from '@/components/Switch'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { usePrimaryColor } from '@/hooks/usePrimaryColor'
import { isWindowTintSupported } from '@/hooks/useWindowTint'
import { settingsStore, TINT_OPACITY_RANGE } from '@/stores/settingsStore'
import { getPlatform } from '@/utils/fs'
import { SettingsRow, SettingsSection } from './SettingsLayout'

const { isMacOS } = getPlatform()

function General() {
  const { color, setColor } = usePrimaryColor()
  const { showMenuBarIcon, tintedWindow, tintOpacity } =
    useSnapshot(settingsStore)

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
        {isWindowTintSupported ? (
          <SettingsRow
            title="Tinted window"
            description="Make the window background translucent, so the desktop behind it tints the app like native windows."
          >
            <Switch
              aria-label="Tinted window"
              isSelected={tintedWindow}
              onValueChange={(isSelected) => {
                settingsStore.tintedWindow = isSelected
              }}
            />
          </SettingsRow>
        ) : null}
        {isWindowTintSupported && tintedWindow ? (
          <SettingsRow
            title="Tint opacity"
            description="How solid the window background is. Lower values are more translucent."
          >
            <div className="flex items-center gap-3 w-[220px]">
              <Slider
                aria-label="Tint opacity"
                size="sm"
                minValue={TINT_OPACITY_RANGE.min}
                maxValue={TINT_OPACITY_RANGE.max}
                step={5}
                value={tintOpacity}
                onChange={(value) => {
                  settingsStore.tintOpacity = Array.isArray(value)
                    ? value[0]
                    : value
                }}
              />
              <span className="text-sm w-10 text-right tabular-nums">
                {tintOpacity}%
              </span>
            </div>
          </SettingsRow>
        ) : null}
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
