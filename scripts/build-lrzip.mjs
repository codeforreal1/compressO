// Pinned sources, private build prefix, static third-party libraries, macOS 11 minimum.
// The original media binaries in src-tauri/bin are never modified.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sources = [
  {
    name: 'lrzip-0.7.3.tar.xz',
    directory: 'lrzip-0.7.3',
    url: 'https://github.com/ckolivas/lrzip/releases/download/v0.7.3/lrzip-0.7.3.tar.xz',
    sha256: '6928862de7c4bbb3cfbcd12fae9fd0a7d230d5bbf27486e52c4de60717ebfdbb',
    license: 'COPYING',
  },
  {
    name: 'lz4-1.10.0.tar.gz',
    directory: 'lz4-1.10.0',
    url: 'https://github.com/lz4/lz4/archive/refs/tags/v1.10.0.tar.gz',
    sha256: '537512904744b35e232912055ccf8ec66d768639ff3abe5788d90d792ec5f48b',
    license: 'lib/LICENSE',
  },
  {
    name: 'lzo-2.10.tar.gz',
    directory: 'lzo-2.10',
    url: 'https://www.oberhumer.com/opensource/lzo/download/lzo-2.10.tar.gz',
    sha256: 'c0f892943208266f9b6543b3ae308fab6284c5c90e627931446fb49b4221a072',
    license: 'COPYING',
  },
]

export function buildLrzip(target) {
  const cache = path.join(root, 'src-tauri/.toolchain-cache')
  const downloads = path.join(cache, 'downloads')
  const build = path.join(cache, target)
  const prefix = path.join(build, 'installed')
  const binary = path.join(prefix, 'bin/lrzip')
  const fingerprint = createHash('sha256')
    .update(fs.readFileSync(fileURLToPath(import.meta.url)))
    .digest('hex')
  const marker = path.join(build, 'build-hash')
  const run = (program, args, options = {}) =>
    execFileSync(program, args, { stdio: 'inherit', ...options })
  fs.mkdirSync(downloads, { recursive: true })
  if (
    !fs.existsSync(binary) ||
    !fs.existsSync(marker) ||
    fs.readFileSync(marker, 'utf8') !== fingerprint
  ) {
    for (const source of sources) {
      const file = path.join(downloads, source.name)
      if (!fs.existsSync(file)) {
        const partial = `${file}.partial`
        run('curl', [
          '--fail',
          '--location',
          '--silent',
          '--show-error',
          '--retry',
          '3',
          '--output',
          partial,
          source.url,
        ])
        fs.renameSync(partial, file)
      }
      const hash = createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex')
      if (hash !== source.sha256)
        throw new Error(`Source checksum mismatch: ${source.name}`)
    }
    fs.rmSync(build, { recursive: true, force: true })
    fs.mkdirSync(path.join(prefix, 'lib'), { recursive: true })
    fs.mkdirSync(path.join(prefix, 'include'), { recursive: true })
    for (const source of sources)
      run('tar', ['-xf', path.join(downloads, source.name), '-C', build])
    const arch = target.startsWith('aarch64') ? 'arm64' : 'x86_64'
    const flags = `-O2 -arch ${arch} -mmacosx-version-min=11.0`
    const env = {
      ...process.env,
      MACOSX_DEPLOYMENT_TARGET: '11.0',
      CC: `clang -arch ${arch}`,
      CXX: `clang++ -arch ${arch}`,
      CFLAGS: flags,
      CXXFLAGS: flags,
      CPPFLAGS: `-I${prefix}/include`,
      LDFLAGS: `-L${prefix}/lib -arch ${arch} -mmacosx-version-min=11.0`,
    }
    const jobs = String(Math.min(os.availableParallelism(), 8))
    const lz4 = path.join(build, 'lz4-1.10.0/lib')
    run('make', ['-C', lz4, '-j', jobs, 'liblz4.a', `CFLAGS=${flags}`], { env })
    fs.copyFileSync(
      path.join(lz4, 'liblz4.a'),
      path.join(prefix, 'lib/liblz4.a'),
    )
    for (const header of ['lz4.h', 'lz4hc.h', 'lz4frame.h']) {
      fs.copyFileSync(
        path.join(lz4, header),
        path.join(prefix, 'include', header),
      )
    }
    const lzo = path.join(build, 'lzo-2.10')
    run(
      './configure',
      [`--prefix=${prefix}`, '--disable-shared', '--enable-static'],
      { cwd: lzo, env },
    )
    run('make', ['-j', jobs], { cwd: lzo, env })
    run('make', ['install'], { cwd: lzo, env })
    const lrzip = path.join(build, 'lrzip-0.7.3')
    run('./configure', [`--prefix=${prefix}`], { cwd: lrzip, env })
    run('make', ['-j', jobs], { cwd: lrzip, env })
    fs.mkdirSync(path.dirname(binary), { recursive: true })
    fs.copyFileSync(path.join(lrzip, 'lrzip'), binary)
    fs.chmodSync(binary, 0o755)
    // Ensure third-party dependencies really were linked statically.
    const linked = execFileSync('otool', ['-L', binary], { encoding: 'utf8' })
    for (const line of linked
      .split('\n')
      .slice(1)
      .filter((line) => line.trim())) {
      const dependency = line.trim().split(' (')[0]
      if (
        !dependency.startsWith('/usr/lib/') &&
        !dependency.startsWith('/System/Library/')
      ) {
        throw new Error(`Nonportable lrzip dependency: ${dependency}`)
      }
    }
    fs.writeFileSync(marker, fingerprint)
  }
  return {
    binary,
    sources,
    licenses: sources.map((source) => ({
      name: `${source.directory}-LICENSE`,
      path: path.join(build, source.directory, source.license),
    })),
    downloads,
  }
}
