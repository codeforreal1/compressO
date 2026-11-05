import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as jsx from 'react/jsx-runtime'
import ts from 'typescript'

const { outputText } = ts.transpileModule(
  readFileSync(
    new URL('../src/utils/compressionQueue.ts', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  },
)
const exports = {}
new Function('exports', outputText)(exports)
const { drainCompressionQueue } = exports
const tick = () => new Promise((resolve) => setTimeout(resolve, 70))
const defaults = () => ({
  isLoading: () => false,
  isPaused: () => false,
  signal: new AbortController().signal,
})

test('appended items run after the active batch, once each even with missing results', async () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  const calls = []
  let active = 0
  await drainCompressionQueue({
    ...defaults(),
    getItems: () => items,
    async process(batch) {
      assert.equal(active++, 0)
      calls.push(batch.map((item) => item.id))
      if (calls.length === 1) items.push({ id: 'c' })
      await Promise.resolve()
      active--
    },
  })
  assert.deepEqual(calls, [['a', 'b'], ['c']])
})

test('in-flight metadata loading keeps an otherwise empty queue open', async () => {
  const items = []
  let loading = true
  const calls = []
  const run = drainCompressionQueue({
    ...defaults(),
    getItems: () => items,
    isLoading: () => loading,
    async process(batch) {
      calls.push(batch.map((item) => item.id))
    },
  })
  await tick()
  items.push({ id: 'a' })
  await tick()
  assert.deepEqual(calls, [])
  loading = false
  await run
  assert.deepEqual(calls, [['a']])
})

test('pause holds appended files until resume', async () => {
  const items = [{ id: 'a' }]
  let paused = false
  const calls = []
  const run = drainCompressionQueue({
    ...defaults(),
    getItems: () => items,
    isPaused: () => paused,
    async process(batch) {
      calls.push(batch.map((item) => item.id))
      if (calls.length === 1) {
        items.push({ id: 'b' })
        paused = true
      }
    },
  })
  await tick()
  assert.deepEqual(calls, [['a']])
  paused = false
  await run
  assert.deepEqual(calls, [['a'], ['b']])
})

for (const waitingOn of ['pause', 'loading']) {
  test(`cancel while waiting on ${waitingOn} never starts another item`, async () => {
    const controller = new AbortController()
    let called = false
    const run = drainCompressionQueue({
      getItems: () => [{ id: 'a' }],
      isLoading: () => waitingOn === 'loading',
      isPaused: () => waitingOn === 'pause',
      signal: controller.signal,
      async process() {
        called = true
      },
    })
    controller.abort()
    await assert.rejects(run, (error) => error === 'CANCELLED')
    assert.equal(called, false)
  })
}

test('Process drains appended media and preserves every result before saving', async () => {
  const media = (id) => ({
    id,
    type: 'video',
    fileName: `${id}.mp4`,
    config: {},
  })
  const state = {
    media: [media('a')],
    selectedMediaIndexForCustomization: -1,
    commonConfigForBatchCompression: { videoConfig: {}, imageConfig: {} },
  }
  const proxy = {
    state,
    clearSnapshots() {},
    takeSnapshot() {},
    timeTravel() {
      assert.fail('Queue should not restore an old selection')
    },
  }
  const calls = []
  let saves = 0
  let unlistens = 0
  const Button = () => null
  const noop = () => {}
  const dependencies = {
    react: { useEffect: noop, useCallback: (fn) => fn },
    'react/jsx-runtime': jsx,
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    'framer-motion': { motion: { button: 'button' } },
    valtio: {
      snapshot: (value) =>
        value === proxy
          ? { state: structuredClone(state) }
          : structuredClone(value),
      useSnapshot: (value) => value,
    },
    sonner: { toast: { error: (message) => assert.fail(message) } },
    '@tauri-apps/api': {
      core: { convertFileSrc: (path) => path },
      event: {
        listen: async () => () => {
          unlistens++
        },
      },
    },
    '@/components/Button': { default: Button },
    '@/components/ShortcutHint': { default: noop },
    '@/hooks/useCommandEnterShortcut': { useCommandEnterShortcut: noop },
    '@/hooks/useCommandKeyHeld': { useCommandKeyHeld: () => false },
    '@/hooks/useSyncState': { flushSyncStates: noop },
    '@/stores/settingsStore': { settingsStore: {} },
    '@/tauri/commands/dropQueue': { getDropQueue: async () => [] },
    '@/tauri/commands/sound': { playCompletionSound: async () => {} },
    '@/types/compression': {
      CustomEvents: { CancelInProgressCompression: 'cancel' },
      getBatchResolutionLongerSide: () => null,
    },
    '@/utils/fs': { formatBytes: String, getOutputFileName: (name) => name },
    '@/utils/compressionQueue': { drainCompressionQueue },
    '../-state': { appProxy: proxy },
    '../-history': { recordMainWindowHistory: noop },
    '../-save': {
      autoSaveCompressedMedia: async () => {
        saves++
        assert.equal(state.isProcessCompleted, true)
        assert.deepEqual(
          state.media.map((item) => item.compressedFile.isSuccessful),
          [true, false, true],
        )
      },
      autoCopyCompressedMediaToClipboard: async () => {},
    },
    '../-sizeEstimate': { needsQualityEstimate: () => false },
    '../-compression': {
      getTargetSizeWarning: () => null,
      getTargetSizePlan: () => null,
      getAudioTargetSizePlan: () => null,
      getOutputOptions: () => ({}),
      getMediaItemConfig: (item) => item,
    },
    '@/tauri/commands/media': {
      async compressMediaBatch(_batchId, items) {
        calls.push(items.map((item) => item.id))
        assert.equal(state.isCompressing, true)
        if (calls.length === 1) state.media.push(media('b'), media('c'))
        return {
          results: Object.fromEntries(
            items
              .filter((item) => item.id !== 'b')
              .map((item) => [
                item.id,
                { fileMetadata: { path: item.id, size: 100 } },
              ]),
          ),
        }
      },
    },
    './CancelCompression': { default: noop },
    './PauseCompression': { default: noop },
    './SaveMedia': { default: noop },
  }
  const { outputText } = ts.transpileModule(
    readFileSync(
      new URL('../src/routes/(root)/ui/StartCompression.tsx', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  )
  const component = {}
  new Function('require', 'exports', outputText)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
    return dependencies[name]
  }, component)
  const previousDocument = globalThis.document
  const previousHTMLElement = globalThis.HTMLElement
  globalThis.document = { activeElement: null }
  globalThis.HTMLElement = class {}
  try {
    await component.default().props.children.props.onPress()
    assert.deepEqual(calls, [['a'], ['b', 'c']])
    assert.equal(saves, 1)
    assert.ok(unlistens > 0)
  } finally {
    globalThis.document = previousDocument
    globalThis.HTMLElement = previousHTMLElement
  }
})

test('a playing input becomes a paused output, and ready does not start playback', async () => {
  const states = []
  let stateIndex = 0
  let effects = []
  const ref = { current: null }
  const noop = () => {}
  const ReactPlayer = () => null
  const dependencies = {
    react: {
      forwardRef: (render) => (props) => render(props, ref),
      memo: (value) => value,
      useState(initial) {
        const index = stateIndex++
        if (!(index in states)) states[index] = initial
        return [
          states[index],
          (value) => {
            states[index] =
              typeof value === 'function' ? value(states[index]) : value
          },
        ]
      },
      useRef: (current) => ({ current }),
      useId: () => 'preview',
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useImperativeHandle: (target, create) => {
        target.current = create()
      },
      useEffect: (effect, deps) => {
        effects.push({ effect, deps })
      },
    },
    'react/jsx-runtime': jsx,
    'react-player': { default: ReactPlayer },
    '@xzdarcy/react-timeline-editor': {},
    '@/hooks/usePlayPauseOnSpace': { usePlayPauseOnSpace: noop },
    '@/i18n': { t: (key) => key },
    '@/utils/tailwind': { cn: () => '' },
    '@/utils/video': { constructVideoUrl: async (url) => url },
    '@/utils/transform': { getTransformPreview: () => null },
    '../Button': { default: noop },
    '../Icon': { default: noop },
    '../Timeline': {},
    '../Timeline/useTimelineEngine': { default: () => ({}) },
  }
  const { outputText } = ts.transpileModule(
    readFileSync(
      new URL('../src/components/VideoPlayer/index.tsx', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  )
  const component = {}
  new Function('require', 'exports', outputText)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
    return dependencies[name]
  }, component)
  const render = (url) => {
    stateIndex = 0
    effects = []
    return component.default({ url })
  }
  render('input.mp4')
  ref.current.playVideo()
  render('input.mp4')
  assert.equal(ref.current.getPlaybackState(), 'playing')
  render('output.mp4')
  await effects
    .find(({ deps }) => deps?.length === 1 && deps[0] === 'output.mp4')
    .effect()
  const tree = render('output.mp4')
  assert.equal(ref.current.getPlaybackState(), 'paused')
  function findPlayer(node) {
    if (!node || typeof node !== 'object') return null
    if (node.type === ReactPlayer) return node
    for (const child of [node.props?.children].flat()) {
      const found = findPlayer(child)
      if (found) return found
    }
    return null
  }
  findPlayer(tree).props.onReady({ getInternalPlayer: () => null })
  render('output.mp4')
  assert.equal(ref.current.getPlaybackState(), 'paused')
})

for (const cancelled of [false, true]) {
  test(`clipboard loading ${cancelled ? 'discards a cancelled selection' : 'holds the queue open and appends files'}`, async () => {
    const proxy = { state: { media: [], isCompressing: true } }
    let handler
    let releaseClipboard
    const clipboard = new Promise((resolve) => {
      releaseClipboard = resolve
    })
    const dependencies = {
      react: { useEffect: (effect) => effect() },
      '@/tauri/commands/fs': { readFilesFromClipboard: () => clipboard },
      '@/utils/promise': { withTimeout: (promise) => promise },
      '../-state': { appProxy: proxy },
      '../-media': { canAddMedia: () => !proxy.state.isLoadingMediaFiles },
    }
    const { outputText } = ts.transpileModule(
      readFileSync(
        new URL(
          '../src/routes/(root)/ui/ReadFilesFromClipboard.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      },
    )
    const component = {}
    new Function('require', 'exports', outputText)(
      (name) => dependencies[name],
      component,
    )
    const previous = [
      globalThis.window,
      globalThis.HTMLInputElement,
      globalThis.HTMLTextAreaElement,
    ]
    globalThis.window = {
      addEventListener: (_name, callback) => {
        handler = callback
      },
    }
    globalThis.HTMLInputElement = class {}
    globalThis.HTMLTextAreaElement = class {}
    let additions = 0
    try {
      component.default({
        onFiles: async (files) => {
          assert.equal(proxy.state.isLoadingMediaFiles, false)
          additions++
          proxy.state.media.push(...files)
        },
      })
      const run = handler({ target: null })
      assert.equal(proxy.state.isLoadingMediaFiles, true)
      if (cancelled) proxy.state = { media: [], isCompressing: false }
      releaseClipboard([{ path: 'video.mp4' }])
      await run
      assert.equal(additions, cancelled ? 0 : 1)
      assert.ok(!proxy.state.isLoadingMediaFiles)
    } finally {
      ;[
        globalThis.window,
        globalThis.HTMLInputElement,
        globalThis.HTMLTextAreaElement,
      ] = previous
    }
  })
}
