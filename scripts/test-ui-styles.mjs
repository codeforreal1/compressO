import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import loadConfig from 'tailwindcss/loadConfig.js'

test('the app stylesheet includes HeroUI hidden-input and label styles', async () => {
  const config = loadConfig(
    fileURLToPath(new URL('../tailwind.config.ts', import.meta.url)),
  )
  const result = await postcss([tailwindcss(config)]).process(
    '@tailwind utilities;',
    { from: undefined },
  )
  let hiddenInput = false
  let outsideLabel = false
  result.root.walkRules((rule) => {
    if (rule.selector.includes('.opacity-\\[0\\.0001\\]')) {
      rule.walkDecls('opacity', (decl) => {
        hiddenInput ||= Number(decl.value) === 0.0001
      })
    }
    outsideLabel ||= rule.selector.includes('has-label-outside')
  })
  assert.ok(
    hiddenInput,
    'Native switch inputs must be visually hidden by the HeroUI styles',
  )
  assert.ok(outsideLabel, 'Select labels must include HeroUI placement styles')
})
