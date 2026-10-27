import { core, event } from '@tauri-apps/api'

import { CustomEvents } from '@/types/compression'
import type { WaveformChunk } from '@/types/waveform'

export async function getAudioWaveform(
  path: string,
  chunk: number,
  chunkSeconds: number,
  requestId: string,
  track = 0,
): Promise<WaveformChunk> {
  const result = await core.invoke<ArrayBuffer | number[]>(
    'get_audio_waveform',
    {
      path,
      chunk,
      chunkSeconds,
      requestId,
      track,
    },
  )
  const bytes =
    result instanceof ArrayBuffer ? result : new Uint8Array(result).buffer
  const view = new DataView(bytes)
  if (
    view.byteLength < 16 ||
    view.getUint32(0, false) !== 0x434f5746 ||
    view.getUint32(4, true) !== 1
  ) {
    throw new Error('Invalid waveform data')
  }
  const count = view.getUint32(8, true)
  const sampleHz = view.getFloat32(12, true)
  if (
    count > 15151 ||
    view.byteLength !== 16 + count * 4 ||
    !Number.isFinite(sampleHz) ||
    sampleHz <= 0
  ) {
    throw new Error('Invalid waveform size')
  }
  const values = new Uint16Array(count * 2)
  for (let index = 0; index < values.length; index++)
    values[index] = view.getUint16(16 + index * 2, true)
  return { values, sampleHz }
}

export function cancelWaveform(requestId: string) {
  return event.emit(CustomEvents.CancelInProgressCompression, {
    ids: [requestId],
  })
}
