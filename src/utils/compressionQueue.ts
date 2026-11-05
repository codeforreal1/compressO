/** Drain a growing selection without submitting an item twice, including failed items. */
export async function drainCompressionQueue<
  T extends { id?: string | null },
>(options: {
  getItems: () => readonly T[]
  isLoading: () => boolean
  isPaused: () => boolean
  signal: AbortSignal
  process: (items: T[]) => Promise<void>
}) {
  const submitted = new Set<string | null | undefined>()
  while (true) {
    if (options.signal.aborted) throw 'CANCELLED'
    const items = options.getItems().filter((item) => !submitted.has(item.id))
    if (!items.length && !options.isLoading()) return
    if (options.isLoading() || options.isPaused()) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      continue
    }
    items.forEach((item) => submitted.add(item.id))
    await options.process(items)
  }
}
