export const DEFAULT_FILE_NAME_TEMPLATE = 'compressO-{name}'

export const FILE_NAME_TOKENS = [
  '{name}',
  '{date}',
  '{time}',
  '{preset}',
] as const

export type FileNameToken = (typeof FILE_NAME_TOKENS)[number]

/** Removes characters that aren't allowed in file names */
export function sanitizeFileNamePart(value: string) {
  return value.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '')
}

/**
 * Converts a legacy prefix setting (e.g. `compressO-` or `""`) to a file name template
 * (`compressO-{name}` or `""` to keep the original name).
 */
export function migratePrefixToTemplate(prefix: string | null | undefined) {
  if (prefix == null) return DEFAULT_FILE_NAME_TEMPLATE
  if (prefix === '') return ''
  return `${prefix}{name}`
}

/**
 * Extracts a legacy prefix when `template` is strictly `<prefix>{name}`, so older readers that
 * only understand `filePrefix` stay compatible.
 */
export function getLegacyPrefixFromTemplate(template: string) {
  if (!template) return ''
  const match = /^([^{}]*)\{name\}$/i.exec(template)
  return match ? match[1] : ''
}

/** Splits a file name into its base stem and extension (without the leading dot) */
export function splitFileName(fileName: string) {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot > 0 && lastDot < fileName.length - 1) {
    return {
      stem: fileName.slice(0, lastDot),
      extension: fileName.slice(lastDot + 1),
    }
  }
  return { stem: fileName, extension: '' }
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

export function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function formatLocalTime(date: Date) {
  return `${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`
}

/**
 * Formats an output file name (preserving its extension) with a template such as
 * `compressO-{name}`, `{name}_compressed`, or `{name}_{date}`. Empty templates keep the original
 * file name.
 */
export function applyFileNameTemplate(
  fileName: string,
  template: string | null | undefined,
  {
    presetName = 'Standard',
    now = new Date(),
  }: {
    presetName?: string | null
    now?: Date
  } = {},
) {
  if (!fileName) return ''
  const { stem, extension } = splitFileName(fileName)
  const rawTemplate = template ?? ''
  const pattern = rawTemplate.trim().length > 0 ? rawTemplate : '{name}'
  const tokens: Record<string, string> = {
    name: stem,
    date: formatLocalDate(now),
    time: formatLocalTime(now),
    preset: sanitizeFileNamePart(presetName || 'Standard').trim() || 'Standard',
  }
  const rendered = pattern.replace(
    /\{(name|date|time|preset)\}/gi,
    (_, key: string) => tokens[key.toLowerCase()] ?? '',
  )
  // Trailing dots/spaces are invalid on Windows file names
  const cleanedStem = sanitizeFileNamePart(rendered)
    .replace(/[. ]+$/, '')
    .trim()
  const finalStem = cleanedStem || stem
  return extension ? `${finalStem}.${extension}` : finalStem
}
