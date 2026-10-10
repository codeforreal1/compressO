import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import ColorPicker from '@/components/ColorPicker'
import Icon from '@/components/Icon'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { toast } from '@/components/Toast'
import { usePrimaryColor } from '@/hooks/usePrimaryColor'
import { deleteCache as invokeDeleteCache } from '@/tauri/commands/fs'
import { SettingsRow, SettingsSection } from './SettingsLayout'
import { appProxy } from '../../-state'

/**
 * The cache holds the thumbnails & unsaved outputs of the media being worked on, so it can only be
 * cleared from the home screen (settings can also be opened with a shortcut while editing).
 */
function isOnHomeScreen() {
  const { media, isLoadingMediaFiles, isCompressing } = appProxy.state
  return media.length === 0 && !isLoadingMediaFiles && !isCompressing
}

function General() {
  const [confirmClearCache, setConfirmClearCache] = React.useState(false)
  const [isCacheDeleting, setIsCacheDeleting] = React.useState(false)
  const { color, setColor } = usePrimaryColor()
  // Read from the snapshot so the button updates if the screen changes while the dialog is open
  const {
    state: { media, isLoadingMediaFiles, isCompressing },
  } = useSnapshot(appProxy)
  const canClearCache =
    media.length === 0 && !isLoadingMediaFiles && !isCompressing

  const deleteCache = async () => {
    if (!isOnHomeScreen()) return
    setIsCacheDeleting(true)
    try {
      await invokeDeleteCache()
      toast.success('All cache was cleared.')
      setConfirmClearCache(false)
    } catch (_) {
      toast.error('There was a problem clearing cache.')
    }
    setIsCacheDeleting(false)
  }

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

      <SettingsSection title="Storage">
        <SettingsRow
          title="Clear cache"
          description={
            canClearCache
              ? "Delete generated thumbnails and compressed files that haven't been saved. Saved files are not affected."
              : 'Close the media you are working on to clear the cache, since it is still in use.'
          }
        >
          <Button
            isDisabled={!canClearCache}
            size="sm"
            color="danger"
            variant={confirmClearCache ? 'solid' : 'flat'}
            onPress={() => {
              if (!confirmClearCache) {
                setConfirmClearCache(true)
              } else {
                deleteCache()
              }
            }}
            isLoading={isCacheDeleting}
          >
            <Icon name="trash" />
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                key={confirmClearCache ? 'confirm' : 'clear'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="inline-block whitespace-nowrap"
              >
                {confirmClearCache ? 'Clear now' : 'Clear cache'}
              </motion.span>
            </AnimatePresence>
          </Button>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}

export default General
