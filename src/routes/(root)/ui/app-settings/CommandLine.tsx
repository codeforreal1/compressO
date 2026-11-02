import { AccordionItem } from '@heroui/react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import Accordion from '@/components/Accordion'
import Button from '@/components/Button'
import CodeBlock from '@/components/CodeBlock'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import {
  type CliInstallStatus,
  getCliInstallStatus,
  installCli,
  uninstallCli,
} from '@/tauri/commands/cli'
import { getPlatform } from '@/utils/fs'
import { SettingsRow, SettingsSection } from './SettingsLayout'

const { isMacOS, isWindows } = getPlatform()

/** The text's platform (`settings.commandLine.*_macos` …) */
const PLATFORM_CONTEXT = isMacOS ? 'macos' : isWindows ? 'windows' : 'linux'

const USAGE_EXAMPLE = isWindows
  ? 'compresso C:\\Videos\\clip.mp4 --video-preset="Standard"'
  : 'compresso ~/Movies/clip.mov --video-preset="Standard"'

/** Every kind of command, each with what it does (`settings.commandLine.terminal.examples.*`) */
const EXAMPLES = [
  // The example shown above the list, first
  { id: 'preset', code: USAGE_EXAMPLE },
  { id: 'one', code: 'compresso photo.jpg' },
  { id: 'several', code: 'compresso photo.jpg clip.mov song.wav Trip' },
  {
    id: 'presets',
    code: 'compresso photo.jpg clip.mov song.wav --video-preset="Standard" --image-preset="Standard" --audio-preset="Standard"',
  },
  { id: 'singlePreset', code: 'compresso photo.png --preset="Standard"' },
  { id: 'outputFolder', code: 'compresso Trip --output="Compressed"' },
  { id: 'outputFile', code: 'compresso photo.jpg --output="photo.png"' },
  { id: 'audioOnly', code: 'compresso clip.mov --output="clip.mp3"' },
  {
    id: 'flatten',
    code: 'compresso Trip --output="Compressed" --preserve-folder-structure=0',
  },
  { id: 'prefix', code: 'compresso photo.jpg --filename-prefix="small-"' },
  { id: 'skipLarger', code: 'compresso photo.jpg --skip-larger-outputs=1' },
  {
    id: 'replace',
    code: 'compresso photo.jpg --filename-prefix= --replace-original-files=1',
  },
  {
    id: 'hardware',
    code: 'compresso clip.mov --hardware-acceleration=1',
  },
  {
    id: 'targetSize',
    code: 'compresso clip.mov --hardware-acceleration=1 --reach-target-sizes-without-acceleration=1',
  },
  { id: 'dryRun', code: 'compresso Trip --dry-run' },
  { id: 'json', code: 'compresso Trip --json' },
  { id: 'quiet', code: 'compresso Trip --quiet' },
  { id: 'list', code: 'compresso presets' },
  { id: 'help', code: 'compresso --help' },
] as const

/** All the examples, folded away until opened */
function UsageExamples() {
  const { t } = useTranslation()

  return (
    <Accordion isCompact className="mt-3 px-0">
      <AccordionItem
        key="examples"
        aria-label={t('settings.commandLine.terminal.examples.title')}
        title={t('settings.commandLine.terminal.examples.title')}
        classNames={{
          // The arrow right after the title, not at the far side
          trigger: 'py-1 w-auto justify-start gap-1.5',
          titleWrapper: 'flex-none',
          title: 'text-xs text-primary',
          content: 'pt-2 pb-1',
        }}
        indicator={({ isOpen }) => (
          <Icon name="caret" size={14} className={isOpen ? '-rotate-90' : ''} />
        )}
      >
        <div className="flex flex-col gap-4">
          {EXAMPLES.map(({ id, code }) => (
            <div key={id}>
              <CodeBlock code={code} isCopyable />
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {t(
                  `settings.commandLine.terminal.examples.${id === 'replace' && isWindows ? 'replaceWindows' : id}`,
                )}
              </p>
            </div>
          ))}
        </div>
      </AccordionItem>
    </Accordion>
  )
}

/** What AI agents (MCP clients) are given to run the MCP server */
const MCP_CONFIG = `{
  "mcpServers": {
    "compresso": { "command": "compresso", "args": ["mcp"] }
  }
}`

/** Installs & removes the `compresso` command (see `cli_install.rs`) */
function TerminalCommandRow() {
  const { t } = useTranslation()
  const [status, setStatus] = React.useState<CliInstallStatus | null>(null)
  const [isBusy, setIsBusy] = React.useState(false)

  React.useEffect(() => {
    getCliInstallStatus()
      .then(setStatus)
      .catch(() => {})
  }, [])

  const run = async (action: typeof installCli, failedMessage: string) => {
    setIsBusy(true)
    try {
      setStatus(await action())
    } catch (error) {
      // Cancelled at the password prompt: nothing to tell
      if (String(error) !== 'CANCELLED') toast.error(failedMessage)
      getCliInstallStatus()
        .then(setStatus)
        .catch(() => {})
    } finally {
      setIsBusy(false)
    }
  }

  const state = status?.state
  const description = [
    t('settings.commandLine.terminal.command.description', {
      context: PLATFORM_CONTEXT,
    }),
    state ? t(`settings.commandLine.terminal.command.status_${state}`) : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <SettingsRow
      settingId="cliCommand"
      title={t('settings.commandLine.terminal.command.title')}
      description={description}
    >
      {status?.canInstall ? (
        state === 'installed' ? (
          <Button
            size="sm"
            isLoading={isBusy}
            onPress={() =>
              run(
                uninstallCli,
                t('settings.commandLine.terminal.command.removeFailed'),
              )
            }
          >
            {t('settings.commandLine.terminal.command.remove')}
          </Button>
        ) : (
          <Button
            size="sm"
            color="primary"
            variant="solid"
            isLoading={isBusy}
            onPress={() =>
              run(
                installCli,
                t('settings.commandLine.terminal.command.installFailed'),
              )
            }
          >
            {t('settings.commandLine.terminal.command.install')}
          </Button>
        )
      ) : null}
    </SettingsRow>
  )
}

/** Settings -> CLI: the `compresso` command & its MCP server, for AI agents */
function CommandLine() {
  const { t } = useTranslation()

  return (
    <>
      <SettingsSection title={t('settings.commandLine.terminal.title')}>
        <TerminalCommandRow />
        <SettingsRow
          settingId="cliUsage"
          title={t('settings.commandLine.terminal.usage.title')}
          description={
            <>
              {t('settings.commandLine.terminal.usage.description')}
              <CodeBlock code={USAGE_EXAMPLE} isCopyable className="mt-3" />
              <UsageExamples />
            </>
          }
        />
      </SettingsSection>
      <SettingsSection title={t('settings.commandLine.agents.title')}>
        <SettingsRow
          settingId="cliMcp"
          title={t('settings.commandLine.agents.mcp.title')}
          description={
            <>
              {t('settings.commandLine.agents.mcp.description')}
              <CodeBlock code={MCP_CONFIG} isCopyable className="mt-3" />
            </>
          }
        />
      </SettingsSection>
    </>
  )
}

export default CommandLine
