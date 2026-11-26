import { open } from '@tauri-apps/plugin-dialog'
import React from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Modal, {
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/Modal'
import TextArea from '@/components/TextArea'
import { toast } from '@/components/Toast'
import {
  DEFAULT_AUDIO_CONTRACT,
  DEFAULT_IMAGE_CONTRACT,
  DEFAULT_VIDEO_CONTRACT,
  validateAndNormalizeContract,
} from '@/contract'
import type { ContractValidationIssue } from '@/contract/types'
import { createPresetFromContract } from '@/stores/presetsStore'
import { logError, logInfo } from '@/tauri/commands/app'
import { readTextFile } from '@/tauri/commands/fs'
import type { PresetMediaType } from '@/types/preset'

type ImportContractModalProps = {
  isOpen: boolean
  defaultMediaType: PresetMediaType
  onClose: () => void
  onCreated: (mediaType: PresetMediaType) => void
}

function getStarterTemplate(mediaType: PresetMediaType) {
  const base =
    mediaType === 'image'
      ? DEFAULT_IMAGE_CONTRACT
      : mediaType === 'audio'
        ? DEFAULT_AUDIO_CONTRACT
        : DEFAULT_VIDEO_CONTRACT
  return JSON.stringify(
    {
      ...base,
      name: '',
    },
    null,
    2,
  )
}

/** Creates a preset from a pasted or loaded CompressO JSON contract */
function ImportContractModal({
  isOpen,
  defaultMediaType,
  onClose,
  onCreated,
}: ImportContractModalProps) {
  const { t } = useTranslation()
  const [text, setText] = React.useState('')
  const [errors, setErrors] = React.useState<string[]>([])
  const [warnings, setWarnings] = React.useState<ContractValidationIssue[]>([])

  React.useEffect(() => {
    if (isOpen) {
      setText(getStarterTemplate(defaultMediaType))
      setErrors([])
      setWarnings([])
    }
  }, [isOpen, defaultMediaType])

  const parseAndValidate = () => {
    setWarnings([])
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setErrors([
        t('contract.import.invalidJson', {
          message: err instanceof Error ? err.message : String(err),
        }),
      ])
      return null
    }
    const res = validateAndNormalizeContract(parsed, {
      mode: 'preset',
      requireName: true,
    })
    if (!res.ok) {
      setErrors(
        res.errors.map((issue) =>
          issue.path ? `${issue.path}: ${issue.message}` : issue.message,
        ),
      )
      setWarnings(res.warnings)
      return null
    }
    setErrors([])
    setWarnings(res.warnings)
    return parsed
  }

  const handleLoadFile = async () => {
    try {
      const filePath = await open({
        directory: false,
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (typeof filePath !== 'string') return
      const contents = await readTextFile(filePath)
      logInfo(`[contract] Loaded contract file for import: ${filePath}`)
      setText(contents)
      setErrors([])
      setWarnings([])
    } catch (error) {
      logError('[contract] Could not load contract file', error)
      toast.error(t('contract.import.readFailed'))
    }
  }

  const handleCreate = () => {
    const parsed = parseAndValidate()
    if (!parsed) return
    const result = createPresetFromContract(parsed, { onConflict: 'error' })
    if (!result.ok) {
      logError(
        `[contract] Could not create preset from contract (${result.code}): ${result.message}`,
      )
      setErrors([result.message])
      return
    }
    logInfo(
      `[contract] Created ${result.preset.mediaType} preset "${result.preset.name}" (${result.preset.id}) from contract`,
    )
    toast.success(t('presets.saved', { name: result.preset.name }))
    onCreated(result.preset.mediaType)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalContent className="rounded-2xl settings-dialog">
        <ModalHeader className="flex items-center justify-between pb-1 pr-10">
          <span>{t('contract.import.title')}</span>
          <Button
            size="sm"
            variant="flat"
            startContent={<Icon name="fileExplorer" size={14} />}
            onPress={() => void handleLoadFile()}
          >
            {t('contract.import.loadFile')}
          </Button>
        </ModalHeader>
        <ModalBody className="gap-3">
          <TextArea
            label={t('contract.import.jsonLabel')}
            value={text}
            onValueChange={(value) => {
              setText(value)
              if (errors.length) setErrors([])
            }}
            minRows={12}
            maxRows={18}
            classNames={{
              input: 'font-mono text-xs leading-relaxed',
            }}
          />
          {errors.length > 0 ? (
            <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger space-y-1 max-h-32 overflow-y-auto">
              {errors.map((err, i) => (
                <p key={i} className="font-mono break-words">
                  {err}
                </p>
              ))}
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning-700 dark:text-warning-400 space-y-1 max-h-24 overflow-y-auto">
              {warnings.map((w, i) => (
                <p key={i} className="break-words">
                  {w.message}
                </p>
              ))}
            </div>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button
            size="sm"
            variant="flat"
            className="mr-auto"
            onPress={parseAndValidate}
          >
            {t('contract.import.validate')}
          </Button>
          <Button size="sm" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            color="primary"
            variant="solid"
            onPress={handleCreate}
          >
            {t('contract.import.create')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ImportContractModal
