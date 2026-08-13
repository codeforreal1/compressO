import { open } from '@tauri-apps/plugin-dialog'
import React, { useState } from 'react'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Switch from '@/components/Switch'
import { toast } from '@/components/Toast'
import { appProxy } from '../../-state'

function AutoSaveSettings() {
  const { autoSaveEnabled, autoSavePath } = useSnapshot(appProxy.state)
  const [isSelectingFolder, setIsSelectingFolder] = useState(false)

  const handleAutoSaveToggle = (checked: boolean) => {
    appProxy.state.autoSaveEnabled = checked
    localStorage.setItem('autoSaveEnabled', String(checked))
    toast.success(
      checked
        ? 'Auto save enabled. Files will be saved automatically after compression.'
        : 'Auto save disabled.',
    )
  }

  const handleSelectAutoSaveFolder = async () => {
    try {
      setIsSelectingFolder(true)
      const selectedDirectory = await open({
        directory: true,
        title: 'Choose default folder for auto save',
      })

      if (selectedDirectory && typeof selectedDirectory === 'string') {
        appProxy.state.autoSavePath = selectedDirectory
        localStorage.setItem('autoSavePath', selectedDirectory)
        toast.success(`Auto save set to: ${selectedDirectory}`)
      }
    } catch {
      toast.error('Failed to select folder')
    } finally {
      setIsSelectingFolder(false)
    }
  }

  const handleResetAutoSaveFolder = async () => {
    try {
      appProxy.state.autoSavePath = undefined
      localStorage.removeItem('autoSavePath')
      toast.success('Auto save folder reset to default (Downloads)')
    } catch {
      toast.error('Failed to reset folder')
    }
  }

  const displayPath = autoSavePath
    ? autoSavePath.split(/[\\/]/).slice(-2).join('/')
    : 'Downloads (default)'

  return (
    <div className="mb-4">
      <div className="flex items-center">
        <Switch
          isSelected={autoSaveEnabled}
          onValueChange={handleAutoSaveToggle}
          className="flex justify-center items-center"
          size="sm"
        >
          <div className="flex justify-center items-center">
            <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
              Auto save to
            </span>
          </div>
        </Switch>
      </div>

      {autoSaveEnabled ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            {/* <p className="text-xs text-gray-600 dark:text-gray-400">Save folder</p> */}
            <p className="max-w-[180px] truncate text-right text-xs text-zinc-700 dark:text-zinc-200">
              {displayPath}
            </p>
          </div>

          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="flat"
              onPress={handleSelectAutoSaveFolder}
              isLoading={isSelectingFolder}
              className="flex-1"
            >
              <Icon name="fileExplorer" size={16} />
              Change
            </Button>
            {autoSavePath ? (
              <Button
                size="sm"
                variant="flat"
                onPress={handleResetAutoSaveFolder}
              >
                <Icon name="redo" size={16} />
                Reset
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default React.memo(AutoSaveSettings)
