import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const { outputText } = ts.transpileModule(
  readFileSync(
    new URL('../src/utils/imageDynamicRange.ts', import.meta.url),
    'utf8',
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
)
const exports = {}
new Function('exports', outputText)(exports)
const {
  getImageDynamicRangeOperation: rawOperation,
  supportsHdrBoostOutput: supports,
} = exports
const info = (dynamicRange, supported = true) => ({
  dynamicRange,
  supported,
  hasGainMap: false,
})
const operation = (config, source, output = 'png') =>
  rawOperation(config, source, output)
const boost = { mode: 'boost', intensity: 2 }
const sdr = { mode: 'sdr', intensity: 1 }

test('presets apply only the operation matching the original source', () => {
  assert.deepEqual(operation(boost, info('sdr')), boost)
  assert.deepEqual(operation(sdr, info('hdr')), sdr)
  assert.equal(operation(boost, info('hdr')), null)
  assert.equal(operation(sdr, info('sdr')), null)
  for (const settings of [
    boost,
    sdr,
    { mode: 'original', intensity: 2 },
    undefined,
  ]) {
    assert.equal(operation(settings, info('unknown')), null)
    assert.equal(operation(settings, info('sdr', false)), null)
    assert.equal(operation(settings, undefined), null)
  }
  assert.equal(operation(undefined, info('sdr')), null) // Old presets.
})

test('unsupported formats disable boost without affecting SDR conversion', () => {
  for (const extension of [
    'jpg',
    'jpeg',
    'avif',
    'webp',
    'heic',
    'heif',
    'png',
    'jxl',
  ]) {
    const supported = ['png', 'jxl'].includes(extension)
    assert.equal(supports(extension), supported)
    assert.deepEqual(
      operation(boost, info('sdr'), extension),
      supported ? boost : null,
    )
    assert.deepEqual(operation(sdr, info('hdr'), extension), sdr)
  }
  // A stored boost preference stays inactive until a supported output is selected again.
  assert.equal(operation(boost, info('sdr'), 'jpg'), null)
  assert.deepEqual(operation(boost, info('sdr'), 'jxl'), boost)
})

test('HDR PNG avoids eight-bit quantization while SDR and JXL retain quality control', () => {
  assert.equal(exports.isHdrPngOutput('jpg', null, info('sdr')), false)
  assert.equal(exports.isHdrPngOutput('png', null, info('hdr')), true)
  assert.equal(exports.isHdrPngOutput('png', sdr, info('hdr')), false)
  assert.equal(exports.isHdrPngOutput('jxl', boost, info('sdr')), false)
  assert.equal(exports.isHdrPngOutput('png', null, info('sdr')), false)
})

test('stored intensity values remain finite and inside the supported range', () => {
  for (const [intensity, expected] of [
    [0, 1],
    [8, 4],
    [NaN, 2],
    [Infinity, 2],
    [1, 1],
    [2.5, 2.5],
  ]) {
    assert.equal(
      operation({ mode: 'boost', intensity }, info('sdr')).intensity,
      expected,
    )
  }
})
