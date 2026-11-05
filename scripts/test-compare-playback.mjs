import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import merge from 'lodash/merge.js'
import * as jsx from 'react/jsx-runtime'
import ts from 'typescript'

function comparison() {
  const VideoPlayer = () => null
  const CompareSlider = () => null
  const noop = () => {}
  const dependencies = {
    '@tauri-apps/api': { core: { convertFileSrc: (path) => path } },
    'lodash/merge': { default: merge },
    react: {
      memo: (fn) => fn,
      useCallback: (fn) => fn,
      useId: () => 'compare',
      useRef: () => ({ current: null }),
    },
    'react/jsx-runtime': jsx,
    'react-compare-slider': { ReactCompareSliderHandle: noop },
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    'react-photo-view': { PhotoView: noop },
    valtio: { useSnapshot: (proxy) => proxy },
    '@/components/CompareSlider': { default: CompareSlider },
    '@/components/Icon': { default: noop },
    '@/components/ImageViewer': { default: noop },
    '@/components/Tooltip': { default: noop },
    '@/components/VideoPlayer': { default: VideoPlayer },
    '@/hooks/useImagePreview': { useImagePreview: () => null },
    '@/tauri/commands/image': { needsImagePreview: () => false },
    '@/utils/fs': { getPlatform: () => ({ isLinux: false }) },
    '@/utils/tailwind': { cn: () => '' },
    '../-state': {
      appProxy: {
        state: {
          media: [
            {
              type: 'video',
              path: 'input.mp4',
              compressedFile: { path: 'output.mp4', extension: 'mp4' },
            },
          ],
        },
      },
    },
  }
  const { outputText } = ts.transpileModule(
    readFileSync(
      new URL(
        '../src/routes/(root)/ui/MediaOutputCompareSlider.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  )
  const exports = {}
  new Function('require', 'exports', outputText)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
    return dependencies[name]
  }, exports)
  const tree = exports.default({ mediaIndex: 0 })
  function find(node) {
    if (!node || typeof node !== 'object') return null
    if (node.type === CompareSlider) return node
    for (const child of [node.props?.children].flat()) {
      const result = find(child)
      if (result) return result
    }
    return null
  }
  const slider = find(tree)
  return [
    slider.props.itemOne.props.children,
    slider.props.itemTwo.props.children,
  ].map((element) => {
    const controller = {
      playing: false,
      time: 0,
      seeks: 0,
      getPlaybackState: () => (controller.playing ? 'playing' : 'paused'),
      playVideo() {
        if (controller.playing) return
        controller.playing = true
        element.props.onPlay()
      },
      pauseVideo() {
        if (!controller.playing) return
        controller.playing = false
        element.props.onPause()
      },
      playerRef: {
        getCurrentTime: () => controller.time,
        seekTo(seconds) {
          assert.ok(
            ++controller.seeks < 10,
            'Seek events must not bounce indefinitely',
          )
          controller.time = seconds
          element.props.onSeek(seconds)
        },
      },
    }
    element.ref.current = controller
    return { element, controller }
  })
}

test('opening Compare and loading both players does not autoplay', () => {
  const players = comparison()
  for (const { element, controller } of players) {
    assert.ok(!element.props.autoPlay)
    element.props.onReady(controller.playerRef)
  }
  assert.deepEqual(
    players.map(({ controller }) => controller.playing),
    [false, false],
  )
})

for (const index of [0, 1]) {
  test(`play and pause from side ${index + 1} control both videos`, () => {
    const players = comparison()
    players[index].controller.playVideo()
    assert.deepEqual(
      players.map(({ controller }) => controller.playing),
      [true, true],
    )
    players[index].controller.pauseVideo()
    assert.deepEqual(
      players.map(({ controller }) => controller.playing),
      [false, false],
    )
  })
}

test('seeking either player aligns both without recursive seeks', () => {
  const players = comparison()
  players[0].controller.playerRef.seekTo(4)
  assert.deepEqual(
    players.map(({ controller }) => controller.time),
    [4, 4],
  )
  players[1].controller.playerRef.seekTo(1)
  assert.deepEqual(
    players.map(({ controller }) => controller.time),
    [1, 1],
  )
  assert.deepEqual(
    players.map(({ controller }) => controller.seeks),
    [2, 2],
  )
})

test('a late-loading player joins playback only after the user starts the other', () => {
  const [input, output] = comparison()
  output.element.ref.current = null
  input.controller.playVideo()
  input.controller.time = 2
  output.element.ref.current = output.controller
  output.element.props.onReady(output.controller.playerRef)
  assert.equal(output.controller.playing, true)
  assert.equal(output.controller.time, 2)
})
