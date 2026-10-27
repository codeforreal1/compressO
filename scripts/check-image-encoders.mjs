// Run on the matching release runner: hashes alone cannot detect an omitted codec or DLL.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getImageTools } from './image-tools.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
if (!target) throw new Error('Pass the native release target triple.')
getImageTools(target)
if (target === 'x86_64-apple-darwin') {
  const metadata = JSON.parse(
    fs.readFileSync(
      path.join(root, 'LICENSES/jpegoptim/INTEL-MACOS-BUILD.json'),
      'utf8',
    ),
  )
  for (const [file, expected] of [
    [metadata.binary, metadata.binarySha256],
    [metadata.sourceArchive, metadata.sourceSha256],
  ]) {
    assert.equal(
      createHash('sha256')
        .update(fs.readFileSync(path.join(root, file)))
        .digest('hex'),
      expected,
    )
  }
}
const suffix = target.includes('windows') ? '.exe' : ''
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compresso-encoders-'))
const run = (name, args) =>
  execFileSync(
    path.join(root, 'src-tauri/bin', `compresso_${name}-${target}${suffix}`),
    args,
    {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
const exists = (name) => assert.ok(fs.statSync(path.join(directory, name)).size)
try {
  const encoders = new Set(
    run('ffmpeg', ['-hide_banner', '-encoders'])
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[1]),
  )
  for (const encoder of ['png', 'mjpeg', 'gif']) {
    assert.ok(
      encoders.has(encoder),
      `FFmpeg is missing ${encoder} on ${target}`,
    )
  }
  run('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=64x48:rate=1',
    '-frames:v',
    '1',
    '-c:v',
    'png',
    '-threads',
    '1',
    'source.png',
  ])
  run('ffmpeg', [
    '-v',
    'error',
    '-i',
    'source.png',
    '-frames:v',
    '1',
    '-c:v',
    'mjpeg',
    'source.jpg',
  ])
  run('ffmpeg', [
    '-v',
    'error',
    '-i',
    'source.png',
    '-frames:v',
    '1',
    '-c:v',
    'gif',
    'ffmpeg.gif',
  ])
  run('pngquant', [
    '--quality',
    '0-100',
    '--output',
    'quantized.png',
    'source.png',
  ])
  run('jpegoptim', ['--strip-all', '-m80', 'source.jpg'])
  run('gifski', ['-Q', '80', '-o', 'gifski.gif', 'source.png', 'source.png'])
  run('cjxl', ['source.png', 'encoded.jxl', '--distance=1'])
  run('djxl', ['encoded.jxl', 'jxl-decoded.png'])
  run('jxlinfo', ['encoded.jxl'])
  assert.match(run('heif-enc', ['--list-encoders']), /x265/)
  for (const extension of ['heic', 'heif']) {
    run('heif-enc', [
      '-e',
      'x265',
      '-q',
      '60',
      '-o',
      `encoded.${extension}`,
      'source.png',
    ])
    run('heif-dec', [
      '--quiet',
      `encoded.${extension}`,
      `${extension}-decoded.png`,
    ])
    exists(`encoded.${extension}`)
    exists(`${extension}-decoded.png`)
  }
  for (const name of [
    'source.png',
    'source.jpg',
    'ffmpeg.gif',
    'quantized.png',
    'gifski.gif',
    'encoded.jxl',
    'jxl-decoded.png',
  ]) {
    exists(name)
  }
  process.stdout.write(
    `${target}: JPEG, PNG, GIF, JPEG XL, HEIC and HEIF tool encoding checks passed.\n`,
  )
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}
