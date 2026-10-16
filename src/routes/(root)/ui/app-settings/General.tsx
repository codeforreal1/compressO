import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import ColorPicker from '@/components/ColorPicker'
import DisabledReason from '@/components/DisabledReason'
import Slider from '@/components/Slider'
import Switch from '@/components/Switch'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { useDropQueue } from '@/hooks/useDropQueue'
import { usePrimaryColor } from '@/hooks/usePrimaryColor'
import { isWindowTintSupported } from '@/hooks/useWindowTint'
import { settingsStore, TINT_OPACITY_RANGE } from '@/stores/settingsStore'
import { restartApp } from '@/tauri/commands/app'
import { playCompletionSound as playSound } from '@/tauri/commands/sound'
import { getPlatform } from '@/utils/fs'
import { cn } from '@/utils/tailwind'
import { isVideoPreviewAvailable } from '@/utils/video'
import { SettingsRow, SettingsSection } from './SettingsLayout'

const { isMacOS, isLinux } = getPlatform()

function General() {
  const { color, setColor } = usePrimaryColor()
  const {
    tintedWindow,
    tintOpacity,
    showMenuBarIcon,
    playCompletionSound,
    enableVideoPreviews,
  } = useSnapshot(settingsStore)
  // Read when the app starts, so a change applies after a restart
  const needsRestart =
    isLinux && enableVideoPreviews !== isVideoPreviewAvailable
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
      {isLinux ? (
        <SettingsSection title="Preview">
          <SettingsRow
            title="Video previews"
            description="Play videos inside the app. Videos do not play well on some Linux systems, so a still image is shown instead by default. Changes apply after a restart."
          >
            <div className="flex items-center gap-2">
              {/* Its space is always kept & it fades in, so the switch does not move */}
              <Button
                size="sm"
                onPress={() => {
                  restartApp().catch(() => {})
                }}
                isDisabled={!needsRestart}
                aria-hidden={!needsRestart}
                tabIndex={needsRestart ? undefined : -1}
                className={cn(
                  'transition-opacity duration-200 data-[disabled=true]:opacity-0',
                  !needsRestart && 'pointer-events-none',
                )}
              >
                Restart
              </Button>
              <Switch
                aria-label="Video previews"
                isSelected={enableVideoPreviews}
                onValueChange={(isSelected) => {
                  settingsStore.enableVideoPreviews = isSelected
                }}
              />
            </div>
          </SettingsRow>
        </SettingsSection>
      ) : null}
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
            description="Show the CompressO icon, the compression progress and the drop zone in the menu bar."
          >
            <div className="flex items-center gap-2">
              <DisabledReason
                reason={
                  isMenuBarIconLocked &&
                  'Media in the drop zone is being compressed. This can be turned off once it is done or stopped.'
                }
              />
              <Switch
                aria-label="Show menu bar icon"
                isSelected={showMenuBarIcon}
                isDisabled={isMenuBarIconLocked}
                onValueChange={(isSelected) => {
                  settingsStore.showMenuBarIcon = isSelected
                }}
              />
            </div>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </>
  )
}

export default General
