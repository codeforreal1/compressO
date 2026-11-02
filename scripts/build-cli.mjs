// Builds the command line tool (`compresso`, see `src-tauri/cli`) for the app's target, where Tauri
// bundles it from (`bundle.externalBin` in `tauri.conf.json`): `src-tauri/binaries/` with the
// target in its name. Run before the app is built (`beforeDevCommand` & `beforeBuildCommand`).

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const run = (program, args, options = {}) =>
  execFileSync(program, args, { encoding: 'utf8', ...options })
const host = run('rustc', ['-vV']).match(/^host: (.+)$/m)?.[1]
const target = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.TARGET || host
// `tauri dev` & `tauri build --debug` set it; release builds get an optimized command line
const isDebug = process.env.TAURI_ENV_DEBUG === 'true'
const extension = target.includes('windows') ? '.exe' : ''
const manifest = path.join(root, 'src-tauri/Cargo.toml')

run(
  'cargo',
  [
    'build',
    '--manifest-path',
    manifest,
    '--package',
    'compresso-cli',
    '--target',
    target,
    ...(isDebug ? [] : ['--release']),
  ],
  { stdio: 'inherit' },
)

const built = path.join(
  root,
  'src-tauri/target',
  target,
  isDebug ? 'debug' : 'release',
  `compresso-cli${extension}`,
)
const destination = path.join(root, 'src-tauri/binaries')
fs.mkdirSync(destination, { recursive: true })
fs.copyFileSync(
  built,
  path.join(destination, `compresso-cli-${target}${extension}`),
)
process.stdout.write(`Command line tool built for ${target}\n`)
