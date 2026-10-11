import React from 'react'
import { proxy, useSnapshot } from 'valtio'

import Badge from '@/components/Badge'
import Button from '@/components/Button'
import Icon, { IconProps } from '@/components/Icon'
import Modal, { ModalContent } from '@/components/Modal'
import ScrollShadow from '@/components/ScrollShadow'
import Tooltip from '@/components/Tooltip'
import { updateStore } from '@/stores/updateStore'
import { getPlatform } from '@/utils/fs'
import { cn } from '@/utils/tailwind'
import About from './About'
import Credits from './Credits'
import General from './General'
import Output from './Output'

type SettingsPage = {
  id: string
  label: string
  // TODO: replace with dedicated icons
  icon: IconProps['name']
  Component: React.ComponentType
}

const SETTINGS_GROUPS: { label: string; pages: SettingsPage[] }[] = [
  {
    label: 'Settings',
    pages: [
      {
        id: 'general',
        label: 'General',
        icon: 'setting',
        Component: General,
      },
      {
        id: 'output',
        label: 'Output',
        icon: 'fileExplorer',
        Component: Output,
      },
    ],
  },
  {
    label: 'CompressO',
    pages: [
      {
        id: 'about',
        label: 'About',
        icon: 'info',
        Component: About,
      },
      {
        id: 'credits',
        label: 'Credits',
        icon: 'lowResHeart',
        Component: Credits,
      },
    ],
  },
]

const ALL_PAGES = SETTINGS_GROUPS.flatMap((group) => group.pages)

const settingsDialogProxy = proxy({ isOpen: false })

const { isMacOS } = getPlatform()

/** Settings button, shown on the home screen */
function Setting() {
  const { isUpdateAvailable, latestVersion } = useSnapshot(updateStore)

  const hasNewVersion = !!(isUpdateAvailable && latestVersion)

  return (
    <div className="absolute bottom-4 left-4 p-0 z-[1]">
      <Button
        isIconOnly
        size="sm"
        variant="light"
        onPress={() => {
          settingsDialogProxy.isOpen = true
        }}
      >
        <Tooltip
          content={`Open Settings (${isMacOS ? '⌘' : 'Ctrl'} ,)`}
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
    </div>
  )
}

/**
 * The settings dialog. Rendered on every screen (not only where the button is) so it can also be
 * opened with Ctrl+, (or ⌘+, on macOS) while media is being edited.
 */
export function SettingsDialogHost() {
  const { isOpen } = useSnapshot(settingsDialogProxy)
  const { isUpdateAvailable, latestVersion } = useSnapshot(updateStore)

  const hasNewVersion = !!(isUpdateAvailable && latestVersion)

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isShortcut =
        e.key === ',' &&
        (e.ctrlKey || (isMacOS && e.metaKey)) &&
        !e.altKey &&
        !e.shiftKey
      if (isShortcut) {
        e.preventDefault()
        settingsDialogProxy.isOpen = true
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const close = () => {
    settingsDialogProxy.isOpen = false
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      motionVariant="bottomToTop"
      size="5xl"
    >
      {/* Opaque background: the translucent backdrop-blur look of other modals isn't preserved in
      the theme switch's view transition snapshots, so the app behind would show through */}
      <ModalContent className="w-[90vw] max-w-[1000px] h-[min(720px,85vh)] overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-900 settings-dialog">
        <SettingsDialog onClose={close} hasNewVersion={hasNewVersion} />
      </ModalContent>
    </Modal>
  )
}

type SettingsDialogProps = {
  onClose: () => void
  hasNewVersion: boolean
}

function SettingsDialog({ onClose, hasNewVersion }: SettingsDialogProps) {
  const [selectedPageId, setSelectedPageId] = React.useState(ALL_PAGES[0].id)
  const selectedPage =
    ALL_PAGES.find((page) => page.id === selectedPageId) ?? ALL_PAGES[0]

  return (
    <div className="relative flex w-full h-full">
      <aside className="w-[240px] flex-shrink-0 flex flex-col border-r border-zinc-200 dark:border-zinc-800 p-3">
        <ScrollShadow className="flex-1" hideScrollBar>
          {SETTINGS_GROUPS.map((group) => (
            <nav key={group.label} className="mt-5 first:mt-2">
              <p className="px-3 mb-1 text-xs text-zinc-500">{group.label}</p>
              {group.pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => setSelectedPageId(page.id)}
                  className={cn([
                    'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors',
                    page.id === selectedPage.id
                      ? 'bg-zinc-200/70 dark:bg-zinc-800 text-foreground font-medium'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60',
                  ])}
                >
                  <Icon name={page.icon} size={18} />
                  <span className="flex-1">{page.label}</span>
                  {page.id === 'about' && hasNewVersion ? (
                    <span
                      className="w-2 h-2 rounded-full bg-primary"
                      aria-label="Update available"
                    />
                  ) : null}
                </button>
              ))}
            </nav>
          ))}
        </ScrollShadow>
      </aside>

      <ScrollShadow className="flex-1 px-10 py-12" hideScrollBar>
        <selectedPage.Component />
      </ScrollShadow>
    </div>
  )
}

export default Setting
