import { useSnapshot } from 'valtio'

import ColorPicker from '@/components/ColorPicker'
import Slider from '@/components/Slider'
import Switch from '@/components/Switch'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { useDropQueue } from '@/hooks/useDropQueue'
import { usePrimaryColor } from '@/hooks/usePrimaryColor'
import { isWindowTintSupported } from '@/hooks/useWindowTint'
import { settingsStore, TINT_OPACITY_RANGE } from '@/stores/settingsStore'
import { playCompletionSound as playSound } from '@/tauri/commands/sound'
import { getPlatform } from '@/utils/fs'
import { SettingsRow, SettingsSection } from './SettingsLayout'

const { isMacOS } = getPlatform()

function General() {
  const { color, setColor } = usePrimaryColor()
  const { tintedWindow, tintOpacity, showMenuBarIcon, playCompletionSound } =
    useSnapshot(settingsStore)
  // The drop zone's queue is compressed by the menu bar, so its icon stays until the queue is done
  // (or stopped)
  const isDropQueueActive = useDropQueue().some(
    (item) => item.status === 'waiting' || item.status === 'compressing',
  )
  const isMenuBarIconLocked = showMenuBarIcon && isDropQueueActive

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
            description="Let the desktop show softly through the window background."
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
            isNested
            title="Tint opacity"
            description="How much of the desktop shows through. Lower values show more of it."
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
      <SettingsSection title="Sound">
        <SettingsRow
          title="Completion sound"
          description="Play a sound when a compression completes."
        >
          <Switch
            aria-label="Completion sound"
            isSelected={playCompletionSound}
            onValueChange={(isSelected) => {
              settingsStore.playCompletionSound = isSelected
              // A preview of the sound that will play
              if (isSelected) playSound().catch(() => {})
            }}
          />
        </SettingsRow>
      </SettingsSection>
      {isMacOS ? (
        <SettingsSection title="Menu bar">
          <SettingsRow
            title="Show menu bar icon"
            description={
              isMenuBarIconLocked
                ? 'This can be turned off once the media in the drop zone is compressed or stopped.'
                : 'Show the CompressO icon, the compression progress and the drop zone in the menu bar.'
            }
          >
            <Switch
              aria-label="Show menu bar icon"
              isSelected={showMenuBarIcon}
              isDisabled={isMenuBarIconLocked}
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
