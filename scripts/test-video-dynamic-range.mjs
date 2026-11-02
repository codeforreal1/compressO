import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const load = (path, modules = {}) => {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  )
  const exports = {}
  new Function('exports', 'require', outputText)(
    exports,
    (name) => modules[name],
  )
  return exports
}
// Only `getOutputVideoContainer` is used; the rest of the module's imports are not needed
const video = load('../src/utils/video.ts', {
  '@tauri-apps/api/core': {},
  '@/constants': {},
  '@/types/compression': {},
  './fs': { getPlatform: () => ({}) },
  './transform': {},
})
const { getVideoHdrOutput } = load('../src/utils/videoDynamicRange.ts', {
  '@/utils/video': video,
})

const config = (overrides = {}) => ({
  convertToExtension: '-',
  shouldDisableCompression: false,
  ...overrides,
})

test('HDR-capable formats and codecs', () => {
  for (const extension of ['mp4', 'mov', 'mkv', 'webm', 'ts', 'm4v', 'mts']) {
    assert.equal(
      getVideoHdrOutput(config({ convertToExtension: extension }), 'mov')
        .canHoldHdr,
      true,
      extension,
    )
  }
  for (const extension of ['avi', 'gif']) {
    assert.equal(
      getVideoHdrOutput(config({ convertToExtension: extension }), 'mov')
        .canHoldHdr,
      false,
      extension,
    )
  }
  // "Same as input" uses each source's own format
  assert.equal(getVideoHdrOutput(config(), 'avi').canHoldHdr, false)
  assert.equal(getVideoHdrOutput(config(), 'mp4').canHoldHdr, true)
})

test('a chosen codec decides, the automatic one is HEVC for HDR', () => {
  const codec = (customVideoCodec, shouldEnableCustomVideoCodec = true) =>
    getVideoHdrOutput(
      config({
        convertToExtension: 'mp4',
        shouldEnableCustomVideoCodec,
        customVideoCodec,
      }),
      'mov',
    ).canHoldHdr
  assert.equal(codec('libx264'), false)
  assert.equal(codec('mpeg4'), false)
  assert.equal(codec('libx265'), true)
  assert.equal(codec('libaom-av1'), true)
  assert.equal(codec('libvpx-vp9'), true)
  assert.equal(codec('-'), true)
  // A codec chosen while the switch is off does not apply
  assert.equal(codec('libx264', false), true)
})

test('lossless compression, unless compressing to a size', () => {
  assert.equal(
    getVideoHdrOutput(config({ shouldDisableCompression: true }), 'mp4')
      .isLossless,
    true,
  )
  assert.equal(
    getVideoHdrOutput(
      config({ shouldDisableCompression: true, shouldUseTargetSize: true }),
      'mp4',
    ).isLossless,
    false,
  )
})
