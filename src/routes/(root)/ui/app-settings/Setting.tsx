import { DropdownItem, useDisclosure } from '@heroui/react'
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
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import Title from '@/components/Title'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import { usePrimaryColor } from '@/hooks/usePrimaryColor'
import { downloadAndInstallUpdateApp, updateStore } from '@/stores/updateStore'
import { deleteCache as invokeDeleteCache } from '@/tauri/commands/fs'
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
                content="打开设置"
                aria-label="打开设置"
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
            aria-label="带描述的下拉菜单"
            onAction={handleDropdownAction}
          >
            <DropdownItem key="settings" startContent={<Icon name="setting" />}>
              设置
            </DropdownItem>
            <DropdownItem key="about" startContent={<Icon name="info" />}>
              关于
            </DropdownItem>
            <DropdownItem
              key="credits"
              startContent={<Icon name="lowResHeart" />}
            >
              致谢
            </DropdownItem>
            {hasNewVersion ? (
              <DropdownItem
                key="update"
                className="text-primary"
                startContent={<Icon name="download" />}
              >
                更新到 {latestVersion}
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

  const deleteCache = async () => {
    setIsCacheDeleting(true)
    try {
      await invokeDeleteCache()
      toast.success('所有缓存已清除。')
      setConfirmClearCache(false)
    } catch (_) {
      toast.error('清除缓存时出现问题。')
    }
    setIsCacheDeleting(false)
  }

  return (
    <div className="w-full py-10 px-8">
      <section className="mb-6">
        <Title title="设置" iconProps={{ name: 'setting' }} />
      </section>
      <div className="mx-auto bg-zinc-100 dark:bg-zinc-800 rounded-lg px-4 py-3 overflow-hidden">
        <div className="flex justify-between items-center">
          <p className="text-gray-600 dark:text-gray-400 text-sm">主题</p>
          <ThemeSwitcher />
        </div>
        <Divider className="my-2 dark:bg-zinc-700" />
        <div className="flex justify-between items-center">
          <p className="text-gray-600 dark:text-gray-400 text-sm">颜色</p>
          <ColorPicker color={color} onChange={setColor} />
        </div>
        <Divider className="my-2 dark:bg-zinc-700" />
        <div className="flex justify-between items-center">
          <p className="dark:text-red-400 text-sm text-red-400">清除缓存</p>
          <Tooltip
            content="清除缓存"
            aria-label="清除缓存"
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
                      立即清除
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
      toast.error('更新安装失败，请重试。')
    }
  }

  return (
    <div className="w-full py-10 pb-4 px-8">
      <section className="mb-6">
        <Title title="有可用更新" iconProps={{ name: 'download' }} />
      </section>
      <div>
        {isUpdateAvailable && latestVersion ? (
          <>
            <div className="flex justify-between items-center mb-4">
              <div>
                <p className="text-gray-600 dark:text-gray-400 text-xs">
                  当前版本
                </p>
                <p className="font-bold text-sm">{currentVersion}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-600 dark:text-gray-400 text-xs">
                  最新版本
                </p>
                <p className="font-bold text-sm text-primary">
                  {latestVersion}
                </p>
              </div>
            </div>
            <Divider className="my-2" />
            {body && (
              <div className="mt-4">
                <p className="text-primary text-sm mb-2">更新内容</p>
                <ScrollShadow className="max-h-[50vh]">
                  <Markdown content={body} className="text-sm" />
                </ScrollShadow>
              </div>
            )}
            <Divider className="my-2 mt-4" />
            <div className="mt-4 flex justify-end gap-2">
              {!isInstalling ? (
                <Button variant="flat" size="sm" onPress={onClose}>
                  取消
                </Button>
              ) : null}
              <Button
                size="sm"
                className="bg-primary"
                onPress={handleInstall}
                isLoading={isInstalling}
                isDisabled={isInstalling}
              >
                立即更新 {isInstalling ? `(${installProgress}%)` : ''}
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              暂无更新，你正在使用最新版本。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default Setting
