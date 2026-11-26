import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import prettyBytes from 'pretty-bytes'
import ts from 'typescript'

const source = readFileSync(
  new URL('../src/utils/fs.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
})

function loadFormatBytes(userAgent) {
  globalThis.window = { navigator: { userAgent } }
  const exports = {}
  new Function('exports', 'require', outputText)(exports, (name) => {
    if (name === 'pretty-bytes') return { default: prettyBytes }
    throw new Error(`Unexpected import: ${name}`)
  })
  return exports.formatBytes
}

test('formats Windows file sizes to match Windows Explorer', () => {
  const formatBytes = loadFormatBytes(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  )
  assert.equal(formatBytes(0), '0')
  assert.equal(formatBytes(500), '500 B')
  assert.equal(formatBytes(1024), '1 KB')
  assert.equal(formatBytes(1500), '1.46 KB')
  assert.equal(formatBytes(512000), '500 KB')
  assert.equal(formatBytes(486302795), '463 MB')
  assert.equal(formatBytes(1055668335), '0.98 GB')
})

test('keeps 1000-based decimal formatting on macOS and Linux', () => {
  for (const ua of [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    'Mozilla/5.0 (X11; Linux x86_64)',
  ]) {
    const formatBytes = loadFormatBytes(ua)
    assert.equal(formatBytes(512000), '512 kB')
    assert.equal(formatBytes(486302795), '486 MB')
    assert.equal(formatBytes(1055668335), '1.06 GB')
  }
})
