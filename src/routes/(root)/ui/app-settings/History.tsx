import { event } from '@tauri-apps/api'
import React from 'react'
import { useTranslation } from 'react-i18next'

import AnimatedLabel from '@/components/AnimatedLabel'
import Button from '@/components/Button'
import Icon from '@/components/Icon'
import TextInput from '@/components/TextInput'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import i18n from '@/i18n'
import { showItemInFileManager } from '@/tauri/commands/fs'
import {
  clearHistory,
  getHistory,
  HISTORY_EVENT,
  type HistoryEntry,
  pathsExist,
} from '@/tauri/commands/history'
import { formatBytes, getParentDirectory } from '@/utils/fs'
import { cn } from '@/utils/tailwind'

/** Every row has this height, so only the rows in view are drawn (the history grows quickly) */
const ROW_HEIGHT = 52
/** Rows drawn above & below the view, so scrolling does not show empty space */
const OVERSCAN_ROWS = 6

/** A file's name from its path */
function getName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** The space an output saved (none when it is larger) */
function getSavedBytes(entry: HistoryEntry) {
  return entry.originalSize != null && entry.outputSize != null
    ? Math.max(0, entry.originalSize - entry.outputSize)
    : 0
}

/** The files of a dropped folder, compressed together */
type FolderGroup = {
  key: string
  name: string
  entries: HistoryEntry[]
  /** The dropped folder, where its originals were */
  originalFolder: string | null
  latest: number
}

type Row =
  | { type: 'entry'; entry: HistoryEntry; isInFolder: boolean }
  | { type: 'folder'; group: FolderGroup; isExpanded: boolean }

/** Where a dropped folder was (from one of its files, e.g. `/a/Vacation/Day1/clip.mp4`) */
function getOriginalFolder(entry: HistoryEntry) {
  if (!entry.relativeDir || !entry.folderName) return null
  const directory = getParentDirectory(entry.originalPath, 1)
  const relativeDir = entry.relativeDir.replace(
    /\//g,
    directory.includes('\\') ? '\\' : '/',
  )
  return directory.endsWith(relativeDir)
    ? `${directory.slice(0, directory.length - relativeDir.length)}${entry.folderName}`
    : null
}

/**
 * The rows of the table, newest first: each media on its own, & those of a dropped folder under
 * its folder (shown when it is open, or while searching)
 */
function buildRows(
  entries: readonly HistoryEntry[],
  expandedFolders: ReadonlySet<string>,
  isSearching: boolean,
): Row[] {
  const groups = new Map<string, FolderGroup>()
  const items: ({ latest: number } & (
    | { entry: HistoryEntry }
    | { group: FolderGroup }
  ))[] = []
  for (const entry of entries) {
    if (entry.folderName && entry.groupId) {
      const key = `${entry.groupId}\n${entry.folderName}`
      let group = groups.get(key)
      if (!group) {
        group = {
          key,
          name: entry.folderName,
          entries: [],
          originalFolder: getOriginalFolder(entry),
          latest: entry.completedAt,
        }
        groups.set(key, group)
        items.push({ latest: entry.completedAt, group })
      }
      group.entries.push(entry)
      group.latest = Math.max(group.latest, entry.completedAt)
    } else {
      items.push({ latest: entry.completedAt, entry })
    }
  }
  for (const item of items) {
    if ('group' in item) item.latest = item.group.latest
  }
  items.sort((a, b) => b.latest - a.latest)

  const rows: Row[] = []
  for (const item of items) {
    if ('entry' in item) {
      rows.push({ type: 'entry', entry: item.entry, isInFolder: false })
      continue
    }
    const isExpanded = isSearching || expandedFolders.has(item.group.key)
    rows.push({ type: 'folder', group: item.group, isExpanded })
    if (isExpanded) {
      for (const entry of [...item.group.entries].sort(
        (a, b) => b.completedAt - a.completedAt,
      )) {
        rows.push({ type: 'entry', entry, isInFolder: true })
      }
    }
  }
  return rows
}

/** Every entry, kept up to date (in any window, the history changes as media is compressed) */
function useHistory() {
  const [entries, setEntries] = React.useState<HistoryEntry[] | null>(null)
  React.useEffect(() => {
    let isCurrent = true
    const load = () => {
      getHistory()
        .then((history) => {
          if (isCurrent) setEntries(history)
        })
        .catch(() => {
          if (isCurrent) setEntries([])
        })
    }
    load()
    const unlisten = event.listen(HISTORY_EVENT, load)
    return () => {
      isCurrent = false
      unlisten.then((stop) => stop()).catch(() => {})
    }
  }, [])
  return entries
}

type FileButtonProps = {
  path: string | null | undefined
  label: string
  /** Why it cannot be shown, when there is no path (e.g. the output was not saved) */
  missingLabel: string
}

/**
 * Shows a file (or folder) in the file manager. Whether it is still there is only checked when it
 * is clicked (not for every row), with a message when it was moved or deleted.
 */
function FileButton({ path, label, missingLabel }: FileButtonProps) {
  const { t } = useTranslation()
  const tooltip = path ? label : missingLabel
  return (
    <Tooltip content={tooltip} aria-label={tooltip}>
      {/* A disabled button gets no hover, so its wrapper shows the tooltip */}
      <span className="inline-flex">
        <Button
          size="sm"
          variant="light"
          isDisabled={!path}
          aria-label={tooltip}
          className="h-7 min-w-0 gap-1 px-2 text-[11px] font-normal"
          onPress={async () => {
            if (!path) return
            const [exists] = await pathsExist([path]).catch(() => [true])
            if (!exists) {
              toast.error(t('settings.history.missing'))
              return
            }
            showItemInFileManager(path).catch(() => {
              toast.error(t('settings.history.missing'))
            })
          }}
        >
          <Icon name="fileExplorer" size={13} />
          {label}
        </Button>
      </span>
    </Tooltip>
  )
}

/** The size before & after, & how much smaller (or larger) */
function SizeChange({
  originalSize,
  outputSize,
}: {
  originalSize: number | null | undefined
  outputSize: number | null | undefined
}) {
  const { t } = useTranslation()
  if (originalSize == null || outputSize == null) return null
  const reduction =
    originalSize > 0
      ? Math.round(((originalSize - outputSize) * 100) / originalSize)
      : 0
  return (
    <div className="text-right">
      <p className="text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
        {t('common.sizeChange', {
          from: formatBytes(originalSize),
          to: formatBytes(outputSize),
        })}
      </p>
      {/* Only when smaller; a larger output shows its sizes alone */}
      {reduction > 0 ? (
        <p className="text-[11px] tabular-nums text-success-600 dark:text-success-400">
          {t('queue.status.smaller', { value: reduction })}
        </p>
      ) : null}
    </div>
  )
}

/** Where an entry came from, & its preset, e.g. "Drop zone · Web" */
function describeEntry(entry: HistoryEntry, date: string) {
  const source =
    entry.source === 'watchedFolder'
      ? i18n.t('settings.history.source_watchedFolder', {
          name: entry.watchFolderName ?? '',
        })
      : entry.source === 'dropZone'
        ? i18n.t('settings.history.source_dropZone')
        : i18n.t('settings.history.source_main')
  return [date, source, entry.presetName ?? i18n.t('presets.standard')].join(
    ' · ',
  )
}

const dateFormat = () =>
  new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

function EntryRow({
  entry,
  isInFolder,
}: {
  entry: HistoryEntry
  isInFolder: boolean
}) {
  const { t } = useTranslation()
  const name = getName(entry.originalPath)
  return (
    <div
      className={cn(
        'group flex h-full items-center gap-3 border-b border-zinc-200 pr-1 dark:border-white/[0.06]',
        isInFolder ? 'pl-8' : 'pl-2',
      )}
    >
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm text-foreground"
          title={entry.originalPath}
        >
          {name}
        </p>
        <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
          {describeEntry(entry, dateFormat().format(entry.completedAt))}
        </p>
      </div>
      <SizeChange
        originalSize={entry.originalSize}
        outputSize={entry.outputSize}
      />
      <div className="flex shrink-0 items-center">
        <FileButton
          path={entry.originalPath}
          label={t('settings.history.original')}
          missingLabel={t('settings.history.missing')}
        />
        <FileButton
          path={entry.outputPath}
          label={t('settings.history.output')}
          missingLabel={t('settings.history.notSaved')}
        />
      </div>
    </div>
  )
}

function FolderRow({
  group,
  isExpanded,
  onToggle,
}: {
  group: FolderGroup
  isExpanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const originalSize = group.entries.reduce(
    (total, entry) => total + (entry.originalSize ?? 0),
    0,
  )
  const outputSize = group.entries.reduce(
    (total, entry) => total + (entry.outputSize ?? 0),
    0,
  )
  return (
    <div className="flex h-full items-center gap-3 border-b border-zinc-200 pl-1 pr-1 dark:border-white/[0.06]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label={t(
          isExpanded
            ? 'settings.history.hideFiles'
            : 'settings.history.showFiles',
          { name: group.name },
        )}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pl-1 text-left hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.04]"
      >
        <Icon
          name="chevron"
          size={14}
          className={cn(
            'shrink-0 text-zinc-500 transition-transform duration-200',
            isExpanded ? 'rotate-0' : '-rotate-90',
          )}
        />
        <Icon
          name="fileExplorer"
          size={14}
          className="shrink-0 text-zinc-500"
        />
        <span className="min-w-0">
          <span className="block truncate text-sm text-foreground">
            {group.name}
          </span>
          <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {[
              dateFormat().format(group.latest),
              t('settings.history.fileCount', { count: group.entries.length }),
            ].join(' · ')}
          </span>
        </span>
      </button>
      <SizeChange originalSize={originalSize} outputSize={outputSize} />
      <div className="flex shrink-0 items-center">
        <FileButton
          path={group.originalFolder}
          label={t('settings.history.original')}
          missingLabel={t('settings.history.missing')}
        />
      </div>
    </div>
  )
}

/** The totals of the history, shown above its table */
function getStats(entries: readonly HistoryEntry[]) {
  let originalBytes = 0
  let outputBytes = 0
  let savedBytes = 0
  for (const entry of entries) {
    if (entry.originalSize == null || entry.outputSize == null) continue
    originalBytes += entry.originalSize
    outputBytes += entry.outputSize
    savedBytes += getSavedBytes(entry)
  }
  return {
    files: entries.length,
    originalBytes,
    outputBytes,
    savedBytes,
    reduction:
      originalBytes > 0
        ? Math.round(((originalBytes - outputBytes) * 100) / originalBytes)
        : 0,
  }
}

/** A total of the history, e.g. "Space saved: 4.2 GB" */
function Stat({
  label,
  value,
  isHighlighted,
}: {
  label: string
  value: string
  isHighlighted?: boolean
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 truncate text-lg tabular-nums',
          isHighlighted ? 'text-primary' : 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}

/** The height of an element, kept up to date (e.g. the table, which fills the page) */
function useHeight<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  const [height, setHeight] = React.useState(0)
  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.observe(element)
    setHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])
  return [ref, height] as const
}

/**
 * Past compressions (see `-history.ts`), newest first: the totals at the top, then a table that
 * fills the page & only draws the rows in view, each with buttons to show its original & its
 * output (as recorded; they may have been moved or deleted since)
 */
function History() {
  const { t } = useTranslation()
  const entries = useHistory()
  const [search, setSearch] = React.useState('')
  const [expandedFolders, setExpandedFolders] = React.useState<
    ReadonlySet<string>
  >(new Set())
  const [confirmClear, setConfirmClear] = React.useState(false)

  const query = search.trim().toLowerCase()
  const filtered = React.useMemo(
    () =>
      !entries || !query
        ? (entries ?? [])
        : entries.filter((entry) =>
            [
              getName(entry.originalPath),
              entry.folderName,
              entry.watchFolderName,
              // As shown (the Standard preset is recorded without a name)
              entry.presetName ?? t('presets.standard'),
            ].some((text) => text?.toLowerCase().includes(query)),
          ),
    [entries, query, t],
  )
  const rows = React.useMemo(
    () => buildRows(filtered, expandedFolders, !!query),
    [filtered, expandedFolders, query],
  )
  const stats = React.useMemo(() => getStats(entries ?? []), [entries])

  // Only the rows in view (& a few around them) are drawn
  const [tableRef, tableHeight] = useHeight<HTMLDivElement>()
  const [scrollTop, setScrollTop] = React.useState(0)
  const firstIndex = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS,
  )
  const lastIndex = Math.min(
    rows.length,
    Math.ceil((scrollTop + tableHeight) / ROW_HEIGHT) + OVERSCAN_ROWS,
  )
  const visibleRows = rows.slice(firstIndex, lastIndex)

  const toggleFolder = (key: string) => {
    setExpandedFolders((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <TextInput
          aria-label={t('settings.history.search')}
          placeholder={t('settings.history.search')}
          value={search}
          onValueChange={setSearch}
          isClearable
          onClear={() => setSearch('')}
          className="flex-1"
        />
        <Button
          size="sm"
          // A frosted button with red text, turning solid red to confirm
          color={confirmClear ? 'danger' : 'default'}
          variant="solid"
          isDisabled={!entries?.length}
          className={cn(
            'h-8 gap-1.5 px-3 font-normal',
            !confirmClear && 'text-danger dark:text-danger-400',
          )}
          onPress={() => {
            if (!confirmClear) {
              setConfirmClear(true)
              return
            }
            setConfirmClear(false)
            clearHistory().catch(() => {
              toast.error(t('settings.history.clearFailed'))
            })
          }}
          onBlur={() => setConfirmClear(false)}
        >
          <Icon name="trash" size={14} />
          <AnimatedLabel>
            {confirmClear
              ? t('settings.history.clearConfirm')
              : t('settings.history.clear')}
          </AnimatedLabel>
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-white/[0.08]">
        {/* The totals, as the table's header */}
        <div className="grid shrink-0 grid-cols-5 divide-x divide-zinc-200 border-b border-zinc-200 bg-zinc-100/60 dark:divide-white/[0.06] dark:border-white/[0.08] dark:bg-white/[0.02]">
          <Stat
            label={t('settings.history.stats.saved')}
            value={formatBytes(stats.savedBytes)}
            isHighlighted
          />
          <Stat
            label={t('settings.history.stats.files')}
            value={stats.files.toLocaleString(i18n.language)}
          />
          <Stat
            label={t('settings.history.stats.original')}
            value={formatBytes(stats.originalBytes)}
          />
          <Stat
            label={t('settings.history.stats.output')}
            value={formatBytes(stats.outputBytes)}
          />
          <Stat
            label={t('settings.history.stats.reduction')}
            value={`${stats.reduction}%`}
          />
        </div>

        <div
          ref={tableRef}
          className="relative min-h-0 flex-1 overflow-y-auto"
          onScroll={(evt) => setScrollTop(evt.currentTarget.scrollTop)}
        >
          {entries && rows.length === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {query
                ? t('settings.history.noResults')
                : t('settings.history.empty')}
            </p>
          ) : null}
          <div
            className="relative"
            style={{ height: rows.length * ROW_HEIGHT }}
          >
            {visibleRows.map((row, index) => (
              <div
                key={row.type === 'entry' ? row.entry.id : row.group.key}
                className="absolute left-0 right-0"
                style={{
                  top: (firstIndex + index) * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                }}
              >
                {row.type === 'entry' ? (
                  <EntryRow entry={row.entry} isInFolder={row.isInFolder} />
                ) : (
                  <FolderRow
                    group={row.group}
                    isExpanded={row.isExpanded}
                    onToggle={() => toggleFolder(row.group.key)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default History
