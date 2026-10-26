// Preserve the existing source offers byte-for-byte, then publish one release download.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const targets = [
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
]
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const checksum = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const writeJson = (file, value) =>
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)

function requiredSources(repository, target) {
  assert.ok(targets.includes(target), `Unknown source target: ${target}`)
  const image = readJson(
    path.join(repository, 'LICENSES/image-codecs/SOURCES.json'),
  )
  const result = image.targets[target].sources.map((source) => ({
    source: source.file,
    sha256: source.sha256,
    archive: `image-codecs/${path.basename(source.file)}`,
  }))
  if (target.includes('windows')) {
    const helper = readJson(
      path.join(repository, 'LICENSES/lrzip-windows/SOURCE.json'),
    )
    result.push({
      source: helper.sourceArchive,
      sha256: helper.sourceSha256,
      archive: `toolchains/${path.basename(helper.sourceArchive)}`,
    })
  } else {
    result.push({
      source: `src-tauri/.toolchain-cache/toolchain-sources-${target}.tar.gz`,
      archive: `toolchains/toolchain-sources-${target}.tar.gz`,
    })
  }
  if (target === 'x86_64-apple-darwin') {
    const jpeg = readJson(
      path.join(repository, 'LICENSES/jpegoptim/INTEL-MACOS-BUILD.json'),
    )
    result.push({
      source: jpeg.sourceArchive,
      sha256: jpeg.sourceSha256,
      archive: `jpegoptim/${path.basename(jpeg.sourceArchive)}`,
    })
  }
  return result
}

export function collectSources(repository, target, output) {
  const directory = path.join(output, target)
  assert.ok(
    !fs.existsSync(directory),
    `Source stage already exists: ${directory}`,
  )
  const files = requiredSources(repository, target).map((entry) => {
    const source = path.join(repository, entry.source)
    const sha256 = checksum(source) // Missing required files must fail the build.
    if (entry.sha256) assert.equal(sha256, entry.sha256, entry.source)
    const destination = path.join(directory, entry.archive)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
    return { ...entry, sha256, size: fs.statSync(source).size }
  })
  writeJson(path.join(directory, 'manifest.json'), { schema: 1, target, files })
}

function listFiles(directory, prefix = '') {
  return fs
    .readdirSync(path.join(directory, prefix))
    .sort()
    .flatMap((name) => {
      const relative = prefix ? `${prefix}/${name}` : name
      const stat = fs.lstatSync(path.join(directory, relative))
      assert.ok(!stat.isSymbolicLink(), `Unexpected symlink: ${relative}`)
      return stat.isDirectory() ? listFiles(directory, relative) : [relative]
    })
}

export function packageSources(repository, input, output, version, revision) {
  assert.match(version, /^\d+\.\d+\.\d+[\w.+-]*$/)
  assert.match(revision, /^[a-f\d]{40,64}$/)
  assert.deepEqual(fs.readdirSync(input).sort(), [...targets].sort())
  fs.mkdirSync(output, { recursive: true })
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'compresso-sources-'))
  const stage = path.join(temporary, 'sources')
  fs.mkdirSync(stage)
  try {
    const archives = new Map()
    for (const target of targets) {
      const directory = path.join(input, target)
      const manifest = readJson(path.join(directory, 'manifest.json'))
      assert.equal(manifest.schema, 1)
      assert.equal(manifest.target, target)
      const expected = requiredSources(repository, target)
      assert.deepEqual(
        manifest.files.map((file) => file.archive).sort(),
        expected.map((file) => file.archive).sort(),
      )
      assert.deepEqual(
        listFiles(directory).sort(),
        ['manifest.json', ...expected.map((file) => file.archive)].sort(),
      )
      for (const entry of expected) {
        const file = manifest.files.find(
          (file) => file.archive === entry.archive,
        )
        assert.equal(file.source, entry.source)
        const source = path.join(directory, entry.archive)
        assert.equal(fs.statSync(source).size, file.size)
        assert.equal(checksum(source), file.sha256)
        if (entry.sha256) assert.equal(file.sha256, entry.sha256)
        const previous = archives.get(entry.archive)
        if (previous) {
          assert.equal(previous.sha256, file.sha256)
          previous.targets.push(target)
        } else {
          const destination = path.join(stage, entry.archive)
          fs.mkdirSync(path.dirname(destination), { recursive: true })
          fs.copyFileSync(source, destination)
          archives.set(entry.archive, {
            path: entry.archive,
            size: file.size,
            sha256: file.sha256,
            targets: [target],
          })
        }
      }
    }
    // Keep notices and build instructions beside the original, unmodified source archives.
    for (const name of [
      'LICENSE',
      'LICENSES',
      'docs/image-codecs.md',
      'docs/tool-bundles.md',
      'docs/dependency-sources.md',
      'scripts/build-image-tools.mjs',
      'scripts/build-lrzip.mjs',
    ]) {
      const destination = path.join(stage, name)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.cpSync(path.join(repository, name), destination, { recursive: true })
    }
    fs.writeFileSync(
      path.join(stage, 'README.md'),
      `# CompressO ${version} dependency sources\n\nRepository revision: ${revision}\n\nThis download collects the dependency source archives previously published separately.\nThe nested archives are preserved byte-for-byte; manifest.json records their SHA-256\nchecksums, sizes, and release targets. These files are not needed to install or update CompressO.\n\n- image-codecs/: platform image codec sources, patches, and build recipes.\n- toolchains/: LRZIP helper sources and compression dependencies.\n- jpegoptim/: matching jpegoptim sources for the Intel macOS build.\n- LICENSES/: dependency notices, provenance, and additional build instructions.\n- docs/ and scripts/: repository build guidance and pinned helper build scripts.\n\nStart with docs/image-codecs.md, docs/tool-bundles.md, and the README/build files\ninside each nested archive. Use a checkout of the repository revision above when\nfollowing repository-relative build commands. Intel JPEG instructions are in\nLICENSES/jpegoptim/INTEL-MACOS-BUILD.md. Each dependency retains its own license.\n`,
    )
    const files = listFiles(stage).map((name) => ({
      path: name,
      size: fs.statSync(path.join(stage, name)).size,
      sha256: checksum(path.join(stage, name)),
    }))
    writeJson(path.join(stage, 'manifest.json'), {
      schema: 1,
      version,
      revision,
      targets,
      archives: [...archives.values()],
      files,
    })
    const archive = path.resolve(
      output,
      `CompressO_${version}_dependency-sources.tar.gz`,
    )
    execFileSync('tar', ['-czf', archive, '-C', stage, '.'])
    const verify = path.join(temporary, 'verify')
    fs.mkdirSync(verify)
    execFileSync('tar', ['-xzf', archive, '-C', verify])
    assert.deepEqual(listFiles(verify), listFiles(stage))
    for (const name of listFiles(stage)) {
      assert.equal(
        checksum(path.join(verify, name)),
        checksum(path.join(stage, name)),
        name,
      )
    }
    return archive
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'collect' && args.length === 2) {
    collectSources(root, args[0], path.resolve(args[1]))
  } else if (mode === 'pack' && args.length === 4) {
    process.stdout.write(
      `${packageSources(root, path.resolve(args[0]), path.resolve(args[1]), args[2], args[3])}\n`,
    )
  } else {
    throw new Error(
      'Use collect <target> <output> or pack <input> <output> <version> <revision>.',
    )
  }
}
