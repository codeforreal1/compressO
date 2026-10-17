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
import type { PresetMediaType } from '@/types/preset'

type SavePresetModalProps = {
  isOpen: boolean
  mediaType: PresetMediaType
  onClose: () => void
  onSave: (name: string) => void
}

/** Asks for the name of a new preset */
function SavePresetModal({
  isOpen,
  mediaType,
  onClose,
  onSave,
}: SavePresetModalProps) {
  const { t } = useTranslation()
  const [name, setName] = React.useState('')

  React.useEffect(() => {
    if (isOpen) setName('')
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
    if (canSave) onSave(trimmedName)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xs">
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
