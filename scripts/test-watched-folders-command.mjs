import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function transpile(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
}

function loadCommonJs(code, dependencies) {
  const exports = {}
  new Function('require', 'exports', code)((name) => {
    assert.ok(name in dependencies, `Unexpected import: ${name}`)
    return dependencies[name]
  }, exports)
  return exports
}

const presetConstants = {
  DEFAULT_PRESET_CHOICE: 'default',
  STANDARD_PRESET_ID: 'standard',
}

const utils = loadCommonJs(transpile('../src/utils/watchedFolders.ts'), {
  '@/types/preset': presetConstants,
  '@/utils/presetOutput': {
    getPresetChoice(id, mediaType, presets) {
      return id &&
        (id === 'standard' ||
          presets.some(
            (preset) => preset.id === id && preset.mediaType === mediaType,
          ))
        ? id
        : 'default'
    },
  },
})

const presets = [
  { id: 'web', name: 'Web', mediaType: 'image' },
  { id: 'small', name: 'Small videos', mediaType: 'video' },
]

const settingsStore = {
  watchedFolders: [],
}

let listener
const answers = []
let missingFolders = new Set()

const dependencies = {
  react: {
    useEffect(effect) {
      effect()
    },
  },
  '@tauri-apps/api': {
    event: {
      async listen(_name, callback) {
        listener = callback
        return () => {}
      },
    },
  },
  '@/stores/presetsStore': { presetsStore: { presets } },
  '@/stores/settingsStore': { settingsStore },
  '@/tauri/commands/app': { logError() {} },
  '@/tauri/commands/dropQueue': {
    async getMissingWatchedFolders(paths) {
      return paths.filter((path) => missingFolders.has(path))
    },
  },
  '@/tauri/commands/watchedFolders': {
    async completeWatchedFoldersCommand(requestId, result) {
      answers.push({ requestId, result })
    },
  },
  '@/types/compression': {
    CustomEvents: { WatchedFoldersCommand: 'WatchedFoldersCommand' },
  },
  '@/utils/watchedFolders': utils,
}

const hook = loadCommonJs(
  transpile('../src/hooks/useWatchedFoldersCommand.ts'),
  dependencies,
)
hook.useWatchedFoldersCommand()

await new Promise((resolve) => setImmediate(resolve))

async function runCommand(command, requestId = `${Math.random()}`) {
  answers.length = 0
  await listener({ payload: { requestId, command } })
  // The hook applies commands through a promise queue
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  return answers.at(-1)?.result
}

test('adds a folder with its presets, then updates and removes it', async () => {
  settingsStore.watchedFolders = []
  const added = await runCommand({
    type: 'addWatchedFolder',
    path: '/Users/me/Movies',
    presetIds: { image: 'web' },
  })
  assert.equal(added.ok, true)
  assert.equal(added.added, true)
  assert.equal(settingsStore.watchedFolders.length, 1)
  assert.equal(settingsStore.watchedFolders[0].path, '/Users/me/Movies')
  assert.equal(settingsStore.watchedFolders[0].isEnabled, true)
  assert.equal(settingsStore.watchedFolders[0].presetIds.image, 'web')
  assert.equal(added.watchedFolders[0].presetIds.video, 'default')

  // Adding the same folder again keeps the one already there
  const again = await runCommand({
    type: 'addWatchedFolder',
    path: '/Users/me/Movies/',
    presetIds: { video: 'small' },
  })
  assert.equal(again.ok, true)
  assert.equal(again.added, false)
  assert.equal(settingsStore.watchedFolders.length, 1)
  assert.equal(settingsStore.watchedFolders[0].presetIds.video, undefined)

  const updated = await runCommand({
    type: 'updateWatchedFolder',
    path: '/Users/me/Movies',
    isEnabled: false,
    presetIds: { video: 'small' },
  })
  assert.equal(updated.ok, true)
  assert.equal(updated.updated, true)
  assert.equal(settingsStore.watchedFolders[0].isEnabled, false)
  assert.equal(settingsStore.watchedFolders[0].presetIds.video, 'small')

  const removed = await runCommand({
    type: 'removeWatchedFolder',
    path: '/Users/me/Movies/',
  })
  assert.equal(removed.ok, true)
  assert.equal(removed.removed, true)
  assert.equal(settingsStore.watchedFolders.length, 0)
})

test('answers a repeated request without applying it twice', async () => {
  settingsStore.watchedFolders = []
  const request = {
    type: 'addWatchedFolder',
    path: '/Users/me/Pictures',
  }
  const first = await runCommand(request, 'request-1')
  assert.equal(first.added, true)
  const second = await runCommand(request, 'request-1')
  assert.equal(second.added, true)
  assert.equal(settingsStore.watchedFolders.length, 1)
  assert.equal(answers.length, 1)
})

test('rejects unknown presets, missing folders and folders from another media type', async () => {
  settingsStore.watchedFolders = []
  const unknown = await runCommand({
    type: 'addWatchedFolder',
    path: '/Users/me/Music',
    presetIds: { video: 'Web' },
  })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'unknownPreset')
  assert.equal(settingsStore.watchedFolders.length, 0)

  missingFolders = new Set(['/Users/me/Missing'])
  const missing = await runCommand({
    type: 'addWatchedFolder',
    path: '/Users/me/Missing',
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'missingFolder')

  missingFolders = new Set()
  const noWatchedFolder = await runCommand({
    type: 'updateWatchedFolder',
    id: 'not-there',
    isEnabled: true,
  })
  assert.equal(noWatchedFolder.ok, false)
  assert.equal(noWatchedFolder.code, 'unknownWatchedFolder')
})
