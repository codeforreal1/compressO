// Builds only this release target's tools. No tools are downloaded at runtime.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildLrzip } from './build-lrzip.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const run = (program, args, options = {}) =>
  execFileSync(program, args, { encoding: 'utf8', ...options })
const target =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.TARGET ||
  run('rustc', ['-vV']).match(/^host: (.+)$/m)?.[1]
const names = ['ffmpeg', 'ffprobe', 'pngquant', 'jpegoptim', 'gifski']
const isMac = target?.endsWith('apple-darwin')
const extension = target?.includes('windows') ? '.exe' : ''
const destination = path.join(root, 'src-tauri/tool-bundle')
const sha256 = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sources = names.map((name) => ({
  name: `compresso_${name}${extension}`,
  source: path.join(
    root,
    `src-tauri/bin/compresso_${name}-${target}${extension}`,
  ),
}))
for (const { source } of sources) {
  if (!fs.existsSync(source))
    throw new Error(`Missing tool for ${target}: ${source}`)
}

// A cross-build must use a matching decompressor, never the build host's executable.
const toolchain = isMac ? buildLrzip(target) : null
const lrzip = toolchain?.binary
if (lrzip) {
  const arch = target.startsWith('aarch64') ? 'arm64' : 'x86_64'
  if (!run('lipo', ['-archs', lrzip]).split(/\s+/).includes(arch)) {
    throw new Error(
      `lrzip must contain ${arch}. Build on that architecture or set COMPRESSO_LRZIP.`,
    )
  }
}
const identity = process.env.APPLE_SIGNING_IDENTITY || '-'
const inputHash = createHash('sha256')
  .update(
    JSON.stringify({
      script: sha256(fileURLToPath(import.meta.url)),
      target,
      tools: sources.map(({ source }) => sha256(source)),
      helper: lrzip ? sha256(lrzip) : null,
      identity,
    }),
  )
  .digest('hex')
const manifestPath = path.join(destination, 'manifest.json')
if (fs.existsSync(manifestPath)) {
  const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (
    previous.inputHash === inputHash &&
    fs.existsSync(path.join(destination, previous.archive)) &&
    sha256(path.join(destination, previous.archive)) === previous.sha256 &&
    previous.bootstrap.every(
      (entry) =>
        fs.existsSync(path.join(destination, entry.name)) &&
        sha256(path.join(destination, entry.name)) === entry.sha256,
    )
  ) {
    process.stdout.write(`Tool archive already prepared for ${target}\n`)
    process.exit(0)
  }
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'compresso-tools-'))
const output = path.join(temporary, 'bundle')
const tools = path.join(temporary, 'tools')
fs.mkdirSync(output)
fs.writeFileSync(path.join(output, '.gitkeep'), '')
fs.mkdirSync(tools)
try {
  const sign = (file) =>
    run('codesign', [
      '--force',
      '--sign',
      identity,
      ...(identity === '-' ? [] : ['--timestamp', '--options', 'runtime']),
      file,
    ])
  const files = sources.map(({ name, source }) => {
    const file = path.join(tools, name)
    fs.copyFileSync(source, file)
    fs.chmodSync(file, 0o755)
    if (isMac) sign(file) // Sign before hashing and compressing; extracted bytes stay signed.
    return { name, size: fs.statSync(file).size, sha256: sha256(file) }
  })
  const bootstrap = []
  if (lrzip) {
    const helperDir = path.join(output, 'bootstrap')
    fs.mkdirSync(helperDir)
    const helper = path.join(helperDir, 'lrzip')
    fs.copyFileSync(lrzip, helper)
    fs.chmodSync(helper, 0o755)
    sign(helper)
    bootstrap.push({
      name: 'bootstrap/lrzip',
      size: fs.statSync(helper).size,
      sha256: sha256(helper),
    })
    // Check the relocated helper, rather than accidentally testing the Homebrew copy.
    run(helper, ['--version'])
    const licenseDir = path.join(output, 'licenses')
    fs.mkdirSync(licenseDir)
    for (const license of toolchain.licenses) {
      fs.copyFileSync(license.path, path.join(licenseDir, license.name))
    }
    fs.writeFileSync(
      path.join(licenseDir, 'SOURCES.json'),
      `${JSON.stringify(toolchain.sources, null, 2)}\n`,
    )
    // Publish matching sources with each release, separately from the application download.
    const sourceOffer = path.join(temporary, 'toolchain-sources')
    fs.mkdirSync(sourceOffer)
    for (const source of toolchain.sources) {
      fs.copyFileSync(
        path.join(toolchain.downloads, source.name),
        path.join(sourceOffer, source.name),
      )
    }
    fs.copyFileSync(
      path.join(root, 'scripts/build-lrzip.mjs'),
      path.join(sourceOffer, 'build-lrzip.mjs'),
    )
    fs.writeFileSync(
      path.join(sourceOffer, 'README.txt'),
      'Matching sources for the bundled lrzip, LZ4, and LZO.\n' +
        'Build instructions: docs/tool-bundles.md in the CompressO repository.\n' +
        'The build-lrzip.mjs script pins source versions, SHA-256 checksums, and build flags.\n',
    )
    run('tar', [
      '-czf',
      path.join(
        root,
        'src-tauri/.toolchain-cache',
        `toolchain-sources-${target}.tar.gz`,
      ),
      '-C',
      sourceOffer,
      '.',
    ])
  }

  // Python's standard library gives deterministic TAR headers and XZ on every build host.
  const tarFile = path.join(temporary, 'tools.tar')
  run(process.platform === 'win32' ? 'python' : 'python3', [
    '-c',
    `
import lzma, pathlib, shutil, sys, tarfile
source, output, fmt = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
with tarfile.open(output, 'w', format=tarfile.USTAR_FORMAT) as archive:
    for file in sorted(source.iterdir()):
        info = tarfile.TarInfo(file.name)
        info.size, info.mode, info.mtime = file.stat().st_size, 0o755, 0
        with file.open('rb') as data: archive.addfile(info, data)
if fmt == 'xz':
    with open(output, 'rb') as data, lzma.open(sys.argv[4], 'wb', preset=9) as compressed:
        shutil.copyfileobj(data, compressed)
`,
    tools,
    tarFile,
    isMac ? 'lrz' : 'xz',
    path.join(output, 'tools.tar.xz'),
  ])
  const archive = isMac ? 'tools.tar.lrz' : 'tools.tar.xz'
  if (isMac)
    run(
      lrzip,
      ['-q', '-L', '9', '-p', '1', '-o', path.join(output, archive), tarFile],
      {
        env: { ...process.env, LRZIP: 'NOCONFIG' },
        stdio: 'inherit',
      },
    )
  const checksum = sha256(path.join(output, archive))
  const manifest = {
    schema: 1,
    target,
    inputHash,
    archive,
    format: isMac ? 'lrz' : 'xz',
    sha256: checksum,
    tarSize: fs.statSync(tarFile).size,
    files,
    bootstrap,
  }
  fs.writeFileSync(
    path.join(output, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  fs.writeFileSync(path.join(output, `${archive}.sha256`), `${checksum}\n`)
  fs.rmSync(destination, { recursive: true, force: true })
  fs.cpSync(output, destination, { recursive: true })
  const raw = files.reduce((total, file) => total + file.size, 0)
  const packed = fs.statSync(path.join(output, archive)).size
  process.stdout.write(
    `${target}: ${(raw / 1048576).toFixed(1)} MiB tools → ${(packed / 1048576).toFixed(1)} MiB ${archive} (${(100 * (1 - packed / raw)).toFixed(1)}% smaller)\n`,
  )
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
