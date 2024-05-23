import React from 'react'
import { Tab } from '@nextui-org/tabs'
import { AnimatePresence, motion } from 'framer-motion'

import Tabs from '@/components/Tabs'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import Divider from '@/components/Divider'
import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { deleteCache as invokeDeleteCache } from '@/tauri/commands/fs'
import { toast } from '@/components/Toast'
import About from './About'

function Setting() {
  const [confirmClearCache, setConfirmClearCache] = React.useState(false)
  const [isCacheDeletePending, setIsCacheDeletePending] = React.useState(false)

  const deleteCache = async () => {
    setIsCacheDeletePending(true)
    try {
      await invokeDeleteCache()
      toast.success('All caches were cleared.')
      setConfirmClearCache(false)
    } catch (_) {
      toast.error('Could not clear cache at the moment.')
    }
    setIsCacheDeletePending(false)
  }

  return (
    <div className="min-h-[480px] ml-auto">
      <Tabs className="absolute left-[50%] top-10 translate-x-[-50%]">
        <Tab key="setting" title="Setting">
          <div className="w-full absolute left-0 right-0 top-24">
            <div className="max-w-[500px] mx-auto bg-zinc-300 dark:bg-zinc-800 rounded-lg px-4 py-3 overflow-hidden">
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
                        isLoading={isCacheDeletePending}
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
        <Tab key="about" title="About">
          <div className="w-full absolute left-0 right-0 top-28">
            <About />
          </div>
        </Tab>
      </Tabs>
    </div>
  )
}

export default Setting
