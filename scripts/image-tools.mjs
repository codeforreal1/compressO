// Validate prebuilt image codecs. Normal dev/release builds never compile codec dependencies.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex')

export function getImageTools(target) {
  const metadata = JSON.parse(
    fs.readFileSync(
      path.join(root, 'LICENSES/image-codecs/SOURCES.json'),
      'utf8',
    ),
  ).targets[target]
  if (!metadata)
    throw new Error(
      `Prebuilt image codec binaries have not been provided for ${target}`,
    )
  const directory = path.join(root, 'src-tauri/bin')
  for (const tool of [...metadata.tools, ...(metadata.extraFiles ?? [])]) {
    const file = path.join(directory, tool.file)
    if (!fs.existsSync(file) || sha256(file) !== tool.sha256) {
      throw new Error(`Missing or changed prebuilt image codec: ${file}`)
    }
  }
  for (const source of metadata.sources ?? []) {
    const file = path.join(root, source.file)
    if (!fs.existsSync(file) || sha256(file) !== source.sha256)
      throw new Error(`Missing or changed codec sources: ${file}`)
  }
  return {
    directory,
    names: metadata.tools.map((tool) => tool.name),
    extraFiles: metadata.extraFiles ?? [],
    licenses: path.join(root, metadata.licenses),
    sources: metadata.sources ?? [],
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target =
    process.argv[2] ||
    process.env.TAURI_ENV_TARGET_TRIPLE ||
    process.env.TARGET ||
    execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(
      /^host: (.+)$/m,
    )?.[1]
  const tools = getImageTools(target)
  process.stdout.write(
    `Verified ${tools.names.length} prebuilt image codecs for ${target}\n`,
  )
}
