module.exports = function nextPatch(version, tags) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error('Automatic releases require a stable X.Y.Z version');
  const [, major, minor, currentPatch] = match;
  let patch = Number(currentPatch);
  for (const tag of tags) {
    const existing = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
    if (existing && existing[1] === major && existing[2] === minor) {
      patch = Math.max(patch, Number(existing[3]));
    }
  }
  return `${major}.${minor}.${patch + 1}`;
};
