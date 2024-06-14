import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DropdownItem } from '@nextui-org/dropdown'
import { useDisclosure } from '@nextui-org/modal'

import ThemeSwitcher from '@/components/ThemeSwitcher'
import Divider from '@/components/Divider'
import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { deleteCache as invokeDeleteCache } from '@/tauri/commands/fs'
import { toast } from '@/components/Toast'
import Title from '@/components/Title'
import Modal, { ModalContent } from '@/components/Modal'
import Dropdown, { DropdownMenu, DropdownTrigger } from '@/components/Dropdown'
import About from './About'

type DropdownKey = 'settings' | 'about'

function Setting() {
  const modalDisclosure = useDisclosure()

  const [selectedKey, setSelectedKey] = React.useState<DropdownKey>('settings')
  const handleDropdownAction = (item: string | number) => {
    modalDisclosure.onOpen()
    setSelectedKey(item as DropdownKey)
  }

  return (
    <>
      <div className="absolute bottom-4 left-4 p-0 z-[1]">
        <Dropdown placement="right">
          <DropdownTrigger>
            <Button isIconOnly size="sm">
              <Tooltip
                content="Open Settings"
                aria-label="Open Settings"
                placement="right"
              >
                <Icon name="setting" size={23} />
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
          </DropdownMenu>
        </Dropdown>
      </div>
      <Modal
        isOpen={modalDisclosure.isOpen}
        onClose={modalDisclosure.onClose}
        motionVariant="bottomToTop"
      >
        <ModalContent className="max-w-[30rem] pb-2 overflow-hidden rounded-2xl">
          {selectedKey === 'settings' ? <AppSetting /> : <About />}
        </ModalContent>
      </Modal>
    </>
  )
}

function AppSetting() {
  const [confirmClearCache, setConfirmClearCache] = React.useState(false)
  const [isCacheDeleting, setIsCacheDeleting] = React.useState(false)

  const deleteCache = async () => {
    setIsCacheDeleting(true)
    try {
      await invokeDeleteCache()
      toast.success('All caches were cleared.')
      setConfirmClearCache(false)
    } catch (_) {
      toast.error('Could not clear cache at the moment.')
    }
    setIsCacheDeleting(false)
  }

  return (
    <div className="w-full py-12 pb-16 px-8">
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
                onClick={() => {
                  if (!confirmClearCache) {
                    setConfirmClearCache(true)
                  } else {
                    deleteCache()
                  }
                }}
                isLoading={isCacheDeleting}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {confirmClearCache ? (
                    <motion.div
                      layout="preserve-aspect"
                      transition={{
                        type: 'spring',
                        bounce: 0.2,
                        duration: 0.5,
                      }}
                    >
                      Clear Now
                    </motion.div>
                  ) : null}
                  <motion.div
                    layout="preserve-aspect"
                    className="flex items-center"
                    transition={{
                      type: 'spring',
                      bounce: 0.2,
                      duration: 0.2,
                    }}
                  >
                    <Icon name="trash" />
                  </motion.div>
                </AnimatePresence>
              </Button>
            </div>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

export default Setting
