export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * RFC 7386 JSON Merge Patch:
 * - Object patches recursively merge keys.
 * - `null` in patch clears/resets a field (kept as `null` when `preserveNull` is true, which is
 *   needed for contracts where `null` means "keep original / automatic").
 * - Arrays and primitives replace the target value.
 */
export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) {
    return patch
  }
  const result: Record<string, unknown> = isPlainObject(target)
    ? { ...target }
    : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value === null) {
      result[key] = null
    } else if (isPlainObject(value)) {
      result[key] = applyMergePatch(result[key], value)
    } else {
      result[key] = value
    }
  }
  return result
}
