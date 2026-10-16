import React from 'react'

import Button from '@/components/Button'
import Modal, {
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/Modal'
import TextInput from '@/components/TextInput'
import { presetsStore } from '@/stores/presetsStore'
import { PRESET_MEDIA_LABELS, PresetMediaType } from '@/types/preset'

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
          Save {PRESET_MEDIA_LABELS[mediaType].title} Preset
        </ModalHeader>
        <ModalBody>
          <TextInput
            autoFocus
            label="Name"
            placeholder={
              mediaType === 'video'
                ? 'e.g. Web 1080p'
                : mediaType === 'audio'
                  ? 'e.g. Podcast'
                  : 'e.g. Web'
            }
            value={name}
            maxLength={40}
            onValueChange={setName}
            isInvalid={isNameTaken}
            errorMessage={
              isNameTaken ? 'A preset with this name already exists.' : null
            }
            onKeyDown={(evt) => {
              if (evt.key === 'Enter') handleSave()
            }}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Presets can be renamed, reordered and deleted in Settings, under
            Presets.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" onPress={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            color="primary"
            variant="solid"
            isDisabled={!canSave}
            onPress={handleSave}
          >
            Save
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default SavePresetModal
