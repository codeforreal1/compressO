import { core } from '@tauri-apps/api'

/** Turns hardware acceleration (the graphics card) on or off (Settings -> Output) */
export function setHardwareEncodingEnabled(enabled: boolean) {
  return core.invoke<void>('set_hardware_encoding_enabled', { enabled })
}

/**
 * The graphics card's video encoders that work on this computer (e.g. `h264_videotoolbox`), empty
 * without any. Found once when the app starts.
 */
export function getHardwareEncoders() {
  return core.invoke<string[]>('get_hardware_encoders')
}
