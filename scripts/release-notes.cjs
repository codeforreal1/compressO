// Build download links from uploaded assets so filenames stay in sync with Tauri.
module.exports = function releaseNotes(assets) {
  const link = (pattern, label) => {
    const matches = assets.filter((asset) => pattern.test(asset.name));
    if (matches.length !== 1) {
      throw new Error(`Expected one ${label} asset, found ${matches.length}`);
    }
    return `[${label}](${matches[0].browser_download_url})`;
  };
  const windows = link(/_x64-setup\.exe$/, 'exe');
  const intelMac = link(/_x64\.dmg$/, 'dmg');
  const armMac = link(/_aarch64\.dmg$/, 'dmg');
  const deb = link(/_amd64\.deb$/, 'deb');
  const appImage = link(/_amd64\.AppImage$/, 'AppImage');
  const checksums = link(/^SHA256SUMS$/, 'SHA256SUMS');
  return [
    'CompressO desktop installers for Linux, macOS, and Windows.',
    '',
    `Download the matching installer and verify its hash against ${checksums}.`,
    '',
    '| Architecture | Windows | macOS | Linux |',
    '| --- | --- | --- | --- |',
    `| x64 (AMD64) | ${windows} | ${intelMac} | ${deb} · ${appImage} |`,
    `| ARM64 (Apple Silicon) | Not available | ${armMac} | Not available |`,
    '',
    'Windows uses an NSIS installer. On Linux, use the Debian package or the AppImage.',
    'macOS installers are not notarized by Apple.',
    '',
    'Verify a downloaded file with `sha256sum <filename>` on Linux,',
    '`shasum -a 256 <filename>` on macOS, or',
    '`Get-FileHash <filename> -Algorithm SHA256` in Windows PowerShell.',
    'Compare the result with the corresponding entry in `SHA256SUMS`.',
    '',
  ].join('\n');
};
