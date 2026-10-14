import { core } from '@tauri-apps/api'

/** Plays the completion sound (by the backend, so also while the window is hidden) */
export function playCompletionSound() {
  return core.invoke<void>('play_completion_sound')
}
