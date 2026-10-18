/** Thrown by `withTimeout` when the promise takes too long */
export class TimeoutError extends Error {
  constructor() {
    super('The operation took too long.')
    this.name = 'TimeoutError'
  }
}

/**
 * The promise, or a `TimeoutError` after `ms` milliseconds: so nothing that waits on it (e.g. a
 * loading screen) can wait forever. The promise itself keeps running; its result is ignored.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
