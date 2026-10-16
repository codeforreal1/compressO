import { createContext, useContext } from 'react'

/** Settings of a batch the video settings edit: its videos', or its audio files' */
export type BatchVideoConfigKey = 'videoConfig' | 'audioFileConfig'

/** Provided by `VideoSettings`; the videos' settings by default */
export const BatchVideoConfigKeyContext =
  createContext<BatchVideoConfigKey>('videoConfig')

/** Key of the batch settings (in `commonConfigForBatchCompression`) a setting edits */
export function useBatchVideoConfigKey() {
  return useContext(BatchVideoConfigKeyContext)
}
