import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const directory = new URL('../src/i18n/locales/', import.meta.url)
const flatten = (value, prefix = '') =>
  Object.fromEntries(
    Object.entries(value).flatMap(([key, text]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return typeof text === 'object' && text !== null
        ? Object.entries(flatten(text, path))
        : [[path, text]]
    }),
  )
const readLocale = (name) =>
  flatten(JSON.parse(readFileSync(new URL(name, directory), 'utf8')))
const english = readLocale('en.json')
const pluralSuffix = /_(zero|one|two|few|many|other)$/
const placeholders = (text, plural) =>
  [...text.matchAll(/{{\s*([^}]+?)\s*}}/g)]
    .map((match) => match[1])
    // A plural translation may express a count implicitly (e.g. "this file").
    .filter((name) => !plural || name !== 'count')
    .sort()
const errors = []
const locales = readdirSync(directory).filter((name) => name.endsWith('.json'))

for (const name of locales) {
  const locale = name.slice(0, -5)
  const texts = readLocale(name)
  const categories = new Intl.PluralRules(locale).resolvedOptions()
    .pluralCategories
  const expected = new Map()
  for (const [key, value] of Object.entries(english)) {
    if (pluralSuffix.test(key)) {
      const base = key.replace(pluralSuffix, '')
      const source = english[`${base}_other`] ?? value
      for (const category of categories)
        expected.set(`${base}_${category}`, source)
    } else {
      expected.set(key, value)
    }
  }
  for (const [key, source] of expected) {
    const text = texts[key]
    if (typeof text !== 'string' || text.trim() === '') {
      errors.push(`${locale}: missing translation for ${key}`)
      continue
    }
    try {
      assert.deepEqual(
        placeholders(text, pluralSuffix.test(key)),
        placeholders(source, pluralSuffix.test(key)),
      )
    } catch {
      errors.push(`${locale}: interpolation placeholders differ for ${key}`)
    }
  }
}
if (errors.length) {
  process.stderr.write(`${errors.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `Translation coverage and placeholders verified for all ${locales.length} locales.\n`,
  )
}
