import React from 'react'
import { Tab } from '@nextui-org/tabs'
import { useDisclosure } from '@nextui-org/modal'

import Tabs from '@/components/Tabs'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import Divider from '@/components/Divider'
import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import Modal, {
  ModalContent,
  ModalBody,
  ModalHeader,
  ModalFooter,
} from '@/components/Modal'
import { deleteCache as invokeDeleteCache } from '@/tauri/commands/fs'
import { toast } from '@/components/Toast'
import About from './About'

function Setting() {
  const [isCacheDeletePending, setIsCacheDeletePending] = React.useState(false)
  const { isOpen, onOpenChange, onOpen } = useDisclosure()

  const deleteCache = async () => {
    setIsCacheDeletePending(true)
    try {
      await invokeDeleteCache()
    } catch (_) {
      toast.error('Could not delete cache at the moment.')
    }
    setIsCacheDeletePending(false)
  }

  return (
    <div className="min-h-[450px] ml-auto">
      <Tabs className="absolute left-[50%] top-10 translate-x-[-50%]">
        <Tab key="setting" title="Setting">
          <div className="w-full absolute left-0 right-0 top-24">
            <div className="max-w-[500px] mx-auto bg-zinc-300 dark:bg-zinc-800 rounded-lg px-4 py-3">
              <div className="flex justify-between items-center">
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  Theme
                </p>
                <ThemeSwitcher />
              </div>
              <Divider className="my-2" />
              <div className="flex justify-between items-center">
                <p className="dark:text-red-400 text-sm text-red-400">
                  Delete Cache
                </p>
                <Tooltip
                  content="Delete cache"
                  aria-label="Delete cache"
                  placement="right"
                >
                  <Button
                    isIconOnly
                    size="sm"
                    color="danger"
                    variant="flat"
                    onClick={() => {
                      onOpen()
                    }}
                    isLoading={isCacheDeletePending}
                  >
                    <Icon name="trash" />
                  </Button>
                </Tooltip>
              </div>
            </div>
          </div>
        </Tab>
        <Tab key="about" title="About">
          <div className="w-full absolute left-0 right-0 top-28">
            <About />
          </div>
        </Tab>
      </Tabs>
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent className="max-w-[550px] z-50">
          {(closeModal) => (
            <>
              <ModalHeader>Delete Cache</ModalHeader>
              <ModalBody className="gap-0">
                <div className="mb-4">
                  Are you sure you want to delete all the cache?
                  <span className="block">
                    Make sure there are no any pending tasks left.
                  </span>
                </div>
                <ModalFooter>
                  <Button
                    onClick={(evt) => {
                      evt?.stopPropagation()
                      closeModal()
                    }}
                  >
                    No
                  </Button>
                  <Button
                    color="danger"
                    onClick={(evt) => {
                      evt?.stopPropagation()
                      evt?.preventDefault()
                      evt?.persist()
                      closeModal()
                      deleteCache()
                    }}
                    isLoading={isCacheDeletePending}
                  >
                    Yes
                  </Button>
                </ModalFooter>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}

export default Setting
