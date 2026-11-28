import { core } from '@tauri-apps/api'

import type { MediaContract } from '@/contract/types'

export const MAIN_SESSION_COMPLETED_EVENT = 'main-session-completed'

export type MainSessionStatus = 'compressing' | 'completed' | 'cancelled'

export type MainSessionItemInfo = {
  id: string
  mediaType: 'video' | 'image' | 'audio'
  pathRaw: string
  fileName: string
  sourceExtension: string
  relativeDir: string
  sizeInBytes?: number | null
  presetId?: string | null
  outputDurationMs: number
  contract?: MediaContract | null
}

export type ActiveSession = {
  batchId: string
  status: MainSessionStatus
  isPaused: boolean
  detached: boolean
  items: MainSessionItemInfo[]
  appState: Record<string, unknown>
  progress: Record<string, number>
  results: Record<string, unknown>
  hasUnsavedOutput: boolean
}

export function getActiveSession() {
  return core.invoke<ActiveSession | null>('get_active_session')
}

export function startMainSession(payload: {
  batchId: string
  items: MainSessionItemInfo[]
  appState: Record<string, unknown>
}) {
  return core.invoke<void>('start_main_session', { payload })
}

export function updateMainSessionState(
  appState: Record<string, unknown>,
  hasUnsavedOutput: boolean,
) {
  return core.invoke<void>('update_main_session_state', {
    appState,
    hasUnsavedOutput,
  })
}

export function clearActiveSession() {
  return core.invoke<void>('clear_active_session')
}
