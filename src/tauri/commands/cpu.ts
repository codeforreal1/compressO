import { core } from '@tauri-apps/api'

/** The CPU threads available to FFmpeg (logical processors) */
export function getCpuThreadCount() {
  return core.invoke<number>('get_cpu_thread_count')
}

/** Limits FFmpeg's CPU encoding threads; 0 uses all available threads */
export function setCpuThreadLimit(limit: number) {
  return core.invoke<void>('set_cpu_thread_limit', { limit })
}
