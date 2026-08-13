import { DropdownItem, useDisclosure } from '@heroui/react'
import { open } from '@tauri-apps/plugin-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import { useSnapshot } from 'valtio'

import Badge from '@/components/Badge'
import Button from '@/components/Button'
import ColorPicker from '@/components/ColorPicker'
import Divider from '@/components/Divider'
import Dropdown, { DropdownMenu, DropdownTrigger } from '@/components/Dropdown'
import Icon from '@/components/Icon'
import Markdown from '@/components/Markdown'
import Modal, { ModalContent } from '@/components/Modal'
import ScrollShadow from '@/components/ScrollShadow'
import Switch from '@/components/Switch'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import Title from '@/components/Title'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import { usePrimaryColor } from '@/hooks/usePrimaryColor'
import { downloadAndInstallUpdateApp, updateStore } from '@/stores/updateStore'
import { deleteCache as invokeDeleteCache } from '@/tauri/commands/fs'
import { appProxy } from '../../-state'
import About from './About'
import Credits from './Credits'

type DropdownKey = 'settings' | 'about' | 'update' | 'credits'

function Setting() {
  const modalDisclosure = useDisclosure()
  const { isUpdateAvailable, latestVersion } = useSnapshot(updateStore)

  const [selectedKey, setSelectedKey] = React.useState<DropdownKey>('settings')
  const handleDropdownAction = (item: string | number) => {
    modalDisclosure.onOpen()
    setSelectedKey(item as DropdownKey)
  }

  const hasNewVersion = isUpdateAvailable && latestVersion

  return (
    <>
      <div className="absolute bottom-4 left-4 p-0 z-[1]">
        <Dropdown placement="right">
          <DropdownTrigger>
            <Button isIconOnly size="sm" variant="light">
              <Tooltip
                content="Open Settings"
                aria-label="Open Settings"
                placement="right"
              >
                <Badge
                  color="primary"
                  content=""
                  placement="bottom-right"
                  shape="circle"
                  isInvisible={!hasNewVersion}
                >
                  <Icon name="setting" size={23} />
                </Badge>
              </Tooltip>
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            variant="faded"
            aria-label="Dropdown menu with description"
            onAction={handleDropdownAction}
          >
            <DropdownItem key="settings" startContent={<Icon name="setting" />}>
              Settings
            </DropdownItem>
            <DropdownItem key="about" startContent={<Icon name="info" />}>
              About
            </DropdownItem>
            <DropdownItem
              key="credits"
              startContent={<Icon name="lowResHeart" />}
            >
              Credits
            </DropdownItem>
            {hasNewVersion ? (
              <DropdownItem
                key="update"
                className="text-primary"
                startContent={<Icon name="download" />}
              >
                Update to {latestVersion}
              </DropdownItem>
            ) : null}
          </DropdownMenu>
        </Dropdown>
      </div>
      <Modal
        isOpen={modalDisclosure.isOpen}
        onClose={modalDisclosure.onClose}
        motionVariant="bottomToTop"
      >
        <ModalContent className="max-w-[30rem] pb-2 overflow-hidden rounded-2xl">
          {selectedKey === 'settings' ? (
            <AppSetting />
          ) : selectedKey === 'update' ? (
            <UpdateModal onClose={modalDisclosure.onClose} />
          ) : selectedKey === 'credits' ? (
            <Credits />
          ) : (
            <About />
          )}
        </ModalContent>
      </Modal>
    </>
  )
}

function AppSetting() {
  const [confirmClearCache, setConfirmClearCache] = React.useState(false)
  const [isCacheDeleting, setIsCacheDeleting] = React.useState(false)
  const { color, setColor } = usePrimaryColor()
  const { autoSaveEnabled, autoSavePath } = useSnapshot(appProxy.state)
  const [isSelectingFolder, setIsSelectingFolder] = React.useState(false)

  const handleAutoSaveToggle = (checked: boolean) => {
    appProxy.state.autoSaveEnabled = checked
    localStorage.setItem('autoSaveEnabled', String(checked))
    toast.success(
      checked
        ? 'Auto-save enabled. Files will be saved automatically after compression.'
        : 'Auto-save disabled.',
    )
  }

  const handleSelectAutoSaveFolder = async () => {
    try {
      setIsSelectingFolder(true)
      const selectedDirectory = await open({
        directory: true,
        title: 'Choose default folder for auto-save',
      })
      if (selectedDirectory && typeof selectedDirectory === 'string') {
        appProxy.state.autoSavePath = selectedDirectory
        localStorage.setItem('autoSavePath', selectedDirectory)
        toast.success(`Auto-save folder set to: ${selectedDirectory}`)
      }
    } catch (error) {
      toast.error('Failed to select folder')
    } finally {
      setIsSelectingFolder(false)
    }
  }

  const handleResetAutoSaveFolder = async () => {
    try {
      appProxy.state.autoSavePath = undefined
      localStorage.removeItem('autoSavePath')
      toast.success('Auto-save folder reset to default (Downloads)')
    } catch (error) {
      toast.error('Failed to reset folder')
    }
  }

  const displayPath = autoSavePath
    ? autoSavePath.split(/[\\/]/).slice(-2).join('/')
    : 'Downloads (default)'

  const deleteCache = async () => {
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
    <div className="w-full py-10 px-8">
      <section className="mb-6">
        <Title title="Settings" iconProps={{ name: 'setting' }} />
      </section>
      <div className="mx-auto bg-zinc-100 dark:bg-zinc-800 rounded-lg px-4 py-3 overflow-hidden">
        <div className="flex justify-between items-center">
          <p className="text-gray-600 dark:text-gray-400 text-sm">Theme</p>
          <ThemeSwitcher />
        </div>
        <Divider className="my-2 dark:bg-zinc-700" />
        <div className="flex justify-between items-center">
          <p className="text-gray-600 dark:text-gray-400 text-sm">Color</p>
          <ColorPicker color={color} onChange={setColor} />
        </div>
        <Divider className="my-2 dark:bg-zinc-700" />
        <div className="flex justify-between items-center">
          <Tooltip
            content="Automatically save compressed files to the default directory after compression completes"
            aria-label="Auto-save toggle"
            placement="left"
          >
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              Auto-save after Compression
            </p>
          </Tooltip>
          <Switch
            isSelected={autoSaveEnabled}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleAutoSaveToggle(e.target.checked)}
          />
        </div>
        <Divider className="my-2 dark:bg-zinc-700" />
        {autoSaveEnabled ? (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <Tooltip
                  content="Set custom default folder for auto-saving compressed files"
                  aria-label="Custom auto-save folder"
                  placement="left"
                >
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    Auto-save Folder
                  </p>
                </Tooltip>
              </div>
              <div className="flex gap-2 items-center">
                <p className="text-xs text-gray-500 dark:text-gray-500 flex-1 truncate">
                  {displayPath}
                </p>
              </div>
              <div className="flex gap-2">
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
            <Divider className="my-2 dark:bg-zinc-700" />
          </>
        ) : null}
        <div className="flex justify-between items-center">
          <p className="dark:text-red-400 text-sm text-red-400">Clear Cache</p>
          <Tooltip
            content="Clear cache"
            aria-label="Clear cache"
            placement="right"
            isDisabled={confirmClearCache}
          >
            <div className="flex items-center">
              <Button
                isIconOnly={!confirmClearCache}
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
                <div>
                  <Icon name="trash" />
                </div>
                <AnimatePresence initial={false} mode="wait">
                  {confirmClearCache ? (
                    <motion.span
                      layout="position"
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{
                        duration: 0.25,
                        ease: [0.4, 0, 0.2, 1],
                      }}
                      className="inline-block whitespace-nowrap"
                    >
                      Clear Now
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </Button>
            </div>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

interface UpdateModalProps {
  onClose: () => void
}

function UpdateModal({ onClose }: UpdateModalProps) {
  const {
    isUpdateAvailable,
    latestVersion,
    currentVersion,
    body,
    isInstalling,
    installProgress,
  } = useSnapshot(updateStore)

  const handleInstall = async () => {
    try {
      await downloadAndInstallUpdateApp()
      onClose()
    } catch {
      toast.error('Failed to install update. Please try again.')
    }
  }

  return (
    <div className="w-full py-10 pb-4 px-8">
      <section className="mb-6">
        <Title title="Update Available" iconProps={{ name: 'download' }} />
      </section>
      <div>
        {isUpdateAvailable && latestVersion ? (
          <>
            <div className="flex justify-between items-center mb-4">
              <div>
                <p className="text-gray-600 dark:text-gray-400 text-xs">
                  Current Version
                </p>
                <p className="font-bold text-sm">{currentVersion}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-600 dark:text-gray-400 text-xs">
                  Latest Version
                </p>
                <p className="font-bold text-sm text-primary">
                  {latestVersion}
                </p>
              </div>
            </div>
            <Divider className="my-2" />
            {body && (
              <div className="mt-4">
                <p className="text-primary text-sm mb-2">What's New?</p>
                <ScrollShadow className="max-h-[50vh]">
                  <Markdown content={body} className="text-sm" />
                </ScrollShadow>
              </div>
            )}
            <Divider className="my-2 mt-4" />
            <div className="mt-4 flex justify-end gap-2">
              {!isInstalling ? (
                <Button variant="flat" size="sm" onPress={onClose}>
                  Cancel
                </Button>
              ) : null}
              <Button
                size="sm"
                className="bg-primary"
                onPress={handleInstall}
                isLoading={isInstalling}
                isDisabled={isInstalling}
              >
                Update Now {isInstalling ? `(${installProgress}%)` : ''}
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              No updates available. You are on the latest version.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default Setting
