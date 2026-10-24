// Build native image codecs from a pinned, checksum-verified vcpkg source tree.
// Build-time downloads only; the installed application is entirely offline.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const revision = '4f973280dd95e3902b3410933fb2ce108bb29d1d'
const checksum =
  'f9419d91262779bd66afbe87e54dab3ed0cdc68eb3bf1d8f6dd3b00e89841895'
export const imageTools = ['cjxl', 'djxl', 'jxlinfo', 'heif-dec', 'heif-enc']
const run = (program, args, options = {}) =>
  execFileSync(program, args, { stdio: 'inherit', ...options })
const hash = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex')

export function buildImageTools(target) {
  const triplets = {
    'aarch64-apple-darwin': 'arm64-osx',
    'x86_64-apple-darwin': 'x64-osx',
    'x86_64-pc-windows-msvc': 'x64-windows-static',
    'x86_64-unknown-linux-gnu': 'x64-linux',
  }
  const triplet = triplets[target]
  if (!triplet) throw new Error(`Unsupported image codec target: ${target}`)
  const cache = path.join(root, 'src-tauri/.toolchain-cache/image-codecs')
  const source = path.join(cache, `vcpkg-${revision}`)
  const archive = path.join(cache, 'vcpkg.tar.gz')
  fs.mkdirSync(cache, { recursive: true })
  if (!fs.existsSync(archive)) {
    run('curl', [
      '-L',
      '--fail',
      '--retry',
      '3',
      `https://codeload.github.com/microsoft/vcpkg/tar.gz/${revision}`,
      '-o',
      `${archive}.part`,
    ])
    fs.renameSync(`${archive}.part`, archive)
  }
  if (hash(archive) !== checksum)
    throw new Error('Image codec build source checksum mismatch')
  if (!fs.existsSync(source)) run('tar', ['-xzf', archive, '-C', cache])
  const windows = target.includes('windows')
  const vcpkg = path.join(source, windows ? 'vcpkg.exe' : 'vcpkg')
  if (!fs.existsSync(vcpkg)) {
    if (windows)
      run('cmd.exe', [
        '/c',
        path.join(source, 'bootstrap-vcpkg.bat'),
        '-disableMetrics',
      ])
    else run('sh', [path.join(source, 'bootstrap-vcpkg.sh'), '-disableMetrics'])
  }
  // The app needs the two HEIF tools, with PNG support and all codec libraries linked in.
  const overlay = path.join(cache, 'overlay/libheif')
  fs.mkdirSync(path.dirname(overlay), { recursive: true })
  fs.cpSync(path.join(source, 'ports/libheif'), overlay, { recursive: true })
  const portManifest = path.join(overlay, 'vcpkg.json')
  const manifest = JSON.parse(fs.readFileSync(portManifest, 'utf8'))
  manifest.dependencies.push('libpng', 'libjpeg-turbo')
  fs.writeFileSync(portManifest, JSON.stringify(manifest, null, 2))
  const port = path.join(overlay, 'portfile.cmake')
  let recipe = fs
    .readFileSync(port, 'utf8')
    .replace(
      '-DWITH_EXAMPLES=OFF',
      '-DWITH_EXAMPLES=ON\n        -DCMAKE_DISABLE_FIND_PACKAGE_TIFF=ON\n        -DCMAKE_DISABLE_FIND_PACKAGE_WebP=ON\n        -DCMAKE_DISABLE_FIND_PACKAGE_WEBP=ON\n        -DENABLE_PLUGIN_LOADING=OFF',
    )
  // Decode the primary still image only, including correct container rotation. Never silently
  // flatten an image sequence or choose a thumbnail/auxiliary image as the main photo.
  recipe = recipe.replace(
    'vcpkg_check_features(',
    `vcpkg_replace_string("\${SOURCE_PATH}/examples/heif_dec.cc"
    [=[num_images = heif_context_get_list_of_top_level_image_IDs(ctx, image_IDs.data(), num_images);]=]
    [=[if (heif_context_has_sequence(ctx)) { std::cerr << "Animated HEIF is not supported" << std::endl; return 1; } num_images = 1; if (heif_context_get_primary_image_ID(ctx, image_IDs.data()).code != heif_error_Ok) { return 1; }]=])
vcpkg_check_features(`,
  )
  recipe = recipe.replace(
    'vcpkg_copy_pdbs()',
    'vcpkg_copy_pdbs()\nvcpkg_copy_tools(TOOL_NAMES heif-dec heif-enc AUTO_CLEAN)',
  )
  fs.writeFileSync(port, recipe)
  // The pinned Little CMS source has an upstream CMake build. Use it instead
  // of vcpkg's Meson port, which would make Python a build prerequisite.
  const lcmsOverlay = path.join(path.dirname(overlay), 'lcms')
  fs.cpSync(path.join(source, 'ports/lcms'), lcmsOverlay, { recursive: true })
  const lcmsManifestPath = path.join(lcmsOverlay, 'vcpkg.json')
  const lcmsManifest = JSON.parse(fs.readFileSync(lcmsManifestPath, 'utf8'))
  lcmsManifest.dependencies = [{ name: 'vcpkg-cmake', host: true }]
  fs.writeFileSync(lcmsManifestPath, JSON.stringify(lcmsManifest, null, 2))
  const lcmsPortPath = path.join(lcmsOverlay, 'portfile.cmake')
  let lcmsPort = fs.readFileSync(lcmsPortPath, 'utf8')
  lcmsPort = lcmsPort.replace(
    /vcpkg_configure_meson\([\s\S]*?vcpkg_fixup_pkgconfig\(\)/,
    `vcpkg_cmake_configure(
    SOURCE_PATH "\${SOURCE_PATH}"
    OPTIONS
      -DLCMS2_BUILD_SHARED=OFF
      -DLCMS2_BUILD_STATIC=ON
      -DLCMS2_BUILD_TOOLS=OFF
      -DLCMS2_BUILD_TESTS=OFF
      -DLCMS2_WITH_FASTFLOAT=OFF
      -DLCMS2_WITH_THREADED_PLUGIN=OFF
)
vcpkg_cmake_install()
vcpkg_fixup_pkgconfig()`,
  )
  fs.writeFileSync(lcmsPortPath, lcmsPort)
  fs.rmSync(path.join(path.dirname(overlay), 'vcpkg-tool-meson'), {
    recursive: true,
    force: true,
  })
  const buildRoot = path.join(cache, target)
  const project = path.join(buildRoot, 'manifest')
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(
    path.join(project, 'vcpkg.json'),
    JSON.stringify(
      {
        name: 'compresso-image-codecs',
        'version-string': '1',
        dependencies: [{ name: 'libjxl', features: ['tools'] }, 'libheif'],
      },
      null,
      2,
    ),
  )
  const installed = path.join(buildRoot, 'installed')
  const tripletDirectory = path.join(cache, 'triplets')
  fs.mkdirSync(tripletDirectory, { recursive: true })
  const tripletSource = fs.existsSync(
    path.join(source, 'triplets', `${triplet}.cmake`),
  )
    ? path.join(source, 'triplets', `${triplet}.cmake`)
    : path.join(source, 'triplets/community', `${triplet}.cmake`)
  fs.writeFileSync(
    path.join(tripletDirectory, `${triplet}.cmake`),
    `include("${tripletSource.replaceAll('\\', '/')}\")\nset(VCPKG_BUILD_TYPE release)\n` +
      (target.endsWith('apple-darwin')
        ? 'set(VCPKG_OSX_DEPLOYMENT_TARGET 11.0)\n'
        : ''),
  )
  run(
    vcpkg,
    [
      'install',
      `--triplet=${triplet}`,
      `--x-manifest-root=${project}`,
      `--x-install-root=${installed}`,
      `--overlay-ports=${path.dirname(overlay)}`,
      `--overlay-triplets=${tripletDirectory}`,
    ],
    {
      env: {
        ...process.env,
        VCPKG_DISABLE_METRICS: '1',
        VCPKG_MAX_CONCURRENCY: '4',
      },
    },
  )
  const prefix = path.join(installed, triplet)
  const directory = path.join(buildRoot, 'bin')
  fs.mkdirSync(directory, { recursive: true })
  for (const name of imageTools) {
    const suffix = windows ? '.exe' : ''
    fs.copyFileSync(
      path.join(
        prefix,
        'tools',
        name.startsWith('heif-') ? 'libheif' : 'libjxl',
        `${name}${suffix}`,
      ),
      path.join(directory, `compresso_${name}-${target}${suffix}`),
    )
    const binary = path.join(directory, `compresso_${name}-${target}${suffix}`)
    if (target.endsWith('apple-darwin')) {
      const dependencies = execFileSync('otool', ['-L', binary], {
        encoding: 'utf8',
      })
        .split('\n')
        .slice(1)
        .map((line) => line.trim().split(' ')[0])
        .filter(Boolean)
      if (
        dependencies.some(
          (dependency) =>
            !dependency.startsWith('/usr/lib/') &&
            !dependency.startsWith('/System/Library/'),
        )
      ) {
        throw new Error(
          `${name} depends on a non-system dylib: ${dependencies.join(', ')}`,
        )
      }
      const loadCommands = execFileSync('otool', ['-l', binary], {
        encoding: 'utf8',
      })
      const minimum = loadCommands.match(/\bminos\s+(\d+)\./)?.[1]
      if (!minimum || Number(minimum) > 11)
        throw new Error(`${name} must support macOS 11`)
      const arch = target.startsWith('aarch64') ? 'arm64' : 'x86_64'
      const architectures = execFileSync('lipo', ['-archs', binary], {
        encoding: 'utf8',
      })
        .trim()
        .split(/\s+/)
      if (!architectures.includes(arch))
        throw new Error(`${name} must contain ${arch}`)
    }
  }
  // Matching codec sources, the pinned package recipes and our primary-image patch travel
  // with the release as a separate download, outside the application installer.
  const offer = path.join(buildRoot, 'source-offer')
  fs.rmSync(offer, { recursive: true, force: true })
  fs.mkdirSync(offer, { recursive: true })
  fs.copyFileSync(archive, path.join(offer, 'vcpkg.tar.gz'))
  fs.copyFileSync(
    fileURLToPath(import.meta.url),
    path.join(offer, 'build-image-tools.mjs'),
  )
  fs.cpSync(path.dirname(overlay), path.join(offer, 'overlay'), {
    recursive: true,
  })
  fs.cpSync(tripletDirectory, path.join(offer, 'triplets'), { recursive: true })
  fs.mkdirSync(path.join(offer, 'downloads'), { recursive: true })
  for (const name of fs.readdirSync(path.join(source, 'downloads'))) {
    if (
      /\.(tar\.(gz|xz|bz2)|tgz|zip)$/.test(name) &&
      !/^(cmake|ninja|powershell)/i.test(name)
    ) {
      fs.copyFileSync(
        path.join(source, 'downloads', name),
        path.join(offer, 'downloads', name),
      )
    }
  }
  fs.writeFileSync(
    path.join(offer, 'README.txt'),
    `CompressO image codecs. vcpkg revision: ${revision}\nSee docs/image-codecs.md for build and relink instructions.\nThe overlay selects the primary HEIF image and rejects sequences.\n`,
  )
  run('tar', [
    '-czf',
    path.join(
      root,
      'src-tauri/.toolchain-cache',
      `image-codec-sources-${target}.tar.gz`,
    ),
    '-C',
    offer,
    '.',
  ])
  return { directory, licenses: path.join(prefix, 'share'), cache, revision }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target =
    process.argv[2] ||
    execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(
      /^host: (.+)$/m,
    )?.[1]
  buildImageTools(target)
}
