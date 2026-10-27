import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(
  new URL('../src/hooks/useDropQueue.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
})

// Run the hooks with backend events and React's effect lifecycle under our control.
function mountQueueHook(hookName, hasTray, { delayListener = false } = {}) {
  const listeners = new Map()
  const reads = []
  const initialItems = [{ id: 'existing', status: 'waiting' }]
  const pendingListeners = []
  let state
  let cleanup
  const dependencies = {
    react: {
      useState(initial) {
        state = initial
        return [
          state,
          (value) => {
            state = value
          },
        ]
      },
      useEffect(effect) {
        cleanup = effect()
      },
    },
    '@tauri-apps/api': {
      event: {
        async listen(name, callback) {
          if (delayListener) {
            await new Promise((resolve) => pendingListeners.push(resolve))
          }
          listeners.set(name, callback)
          return () => listeners.delete(name)
        },
      },
    },
    '@/utils/tray': { hasTray },
    '@/tauri/commands/dropQueue': {
      DROP_QUEUE_EVENT: 'queue',
      DROP_QUEUE_PAUSED_EVENT: 'paused',
      async getDropQueue() {
        reads.push('queue')
        return initialItems
      },
      async isDropQueuePaused() {
        reads.push('paused')
        return true
      },
    },
  }
  const exports = {}
  new Function('require', 'exports', outputText)((name) => {
    assert.ok(name in dependencies, `Unexpected import: ${name}`)
    return dependencies[name]
  }, exports)
  exports[hookName]()
  return {
    listeners,
    reads,
    initialItems,
    get state() {
      return state
    },
    unmount() {
      cleanup?.()
    },
    finishListening() {
      pendingListeners.forEach((resolve) => resolve())
    },
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

for (const hasTray of [false, true]) {
  const platform = hasTray ? 'macOS/Windows' : 'Linux without a tray'
  for (const [hook, event] of [
    ['useDropQueue', 'queue'],
    ['useDropQueuePaused', 'paused'],
  ]) {
    test(`${platform}: ${hook} loads state and receives updates`, async () => {
      const mounted = mountQueueHook(hook, hasTray)
      await flush()
      assert.deepEqual(mounted.reads, [event])
      assert.deepEqual(
        mounted.state,
        event === 'queue' ? mounted.initialItems : true,
      )
      const updated =
        event === 'queue'
          ? [{ id: 'new-watched-file', status: 'waiting' }]
          : false
      mounted.listeners.get(event)({ payload: updated })
      assert.deepEqual(mounted.state, updated)
      mounted.unmount()
      assert.equal(mounted.listeners.size, 0)
    })

    test(`${platform}: ${hook} cleans up a pending subscription`, async () => {
      const mounted = mountQueueHook(hook, hasTray, { delayListener: true })
      mounted.unmount()
      mounted.finishListening()
      await flush()
      assert.equal(mounted.listeners.size, 0)
      assert.deepEqual(mounted.reads, [])
    })
  }
}
