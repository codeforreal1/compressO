import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(
  new URL('../src/utils/fileNameTemplate.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
})

const mod = {}
new Function('exports', outputText)(mod)

const {
  DEFAULT_FILE_NAME_TEMPLATE,
  applyFileNameTemplate,
  getLegacyPrefixFromTemplate,
  migratePrefixToTemplate,
  splitFileName,
} = mod

const fixedDate = new Date(2026, 10, 26, 9, 5, 3)

test('default template keeps existing compressO- prefix behavior', () => {
  assert.equal(
    applyFileNameTemplate('vacation.mp4', DEFAULT_FILE_NAME_TEMPLATE, {
      now: fixedDate,
    }),
    'compressO-vacation.mp4',
  )
})

test('supports suffix, prefix + suffix, and empty original name', () => {
  assert.equal(
    applyFileNameTemplate('vacation.mp4', '{name}_compressed', {
      now: fixedDate,
    }),
    'vacation_compressed.mp4',
  )
  assert.equal(
    applyFileNameTemplate('vacation.mp4', 'web-{name}-small', {
      now: fixedDate,
    }),
    'web-vacation-small.mp4',
  )
  assert.equal(
    applyFileNameTemplate('vacation.mp4', '', { now: fixedDate }),
    'vacation.mp4',
  )
  assert.equal(
    applyFileNameTemplate('vacation.mp4', '{name}', { now: fixedDate }),
    'vacation.mp4',
  )
})

test('expands date, time, and preset tokens in a single pass', () => {
  assert.equal(
    applyFileNameTemplate('my.clip.mp4', '{name}_{date}_{time}_{preset}', {
      presetName: 'Web / 1080p',
      now: fixedDate,
    }),
    'my.clip_2026-11-26_09-05-03_Web  1080p.mp4',
  )
  // Tokens inside the original file name are never re-expanded
  assert.equal(
    applyFileNameTemplate('literal_{date}.png', '{name}_out', {
      now: fixedDate,
    }),
    'literal_{date}_out.png',
  )
})

test('sanitizes invalid characters and falls back to original stem if empty', () => {
  assert.equal(
    applyFileNameTemplate('clip.mov', '{name}:*?', { now: fixedDate }),
    'clip.mov',
  )
  assert.equal(
    applyFileNameTemplate('clip.mov', '{name}...', { now: fixedDate }),
    'clip.mov',
  )
  assert.equal(
    applyFileNameTemplate('clip.mov', '///...', { now: fixedDate }),
    'clip.mov',
  )
  assert.deepEqual(splitFileName('.hidden'), { stem: '.hidden', extension: '' })
  assert.deepEqual(splitFileName('a.b.mp4'), { stem: 'a.b', extension: 'mp4' })
})

test('migrates legacy prefixes and extracts legacy prefixes cleanly', () => {
  assert.equal(migratePrefixToTemplate(null), 'compressO-{name}')
  assert.equal(migratePrefixToTemplate(''), '')
  assert.equal(migratePrefixToTemplate('small-'), 'small-{name}')
  assert.equal(getLegacyPrefixFromTemplate('small-{name}'), 'small-')
  assert.equal(getLegacyPrefixFromTemplate('{name}_small'), '')
  assert.equal(getLegacyPrefixFromTemplate(''), '')
})
