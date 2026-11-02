import React from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@/components/Button'
import CodeBlock from '@/components/CodeBlock'
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

/** Settings -> Command Line: the `compresso` command & its MCP server, for AI agents */
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
