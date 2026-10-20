import React from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@/components/Button'
import Modal, {
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/Modal'
import TextInput from '@/components/TextInput'
import { presetsStore } from '@/stores/presetsStore'
import type { PresetMediaType, PresetOutput } from '@/types/preset'
import PresetOutputFields from '../app-settings/PresetOutputFields'

type SavePresetModalProps = {
  isOpen: boolean
  mediaType: PresetMediaType
  onClose: () => void
  /** With its own output, or `null` to follow the Standard preset's */
  onSave: (name: string, output: PresetOutput | null) => void
}

/** Asks for the name of a new preset, & where its outputs are saved */
function SavePresetModal({
  isOpen,
  mediaType,
  onClose,
  onSave,
}: SavePresetModalProps) {
  const { t } = useTranslation()
  const [name, setName] = React.useState('')
  const [output, setOutput] = React.useState<PresetOutput | null>(null)

  React.useEffect(() => {
    if (isOpen) {
      setName('')
      setOutput(null)
    }
  }, [isOpen])

  const trimmedName = name.trim()
  const isNameTaken =
    trimmedName.toLowerCase() === 'standard' ||
    presetsStore.presets.some(
      (preset) =>
        preset.mediaType === mediaType &&
        preset.name.toLowerCase() === trimmedName.toLowerCase(),
    )
  const canSave = trimmedName.length > 0 && !isNameTaken

  const handleSave = () => {
    if (canSave) onSave(trimmedName, output)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      {/* Normal weight throughout, like the settings dialog (only section headings are bold) */}
      <ModalContent className="rounded-2xl settings-dialog">
        <ModalHeader className="pb-1">
          {t('presets.save.title', { context: mediaType })}
        </ModalHeader>
        <ModalBody>
          <TextInput
            autoFocus
            label={t('presets.save.name')}
            placeholder={t('presets.save.placeholder', { context: mediaType })}
            value={name}
            maxLength={40}
            onValueChange={setName}
            isInvalid={isNameTaken}
            errorMessage={isNameTaken ? t('presets.save.nameTaken') : null}
            onKeyDown={(evt) => {
              if (evt.key === 'Enter') handleSave()
            }}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('presets.save.hint')}
          </p>
          <PresetOutputFields value={output} onChange={setOutput} />
        </ModalBody>
        <ModalFooter>
          <Button size="sm" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            color="primary"
            variant="solid"
            isDisabled={!canSave}
            onPress={handleSave}
          >
            {t('common.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default SavePresetModal
