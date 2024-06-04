import React from 'react'
import { Tab } from '@nextui-org/tabs'
import { AnimatePresence, motion } from 'framer-motion'

import Tabs from '@/components/Tabs'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import Divider from '@/components/Divider'
import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import Drawer from '@/components/Drawer'
import { deleteCache as invokeDeleteCache } from '@/tauri/commands/fs'
import { toast } from '@/components/Toast'
import About from './About'

function Setting() {
  return (
    <Drawer
      renderTriggerer={({ open: openDrawer }) => (
        <div className="absolute bottom-4 left-4 p-0 z-[1]">
          <Button onClick={openDrawer} isIconOnly size="sm">
            <Tooltip
              content="Open Settings"
              aria-label="Open Settings"
              placement="right"
            >
              <Icon name="setting" size={23} />
            </Tooltip>
          </Button>
        </div>
      )}
    >
      <AppSetting />
    </Drawer>
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
    <div className="min-h-[30rem] w-full ml-auto">
      <Tabs className="absolute left-[50%] top-10 translate-x-[-50%]" size="sm">
        <Tab
          key="setting"
          title={
            <div className="flex justify-center align-center gap-2">
              <Icon name="setting" />
              <p>Setting</p>
            </div>
          }
        >
          <div className="w-full absolute left-0 right-0 top-24 px-8">
            <div className="max-w-[25rem] mx-auto bg-zinc-300 dark:bg-zinc-800 rounded-lg px-4 py-3 overflow-x-hidden">
              <div className="flex justify-between items-center">
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  Theme
                </p>
                <ThemeSwitcher />
              </div>
              <Divider className="my-2" />
              <div className="flex justify-between items-center">
                <p className="dark:text-red-400 text-sm text-red-400">
                  Clear Cache
                </p>
                <Tooltip
                  content="Clear cache"
                  aria-label="Clear cache"
                  placement="right"
                  isDisabled={confirmClearCache}
                >
                  <AnimatePresence mode="wait">
                    <motion.div
                      layout="preserve-aspect"
                      className="flex items-center"
                      transition={{
                        type: 'spring',
                        bounce: 0.2,
                        duration: 0.4,
                      }}
                    >
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
                        <motion.div
                          layout="preserve-aspect"
                          className="flex items-center"
                        >
                          {confirmClearCache ? 'Clear Now ' : ''}
                          <Icon name="trash" />
                        </motion.div>
                      </Button>
                    </motion.div>
                  </AnimatePresence>
                </Tooltip>
              </div>
            </div>
          </div>
        </Tab>
        <Tab
          key="about"
          title={
            <div className=" flex justify-center align-center gap-2">
              <Icon name="info" />
              <p>About</p>
            </div>
          }
        >
          <div className="w-full absolute left-0 right-0 top-28">
            <About />
          </div>
        </Tab>
      </Tabs>
    </div>
  )
}

export default Setting
