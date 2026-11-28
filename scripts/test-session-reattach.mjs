import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const cloneDeep = (value) => structuredClone(value)

const sessionSource = readFileSync(
  new URL('../src/routes/(root)/-session.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(sessionSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
})

function loadSessionModule(activeSession = null) {
  const proxy = {
    state: {
      media: [],
      isCompressing: false,
    },
    snapshots: {
      beforeCompressionStarted: { media: [] },
      batchCompressionStep: { media: [] },
    },
    timeTravel(to) {
      proxy.state = cloneDeep(proxy.snapshots[to])
    },
  }
  const clearedCalls = []
  const dependencies = {
    '@tauri-apps/api': {
      core: {
        convertFileSrc: (raw) => `asset://${raw}`,
      },
      event: {
        async listen() {
          return () => {}
        },
      },
    },
    'lodash/cloneDeep': { __esModule: true, default: cloneDeep },
    valtio: {
      snapshot: (value) => value,
    },
    '@/tauri/commands/session': {
      MAIN_SESSION_COMPLETED_EVENT: 'main-session-completed',
      async clearActiveSession() {
        clearedCalls.push(true)
      },
      async getActiveSession() {
        return activeSession
      },
      async startMainSession() {},
      async updateMainSessionState() {},
    },
    '@/utils/fs': {
      formatBytes: (n) => `${n} B`,
      getOutputFileName: (name, _ext, outExt) => `${name}.${outExt ?? 'mp4'}`,
    },
    '@/utils/video': {
      isVideoPreviewAvailable: true,
    },
    './-compression': {
      getOutputDuration: () => 1000,
      getOutputOptions: () => ({}),
      getVideoClipOutputs: () => [],
    },
    './-presets': {
      buildContractForMedia: () => null,
    },
    './-state': {
      appProxy: proxy,
    },
  }
  const mod = { exports: {} }
  const wrapped = new vm.Script(
    `(function(require, module, exports){${outputText}})`,
  )
  wrapped.runInThisContext()(
    (id) => {
      if (!(id in dependencies)) {
        throw new Error(`Unexpected dependency: ${id}`)
      }
      return dependencies[id]
    },
    mod,
    mod.exports,
  )
  return { exports: mod.exports, proxy, clearedCalls }
}

test('buildSessionSnapshots populates pre-compression snapshot for reattached unsaved sessions', () => {
  const { exports } = loadSessionModule()
  const restored = {
    batchId: 'batch-1',
    isCompressing: false,
    isBatchPaused: false,
    isProcessCompleted: true,
    isBatchCompressionCancelled: false,
    isSaved: false,
    isSaving: false,
    isPreviewingClip: false,
    isWaitingForDropZone: false,
    totalProgress: 100,
    media: [
      {
        id: 'm1',
        type: 'video',
        fileName: 'sample.mp4',
        thumbnailPath: 'blob://transform-preview',
        thumbnailPathRaw: '/tmp/thumb.jpg',
        isCompressing: false,
        isProcessCompleted: true,
        compressionProgress: 100,
        targetSizeRound: 2,
        compressedFile: {
          isSuccessful: true,
          isSaved: false,
          pathRaw: '/tmp/out.mp4',
        },
        config: { quality: 35 },
      },
    ],
  }

  const { beforeCompressionStarted, batchCompressionStep } =
    exports.buildSessionSnapshots(restored)

  assert.equal(beforeCompressionStarted.batchId, undefined)
  assert.equal(beforeCompressionStarted.isProcessCompleted, false)
  assert.equal(beforeCompressionStarted.isCompressing, false)
  assert.equal(beforeCompressionStarted.totalProgress, 0)
  assert.equal(beforeCompressionStarted.media.length, 1)
  assert.equal(beforeCompressionStarted.media[0].isProcessCompleted, false)
  assert.equal(beforeCompressionStarted.media[0].compressionProgress, 0)
  assert.equal(beforeCompressionStarted.media[0].compressedFile, undefined)
  assert.equal(
    beforeCompressionStarted.media[0].thumbnailPath,
    'asset:///tmp/thumb.jpg',
  )
  assert.deepEqual(beforeCompressionStarted.media[0].config, { quality: 35 })

  assert.equal(batchCompressionStep.media[0].isProcessCompleted, true)
  assert.ok(batchCompressionStep.media[0].compressedFile)
})

test('useMainSessionReattach populates appProxy snapshots before hydrate so Reconfigure keeps media', async () => {
  const session = {
    batchId: 'batch-2',
    status: 'completed',
    isPaused: false,
    hasUnsavedOutput: true,
    progress: {},
    results: {},
    appState: {
      batchId: 'batch-2',
      isCompressing: false,
      isBatchPaused: false,
      isProcessCompleted: true,
      isSaved: false,
      totalProgress: 100,
      media: [
        {
          id: 'v1',
          type: 'video',
          fileName: 'clip.mp4',
          pathRaw: '/tmp/clip.mp4',
          thumbnailPathRaw: '/tmp/clip.jpg',
          isCompressing: false,
          isProcessCompleted: true,
          compressionProgress: 100,
          previewMode: 'image',
          compressedFile: {
            isSuccessful: true,
            isSaved: false,
            pathRaw: '/tmp/out.mp4',
          },
          config: { quality: 45 },
        },
      ],
    },
  }

  const { exports, proxy } = loadSessionModule(session)
  const cleanup = exports.useMainSessionReattach()
  await new Promise((resolve) => setTimeout(resolve, 10))
  cleanup()

  assert.equal(proxy.state.media.length, 1)
  assert.equal(proxy.state.isProcessCompleted, true)
  assert.equal(proxy.state.media[0].path, 'asset:///tmp/clip.mp4')
  assert.equal(proxy.state.media[0].compressedFile.path, 'asset:///tmp/out.mp4')
  assert.equal(proxy.state.media[0].previewMode, 'video')

  proxy.timeTravel('beforeCompressionStarted')
  assert.equal(proxy.state.media.length, 1)
  assert.equal(proxy.state.media[0].id, 'v1')
  assert.equal(proxy.state.media[0].path, 'asset:///tmp/clip.mp4')
  assert.equal(proxy.state.media[0].previewMode, 'video')
  assert.equal(proxy.state.isProcessCompleted, false)
  assert.equal(proxy.state.media[0].compressedFile, undefined)
})

test('resolveAssetUrl normalizes doubled Windows drive separators before convertFileSrc', async () => {
  const winSession = {
    batchId: 'batch-win',
    status: 'completed',
    isPaused: false,
    hasUnsavedOutput: true,
    progress: {},
    results: {},
    appState: {
      batchId: 'batch-win',
      isProcessCompleted: true,
      media: [
        {
          id: 'v-win',
          type: 'video',
          pathRaw: 'C:\\\\Users\\\\user\\\\Downloads\\\\sample.mp4',
          thumbnailPathRaw: 'C:\\Users\\user\\thumb.jpg',
          compressedFile: {
            isSuccessful: true,
            pathRaw: 'C:\\Users\\user\\out.mp4',
          },
        },
      ],
    },
  }
  const { exports, proxy } = loadSessionModule(winSession)
  const cleanup = exports.useMainSessionReattach()
  await new Promise((resolve) => setTimeout(resolve, 10))
  cleanup()

  assert.equal(
    proxy.state.media[0].path,
    'asset://C:\\Users\\user\\Downloads\\sample.mp4',
  )
})
