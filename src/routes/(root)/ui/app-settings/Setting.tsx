import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { proxy, useSnapshot } from 'valtio'

import Badge from '@/components/Badge'
import Button from '@/components/Button'
import Icon, { IconProps } from '@/components/Icon'
import Modal, { ModalContent } from '@/components/Modal'
import ScrollShadow from '@/components/ScrollShadow'
import Tooltip from '@/components/Tooltip'
import type { Translation } from '@/i18n'
import { updateStore } from '@/stores/updateStore'
import { getPlatform } from '@/utils/fs'
import { glassBorder } from '@/utils/glass'
import { cn } from '@/utils/tailwind'
import { hasTray } from '@/utils/tray'
import About from './About'
import Credits from './Credits'
import DropZone from './DropZone'
import General from './General'
import Output from './Output'
import Presets from './Presets'

type SettingsPage = {
  id: keyof Translation['settings']['pages']
  // TODO: replace with dedicated icons
  icon: IconProps['name']
  Component: React.ComponentType
}

const { isMacOS } = getPlatform()

const SETTINGS_GROUPS: {
  /** Translated (`settings.groups`) */
  id: keyof Translation['settings']['groups']
  pages: SettingsPage[]
}[] = [
  {
    id: 'settings',
    pages: [
      {
        id: 'general',
        icon: 'setting',
        Component: General,
      },
      {
        id: 'output',
        icon: 'fileExplorer',
        Component: Output,
      },
      {
        id: 'presets',
        icon: 'star',
        Component: Presets,
      },
      // The drop zone is in the tray: the macOS menu bar or the Windows system tray
      ...(hasTray
        ? [
            {
              id: 'dropZone' as const,
              icon: 'dropzone' as const,
              Component: DropZone,
            },
          ]
        : []),
    ],
  },
  {
    id: 'app',
    pages: [
      {
        id: 'about',
        icon: 'info',
        Component: About,
      },
      {
        id: 'credits',
        icon: 'lowResHeart',
        Component: Credits,
      },
    ],
  },
]

const ALL_PAGES = SETTINGS_GROUPS.flatMap((group) => group.pages)

const settingsDialogProxy = proxy({ isOpen: false })

/** Sent by the backend when "Settings…" is chosen in the app menu */
const OPEN_SETTINGS_EVENT = 'open-settings'

/** Settings button, shown on the home screen */
function Setting() {
  const { t } = useTranslation()
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
          content={`${t('settings.open')} (${isMacOS ? '⌘' : 'Ctrl'} ,)`}
          aria-label={t('settings.open')}
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

    // "Settings…" in the app menu (macOS)
    const unlistenPromise = getCurrentWebviewWindow().listen(
      OPEN_SETTINGS_EVENT,
      () => {
        settingsDialogProxy.isOpen = true
      },
    )
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      unlistenPromise.then((unlisten) => unlisten())
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
      {/* Translucent with the tinted window like other modals, but opaque while the theme switches:
      the backdrop blur isn't preserved in the view transition snapshots, so the app behind would
      show through */}
      <ModalContent className="w-[90vw] max-w-[1000px] h-[min(720px,85vh)] overflow-hidden rounded-2xl settings-dialog [.theme-transitioning_&]:bg-zinc-100 dark:[.theme-transitioning_&]:bg-zinc-900">
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
  const { t } = useTranslation()
  const [selectedPageId, setSelectedPageId] = React.useState(ALL_PAGES[0].id)
  const selectedPage =
    ALL_PAGES.find((page) => page.id === selectedPageId) ?? ALL_PAGES[0]

  return (
    <div className="relative flex w-full h-full">
      <aside className="w-[240px] flex-shrink-0 flex flex-col border-r border-zinc-400 dark:border-zinc-800 p-3">
        <ScrollShadow className="flex-1" hideScrollBar>
          {SETTINGS_GROUPS.map((group) => (
            <nav key={group.id} className="mt-5 first:mt-2">
              <p className="px-3 mb-1 text-xs text-zinc-500">
                {t(`settings.groups.${group.id}`)}
              </p>
              {group.pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => setSelectedPageId(page.id)}
                  className={cn([
                    // A transparent border, so the chosen page's frosted glass (& its border)
                    // does not move the text
                    'w-full flex items-center gap-3 px-3 py-1 my-1 rounded-lg border border-transparent text-sm text-left transition-colors',
                    page.id === selectedPage.id
                      ? [
                          'bg-zinc-100 dark:bg-zinc-700',
                          glassBorder,
                          'text-foreground font-medium',
                        ]
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.05]',
                  ])}
                >
                  <Icon name={page.icon} size={18} />
                  <span className="flex-1">
                    {t(`settings.pages.${page.id}`)}
                  </span>
                  {page.id === 'about' && hasNewVersion ? (
                    <span
                      className="w-2 h-2 rounded-full bg-primary"
                      aria-label={t('settings.about.updateAvailable')}
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
