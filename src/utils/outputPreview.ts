import { getPresetOutput, savesAutomatically } from './presetOutput'

type PreviewMedia = {
  readonly config: { readonly presetId?: string | null }
  readonly isProcessCompleted?: boolean
  readonly compressedFile?: {
    readonly isSaved?: boolean
    readonly isSaving?: boolean
  } | null
}

/** An output being moved must not be loaded from its temporary cache path. */
export function isOutputPreviewPending(
  media: PreviewMedia | null | undefined,
  state: { isCompressing: boolean; isSaving: boolean },
) {
  if (!media?.isProcessCompleted) return false
  if (media.compressedFile?.isSaving) return true
  return (
    !media.compressedFile?.isSaved &&
    savesAutomatically(getPresetOutput(media.config.presetId)) &&
    (state.isCompressing || state.isSaving)
  )
}
