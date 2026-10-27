import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Badge from '@/components/Badge'
import Button from '@/components/Button'
import Icon, { IconProps } from '@/components/Icon'
import Modal, { ModalContent } from '@/components/Modal'
import ScrollShadow from '@/components/ScrollShadow'
import TextInput from '@/components/TextInput'
import Tooltip from '@/components/Tooltip'
import {
  isSettingAvailable,
  SETTINGS_INDEX,
  type SettingId,
  type SettingsPageId,
} from '@/constants/settingsIndex'
import type { Translation } from '@/i18n'
import {
  listenForSettingsRequests,
  settingsDialogStore,
  showSettings,
} from '@/stores/settingsDialogStore'
import { updateStore } from '@/stores/updateStore'
import { getPlatform } from '@/utils/fs'
import { glassBorder } from '@/utils/glass'
import { cn } from '@/utils/tailwind'
import { hasTray } from '@/utils/tray'
import About from './About'
import Credits from './Credits'
import DropZone from './DropZone'
import General from './General'
import History from './History'
import Output from './Output'
import Presets from './Presets'
import WatchedFolders from './WatchedFolders'

type SettingsPage = {
  id: SettingsPageId
  // TODO: replace with dedicated icons
  icon: IconProps['name']
  Component: React.ComponentType
  /** Fills the page's height instead of scrolling as a whole (e.g. a table that scrolls itself) */
  fillsHeight?: boolean
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
      // Compressed by the drop zone's queue (by the main window on Linux, while it is open)
      {
        id: 'watchedFolders',
        icon: 'watchedFolder',
        Component: WatchedFolders,
      },
      {
        id: 'history',
        icon: 'clock',
        Component: History,
        fillsHeight: true,
      },
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
          showSettings()
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
  const { isOpen } = useSnapshot(settingsDialogStore)
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
        showSettings()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    // Asked for by other windows, e.g. the drop zone's
    const stopListeningForRequests = listenForSettingsRequests()

    // "Settings…" in the app menu (macOS)
    const unlistenPromise = getCurrentWebviewWindow().listen(
      OPEN_SETTINGS_EVENT,
      () => {
        showSettings()
      },
    )
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      stopListeningForRequests()
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [])

  const close = () => {
    settingsDialogStore.isOpen = false
    settingsDialogStore.highlight = null
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

type SearchResult =
  | { settingId: SettingId; title: string; pageId: SettingsPageId }
  | { settingId?: undefined; title: string; pageId: SettingsPageId }

/** Settings & pages whose text has every word searched for */
function useSearchResults(query: string): SearchResult[] {
  const { t } = useTranslation()
  return React.useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const matches = (texts: string[]) => {
      const text = texts.join(' ').toLowerCase()
      return words.every((word) => text.includes(word))
    }
    const pageIds = new Set(ALL_PAGES.map((page) => page.id))
    const pages: SearchResult[] = ALL_PAGES.filter((page) =>
      matches([t(`settings.pages.${page.id}`)]),
    ).map((page) => ({
      title: t(`settings.pages.${page.id}`),
      pageId: page.id,
    }))
    const settings: SearchResult[] = (
      Object.entries(SETTINGS_INDEX) as [
        SettingId,
        (typeof SETTINGS_INDEX)[SettingId],
      ][]
    )
      .filter(
        ([, setting]) =>
          isSettingAvailable(setting) &&
          pageIds.has(setting.page) &&
          // Found by the name of its page too, e.g. "output prefix"
          matches([...setting.getText(t), t(`settings.pages.${setting.page}`)]),
      )
      .map(([settingId, setting]) => ({
        settingId,
        title: setting.getText(t)[0],
        pageId: setting.page,
      }))
    return [...pages, ...settings]
  }, [query, t])
}

function SettingsDialog({ onClose, hasNewVersion }: SettingsDialogProps) {
  const { t } = useTranslation()
  const { pageId } = useSnapshot(settingsDialogStore)
  const [search, setSearch] = React.useState('')
  const results = useSearchResults(search)
  const isSearching = search.trim() !== ''
  const selectedPage =
    ALL_PAGES.find((page) => page.id === pageId) ?? ALL_PAGES[0]

  const openResult = (result: SearchResult) => {
    showSettings(
      result.settingId
        ? { settingId: result.settingId }
        : { page: result.pageId },
    )
  }

  return (
    <div className="relative flex w-full h-full">
      <aside className="w-[240px] flex-shrink-0 flex flex-col border-r border-zinc-400 dark:border-zinc-800 p-3">
        <TextInput
          aria-label={t('settings.search.label')}
          placeholder={t('settings.search.label')}
          value={search}
          onValueChange={setSearch}
          isClearable
          onClear={() => setSearch('')}
          startContent={
            <Icon name="search" size={20} className="text-zinc-500" />
          }
          onKeyDown={(evt) => {
            // The first result, as with a search on the web
            if (evt.key === 'Enter' && results[0]) openResult(results[0])
          }}
          className="mt-2"
        />
        <ScrollShadow className="flex-1" hideScrollBar>
          {isSearching ? (
            <nav className="mt-4" aria-label={t('settings.search.results')}>
              {results.length ? (
                results.map((result) => (
                  <button
                    key={result.settingId ?? result.pageId}
                    type="button"
                    onClick={() => openResult(result)}
                    className="w-full flex flex-col px-3 py-1.5 my-0.5 rounded-lg border border-transparent text-left transition-colors hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.05]"
                  >
                    <span className="text-sm text-foreground">
                      {result.title}
                    </span>
                    {result.settingId ? (
                      <span className="text-xs text-zinc-500">
                        {t(`settings.pages.${result.pageId}`)}
                      </span>
                    ) : null}
                  </button>
                ))
              ) : (
                <p className="px-3 text-sm text-zinc-500">
                  {t('settings.search.noResults')}
                </p>
              )}
            </nav>
          ) : (
            SETTINGS_GROUPS.map((group) => (
              <nav key={group.id} className="mt-5 first:mt-4">
                <p className="px-3 mb-1 text-xs text-zinc-500">
                  {t(`settings.groups.${group.id}`)}
                </p>
                {group.pages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => showSettings({ page: page.id })}
                    className={cn([
                      // A transparent border, so the chosen page's frosted glass (& its border)
                      // does not move the text
                      'w-full flex items-center gap-3 px-3 py-1 my-1 rounded-lg border border-transparent text-sm text-left transition-colors',
                      page.id === selectedPage.id
                        ? [
                            // White & raised in light mode, where grey matches the sidebar's
                            'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-zinc-700 dark:shadow-none',
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
            ))
          )}
        </ScrollShadow>
      </aside>

      {selectedPage.fillsHeight ? (
        <div className="flex min-h-0 flex-1 flex-col px-10 py-12">
          <selectedPage.Component />
        </div>
      ) : (
        <ScrollShadow
          // Each page from its top
          key={selectedPage.id}
          className="flex-1 px-10 py-12"
          hideScrollBar
        >
          <selectedPage.Component />
        </ScrollShadow>
      )}
    </div>
  )
}

export default Setting
