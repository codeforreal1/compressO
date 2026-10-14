// The item must be HeroUI's own (not a wrapper) so the Select can build its collection
import { SelectItem } from '@heroui/react'
import { open } from '@tauri-apps/plugin-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Select from '@/components/Select'
import Switch from '@/components/Switch'
import TextInput from '@/components/TextInput'
import { toast } from '@/components/Toast'
import {
  type SaveLocation,
  sanitizeFileNamePart,
  settingsStore,
} from '@/stores/settingsStore'
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

const SAVE_LOCATION_OPTIONS: {
  key: SaveLocation
  label: string
  description: string
}[] = [
  {
    key: 'ask',
    label: 'Ask every time',
    description: 'Choose where to save after each compression.',
  },
  {
    key: 'fixedFolder',
    label: 'Fixed folder',
    description:
      'Save automatically to the chosen folder after each compression.',
  },
  {
    key: 'sameFolder',
    label: 'Same folder as original',
    description:
      'Save automatically next to the original file, or next to the dropped folder.',
  },
]

async function pickSaveFolder() {
  const folder = await open({
    directory: true,
    title: 'Choose a folder to save compressed media to.',
  })
  return typeof folder === 'string' ? folder : null
}

function Output() {
  const [confirmClearCache, setConfirmClearCache] = React.useState(false)
  const [isCacheDeleting, setIsCacheDeleting] = React.useState(false)
  const {
    outputFilePrefix,
    saveLocation,
    saveFolder,
    saveLargerOutputs,
    copyOutputToClipboard,
    copyBatchOutputToClipboard,
  } = useSnapshot(settingsStore)
  const selectedSaveLocation = SAVE_LOCATION_OPTIONS.find(
    (option) => option.key === saveLocation,
  )

  const handleSaveLocationChange = async (location: SaveLocation) => {
    // A fixed folder needs a folder; keep the previous option if none is chosen
    if (location === 'fixedFolder' && !settingsStore.saveFolder) {
      const folder = await pickSaveFolder()
      if (!folder) return
      settingsStore.saveFolder = folder
    }
    settingsStore.saveLocation = location
  }
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
      <SettingsSection title="Saving">
        <SettingsRow
          title="Save location"
          description={selectedSaveLocation?.description}
        >
          <Select
            aria-label="Save location"
            selectedKeys={[saveLocation]}
            disallowEmptySelection
            onSelectionChange={(keys) => {
              const [key] = [...keys]
              if (key) handleSaveLocationChange(key as SaveLocation)
            }}
            className="w-[220px]"
            classNames={{ popoverContent: 'settings-dialog' }}
          >
            {SAVE_LOCATION_OPTIONS.map((option) => (
              <SelectItem key={option.key}>{option.label}</SelectItem>
            ))}
          </Select>
        </SettingsRow>
        {saveLocation === 'fixedFolder' ? (
          <SettingsRow
            isNested
            title="Folder"
            description={
              <span className="break-all">
                {saveFolder ?? 'No folder chosen'}
              </span>
            }
          >
            <Button
              size="sm"
              onPress={async () => {
                const folder = await pickSaveFolder()
                if (folder) settingsStore.saveFolder = folder
              }}
            >
              Change
            </Button>
          </SettingsRow>
        ) : null}
        {saveLocation !== 'ask' ? (
          <SettingsRow
            isNested
            title="Skip larger outputs"
            description="Do not save the compressed media when it is larger than the original."
          >
            <Switch
              aria-label="Skip larger outputs"
              isSelected={!saveLargerOutputs}
              onValueChange={(isSelected) => {
                settingsStore.saveLargerOutputs = !isSelected
              }}
            />
          </SettingsRow>
        ) : null}
        <SettingsRow
          title="File name prefix"
          description="Text added to the start of saved file names. Leave empty to keep the original names."
        >
          <TextInput
            aria-label="File name prefix"
            placeholder="No prefix"
            value={outputFilePrefix}
            onValueChange={(value) => {
              settingsStore.outputFilePrefix = sanitizeFileNamePart(value)
            }}
            className="w-[180px]"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Clipboard">
        <SettingsRow
          title="Copy output to clipboard"
          description="Copy the compressed media to the clipboard after each compression, so it can be pasted right away."
        >
          <Switch
            aria-label="Copy output to clipboard"
            isSelected={copyOutputToClipboard}
            onValueChange={(isSelected) => {
              settingsStore.copyOutputToClipboard = isSelected
              // Batch outputs are included again whenever copying is turned on
              if (isSelected) settingsStore.copyBatchOutputToClipboard = true
            }}
          />
        </SettingsRow>
        {copyOutputToClipboard ? (
          <SettingsRow
            isNested
            title="Include batch outputs"
            description="Also copy the files when several are compressed at once."
          >
            <Switch
              aria-label="Include batch outputs"
              isSelected={copyBatchOutputToClipboard}
              onValueChange={(isSelected) => {
                settingsStore.copyBatchOutputToClipboard = isSelected
              }}
            />
          </SettingsRow>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Storage">
        <SettingsRow
          title="Clear cache"
          description={
            canClearCache
              ? 'Free up space by deleting temporary files. Your saved files are not affected.'
              : 'Close the media you are working on first.'
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

export default Output
