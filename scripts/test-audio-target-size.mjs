import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(
  new URL('../src/utils/audioTargetSize.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
})
const {
  planAudioTargetSize,
  supportsAudioTargetSize,
  getVorbisTargetSettings,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
const plan = (overrides = {}) =>
  planAudioTargetSize({
    targetSizeInMB: 5,
    durationInSeconds: 300,
    extension: 'm4a',
    ...overrides,
  })

test('budget leaves space for headers and uses decimal MB', () => {
  const result = plan()
  assert.equal(result.sizeInBytes, 5_000_000)
  assert.ok(result.bitrate > 120 && result.bitrate < 133)
  assert.equal(result.isTooSmall, false)
})

test('trimmed and speed-adjusted durations change the bitrate budget', () => {
  assert.ok(plan({ durationInSeconds: 150 }).bitrate > plan().bitrate)
  assert.ok(plan({ durationInSeconds: 600 }).bitrate < plan().bitrate)
})

test('rejects missing durations and invalid targets', () => {
  for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(plan({ durationInSeconds: duration }), null)
  }
  for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 10001]) {
    assert.equal(plan({ targetSizeInMB: size }), null)
  }
})

test('does not silently replace WAV or FLAC', () => {
  for (const extension of ['wav', 'flac']) {
    assert.equal(supportsAudioTargetSize(extension), false)
    assert.equal(plan({ extension }), null)
  }
  for (const extension of ['mp3', 'm4a', 'ogg', 'opus']) {
    assert.equal(supportsAudioTargetSize(extension), true)
  }
})

test('flags infeasible sizes and caps bitrate for large targets', () => {
  assert.equal(plan({ targetSizeInMB: 0.001 }).isTooSmall, true)
  assert.equal(plan({ extension: 'ogg', targetSizeInMB: 0.1 }).isTooSmall, true)
  assert.equal(plan({ targetSizeInMB: 1000 }).bitrate, 256)
  assert.equal(plan({ extension: 'mp3', targetSizeInMB: 1000 }).bitrate, 320)
})

test('respects explicitly selected codecs within the output format', () => {
  assert.equal(plan({ codec: 'alac' }), null)
  assert.equal(plan({ extension: 'ogg', codec: 'flac' }), null)
  assert.equal(plan({ extension: 'mp3', codec: 'aac' }), null)
  assert.ok(plan({ extension: 'ogg', codec: 'libopus', targetSizeInMB: 0.5 }))
  assert.equal(plan({ extension: 'ogg', codec: 'libopus' }).isTooSmall, false)
})

test('Vorbis budgets account for sample rate and mono output', () => {
  assert.deepEqual(getVorbisTargetSettings(192000, 1), {
    sampleRate: 48000,
    minimum: 32,
    maximum: 192,
  })
  assert.equal(
    plan({
      extension: 'ogg',
      targetSizeInMB: 2,
      durationInSeconds: 30,
      sampleRate: 192000,
      channels: 1,
    }).bitrate,
    192,
  )
  assert.deepEqual(getVorbisTargetSettings(8000, 2), {
    sampleRate: 8000,
    minimum: 16,
    maximum: 64,
  })
  assert.equal(getVorbisTargetSettings(48000, 2).maximum, 256)
  assert.equal(getVorbisTargetSettings(44100, 1).sampleRate, 44100)
})
