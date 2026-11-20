import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(
  new URL('../src/utils/watchedFolders.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
})

const presets = [
  {
    id: 'web',
    name: 'Web',
    mediaType: 'image',
    settings: {},
  },
  {
    id: 'small',
    name: 'Small videos',
    mediaType: 'video',
    settings: {},
  },
]

const dependencies = {
  '@/types/preset': {
    DEFAULT_PRESET_CHOICE: 'default',
    STANDARD_PRESET_ID: 'standard',
  },
  '@/utils/presetOutput': {
    getPresetChoice(id, mediaType, availablePresets) {
      return id &&
        (id === 'standard' ||
          availablePresets.some(
            (preset) => preset.id === id && preset.mediaType === mediaType,
          ))
        ? id
        : 'default'
    },
  },
}

const exports = {}
new Function('require', 'exports', outputText)((name) => {
  assert.ok(name in dependencies, `Unexpected import: ${name}`)
  return dependencies[name]
}, exports)

const {
  findWatchedFolder,
  generateWatchedFolderId,
  getWatchedFolderChoices,
  getWatchedFolderPresetNames,
  isWatchedFolderRoot,
  normalizeWatchedFolderPath,
  resolveWatchedFolderPresetId,
} = exports

test('normalizes folder paths for comparing them', () => {
  assert.equal(
    normalizeWatchedFolderPath('/Users/me/Movies/'),
    '/Users/me/Movies',
  )
  assert.equal(
    normalizeWatchedFolderPath('C:\\Users\\me\\Movies\\'),
    'C:\\Users\\me\\Movies',
  )
  assert.equal(normalizeWatchedFolderPath('/'), '/')
})

test('rejects filesystem roots', () => {
  assert.equal(isWatchedFolderRoot('/'), true)
  assert.equal(isWatchedFolderRoot('C:\\'), true)
  assert.equal(isWatchedFolderRoot('C:'), true)
  assert.equal(isWatchedFolderRoot('/Users/me'), false)
  assert.equal(isWatchedFolderRoot('C:\\Users'), false)
})

test('finds a folder by id or by its path with or without a trailing separator', () => {
  const folders = [
    { id: 'one', path: '/Users/me/Movies', isEnabled: true },
    { id: 'two', path: '/Users/me/Pictures', isEnabled: false },
  ]
  assert.equal(findWatchedFolder(folders, { id: 'two' })?.id, 'two')
  assert.equal(
    findWatchedFolder(folders, { path: '/Users/me/Movies/' })?.id,
    'one',
  )
  assert.equal(
    findWatchedFolder(folders, { path: '/Users/me/Other' }),
    undefined,
  )
})

test('normalizes the presets of a folder for the command line', () => {
  const choices = getWatchedFolderChoices(
    [
      {
        id: 'one',
        path: '/Users/me/Movies',
        isEnabled: true,
        presetIds: { image: 'web', video: 'deleted' },
      },
      { id: 'two', path: '/Users/me/Pictures', isEnabled: false },
    ],
    presets,
  )
  assert.deepEqual(choices[0], {
    id: 'one',
    path: '/Users/me/Movies',
    isEnabled: true,
    presetIds: { video: 'default', image: 'web', audio: 'default' },
  })
  assert.deepEqual(choices[1].presetIds, {
    video: 'default',
    image: 'default',
    audio: 'default',
  })
})

test('resolves preset choices by id, name, Standard and default', () => {
  assert.equal(resolveWatchedFolderPresetId('web', 'image', presets), 'web')
  assert.equal(resolveWatchedFolderPresetId('Web', 'image', presets), 'web')
  assert.equal(
    resolveWatchedFolderPresetId('small VIDEOS', 'video', presets),
    'small',
  )
  assert.equal(
    resolveWatchedFolderPresetId('Standard', 'video', presets),
    'standard',
  )
  assert.equal(resolveWatchedFolderPresetId('', 'image', presets), 'default')
  assert.equal(
    resolveWatchedFolderPresetId('default', 'audio', presets),
    'default',
  )
  // A preset of another media type is not accepted
  assert.equal(resolveWatchedFolderPresetId('Web', 'video', presets), null)
  assert.equal(resolveWatchedFolderPresetId('Nope', 'image', presets), null)
})

test('lists the presets of a media type for errors', () => {
  assert.deepEqual(getWatchedFolderPresetNames('image', presets), [
    'Standard',
    'Web',
  ])
  assert.deepEqual(getWatchedFolderPresetNames('audio', presets), ['Standard'])
})

test('makes a new id for every folder', () => {
  assert.notEqual(generateWatchedFolderId(), generateWatchedFolderId())
})
