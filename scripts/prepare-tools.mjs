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
const host = run('rustc', ['-vV']).match(/^host: (.+)$/m)?.[1]
const target = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.TARGET || host
const names = ['ffmpeg', 'ffprobe', 'pngquant', 'jpegoptim', 'gifski']
const isMac = target?.endsWith('apple-darwin')
const isWindows = target?.includes('windows')
const useLrzip = isMac || isWindows
const extension = isWindows ? '.exe' : ''
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
const windowsMetadata = isWindows
  ? JSON.parse(
      fs.readFileSync(
        path.join(root, 'LICENSES/lrzip-windows/SOURCE.json'),
        'utf8',
      ),
    )
  : null
const lrzip = isWindows
  ? path.join(root, `src-tauri/bin/compresso_lrzip-${target}.exe`)
  : toolchain?.binary
if (isWindows) {
  if (target !== windowsMetadata.target) {
    throw new Error(
      `The bundled Windows LRZIP supports only ${windowsMetadata.target}.`,
    )
  }
  if (sha256(lrzip) !== windowsMetadata.binarySha256) {
    throw new Error(
      'The Windows LRZIP executable does not match its pinned checksum.',
    )
  }
  if (
    sha256(path.join(root, windowsMetadata.sourceArchive)) !==
    windowsMetadata.sourceSha256
  ) {
    throw new Error(
      'The Windows LRZIP source archive does not match its pinned checksum.',
    )
  }
  if (process.platform !== 'win32') {
    throw new Error(
      'Build Windows tool bundles on Windows so the supplied lrzip.exe can create and verify its own archive.',
    )
  }
}
if (isMac) {
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
      packer: ['Cargo.toml', 'Cargo.lock', 'src/main.rs'].map((file) =>
        sha256(path.join(root, 'scripts/tool-archive', file)),
      ),
      target,
      tools: sources.map(({ source }) => sha256(source)),
      helper: lrzip ? sha256(lrzip) : null,
      windowsMetadata,
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
    const helperName = isWindows ? 'lrzip.exe' : 'lrzip'
    const helper = path.join(helperDir, helperName)
    fs.copyFileSync(lrzip, helper)
    fs.chmodSync(helper, 0o755)
    if (isMac) sign(helper)
    bootstrap.push({
      name: `bootstrap/${helperName}`,
      size: fs.statSync(helper).size,
      sha256: sha256(helper),
    })
    // Fail early on missing runtime DLLs or an executable that cannot start on this host.
    run(helper, ['--version'])
  }
  if (isMac) {
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

  // Run on the build host even when the application is cross-compiled. This isolated helper
  // uses the existing Rust toolchain, without Python or platform archive utilities.
  const tarFile = path.join(temporary, 'tools.tar')
  run(
    'cargo',
    [
      'run',
      '--quiet',
      '--locked',
      '--release',
      '--manifest-path',
      path.join(root, 'scripts/tool-archive/Cargo.toml'),
      '--target-dir',
      path.join(root, 'src-tauri/target/tool-archive'),
      '--target',
      host,
      '--',
      tools,
      tarFile,
      useLrzip ? 'tar' : 'xz',
      path.join(output, 'tools.tar.xz'),
    ],
    { stdio: 'inherit' },
  )
  const archive = useLrzip ? 'tools.tar.lrz' : 'tools.tar.xz'
  if (useLrzip) {
    run(
      lrzip,
      ['-q', '-L', '9', '-p', '1', '-o', path.join(output, archive), tarFile],
      {
        env: { ...process.env, LRZIP: 'NOCONFIG' },
        stdio: 'inherit',
      },
    )
    // Windows uses the exact supplied 0.651.1 executable for both operations. Never produce
    // its archive with the newer macOS helper, whose format/features may be incompatible.
    if (isWindows) {
      // Mirror installed-app extraction: no absolute resource/output paths are passed to the
      // older MinGW executable, which cannot handle Windows extended-length path prefixes.
      const checkDirectory = path.join(temporary, 'installed app path check')
      fs.mkdirSync(checkDirectory)
      fs.copyFileSync(
        path.join(output, archive),
        path.join(checkDirectory, archive),
      )
      run(lrzip, ['-d', '-q', '-p', '1', '-o', 'tools.tar', archive], {
        cwd: checkDirectory,
        env: {
          ...process.env,
          LRZIP: 'NOCONFIG',
          TMPDIR: '.',
          TMP: '.',
          TEMP: '.',
        },
        stdio: 'inherit',
      })
      if (sha256(path.join(checkDirectory, 'tools.tar')) !== sha256(tarFile)) {
        throw new Error(
          'The Windows LRZIP archive failed its extraction round-trip check.',
        )
      }
    }
  }
  const checksum = sha256(path.join(output, archive))
  const manifest = {
    schema: 1,
    target,
    inputHash,
    archive,
    format: useLrzip ? 'lrz' : 'xz',
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
