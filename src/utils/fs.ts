import prettyBytes from "pretty-bytes";

/**
 * Formats bytes to appropriate human readable format like KB, MB, GB, etc
 * @param {number} bytes: Bytes to format
 */
export function formatBytes(bytes: number): string {
  if (!bytes) return "";
  return prettyBytes(bytes);
}
