import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import {
  collectSources,
  packageSources,
  targets,
} from './package-dependency-sources.mjs'

const revision = 'a'.repeat(40)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compresso-source-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (name, bytes) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), bytes)
  }
  const json = (name, value) => write(name, JSON.stringify(value))
  const archive = (name) => {
    const bytes = gzipSync(name)
    write(name, bytes)
    return digest(bytes)
  }
  const images = {}
  for (const target of targets) {
    const name = `src-tauri/tool-sources/image-codecs-${target}.tar.gz`
    images[target] = {
      sources: target.includes('windows')
        ? []
        : [{ file: name, sha256: archive(name) }],
    }
    if (!target.includes('windows'))
      archive(`src-tauri/.toolchain-cache/toolchain-sources-${target}.tar.gz`)
  }
  json('LICENSES/image-codecs/SOURCES.json', { targets: images })
  for (const [metadata, name] of [
    ['LICENSES/lrzip-windows/SOURCE.json', 'lrzip-windows-v0.651-1.tar.gz'],
    ['LICENSES/jpegoptim/INTEL-MACOS-BUILD.json', 'jpegoptim-v1.5.6.tar.gz'],
  ]) {
    const sourceArchive = `src-tauri/tool-sources/${name}`
    json(metadata, { sourceArchive, sourceSha256: archive(sourceArchive) })
  }
  for (const name of [
    'LICENSE',
    'docs/image-codecs.md',
    'docs/tool-bundles.md',
    'docs/dependency-sources.md',
    'scripts/build-image-tools.mjs',
    'scripts/build-lrzip.mjs',
  ])
    write(name, `Build reference: ${name}`)
  const collected = path.join(root, 'collected')
  const collect = () => {
    for (const target of targets) collectSources(root, target, collected)
  }
  const pack = () =>
    packageSources(
      root,
      collected,
      path.join(root, 'output'),
      '4.0.0',
      revision,
    )
  return { root, collected, collect, pack }
}

test('combines all eight original archives unchanged, with a complete manifest and build guidance', (t) => {
  const f = fixture(t)
  f.collect()
  const archive = f.pack()
  const read = (name) => execFileSync('tar', ['-xzOf', archive, `./${name}`])
  const manifest = JSON.parse(read('manifest.json').toString())
  assert.equal(
    path.basename(archive),
    'CompressO_4.0.0_dependency-sources.tar.gz',
  )
  assert.deepEqual(manifest.targets, targets)
  assert.equal(manifest.revision, revision)
  assert.equal(manifest.archives.length, 8)
  for (const entry of manifest.files) {
    const bytes = read(entry.path)
    assert.equal(bytes.length, entry.size)
    assert.equal(digest(bytes), entry.sha256)
  }
  assert.match(read('README.md').toString(), /preserved byte-for-byte/)
  assert.ok(
    manifest.files.some(
      (entry) => entry.path === 'LICENSES/image-codecs/SOURCES.json',
    ),
  )
})

test('rejects a missing platform and a missing required archive', (t) => {
  const f = fixture(t)
  f.collect()
  const linux = path.join(f.collected, targets[3])
  fs.renameSync(linux, `${linux}-missing`)
  assert.throws(f.pack)
  fs.renameSync(`${linux}-missing`, linux)
  fs.rmSync(
    path.join(linux, `toolchains/toolchain-sources-${targets[3]}.tar.gz`),
  )
  assert.throws(f.pack)
})

test('rejects corrupt source bytes and omitted manifest entries', (t) => {
  const f = fixture(t)
  f.collect()
  const directory = path.join(f.collected, targets[2])
  const archive = path.join(
    directory,
    'toolchains/lrzip-windows-v0.651-1.tar.gz',
  )
  const original = fs.readFileSync(archive)
  const changed = Buffer.from(original)
  changed[changed.length - 1] ^= 1
  fs.writeFileSync(archive, changed)
  assert.throws(f.pack)
  fs.writeFileSync(archive, original)
  fs.writeFileSync(
    path.join(directory, 'manifest.json'),
    JSON.stringify({ schema: 1, target: targets[2], files: [] }),
  )
  assert.throws(f.pack)
})

test('rejects unexpected updater archives in the source artifacts', (t) => {
  const f = fixture(t)
  f.collect()
  fs.writeFileSync(
    path.join(f.collected, targets[0], 'CompressO.app.tar.gz'),
    'not a source offer',
  )
  assert.throws(f.pack)
})

test('collection requires generated toolchain sources and validates pinned source checksums', (t) => {
  const f = fixture(t)
  fs.rmSync(
    path.join(
      f.root,
      `src-tauri/.toolchain-cache/toolchain-sources-${targets[0]}.tar.gz`,
    ),
  )
  assert.throws(() => collectSources(f.root, targets[0], f.collected))
  fs.appendFileSync(
    path.join(f.root, 'src-tauri/tool-sources/lrzip-windows-v0.651-1.tar.gz'),
    'changed',
  )
  assert.throws(() => collectSources(f.root, targets[2], f.collected))
})
