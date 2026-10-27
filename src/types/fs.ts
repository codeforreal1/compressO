export type FileMetadata = {
  path: string
  fileName: string
  mimeType: string
  extension: string
  size: number
}

/** A file from a dropped/pasted path, with its folder relative to that path */
export type CollectedFile = {
  path: string
  /** e.g. `Vacation/Day1` for a dropped `Vacation` folder; empty for files dropped directly */
  relativeDir: string
}
