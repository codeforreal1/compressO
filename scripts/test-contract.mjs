import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const moduleCache = new Map()

function loadTsModule(relativePath, stubs = {}) {
  const fullUrl = new URL(`../${relativePath}`, import.meta.url)
  const key = fullUrl.href
  if (moduleCache.has(key)) return moduleCache.get(key)

  const source = readFileSync(fullUrl, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  })

  const exports = {}
  moduleCache.set(key, exports)

  const resolveRelative = (fromRel, spec) => {
    const dir = fromRel.slice(0, fromRel.lastIndexOf('/') + 1)
    const parts = `${dir}${spec}`.split('/')
    const stack = []
    for (const part of parts) {
      if (!part || part === '.') continue
      if (part === '..') stack.pop()
      else stack.push(part)
    }
    const joined = stack.join('/')
    if (existsSync(`${joined}.ts`)) return `${joined}.ts`
    if (existsSync(`${joined}/index.ts`)) return `${joined}/index.ts`
    return joined.endsWith('.ts') ? joined : `${joined}.ts`
  }

  const req = (spec) => {
    if (spec in stubs) return stubs[spec]
    if (spec.startsWith('@/')) {
      const rel = `src/${spec.slice(2)}`
      const resolved = existsSync(new URL(`../${rel}.ts`, import.meta.url))
        ? `${rel}.ts`
        : existsSync(new URL(`../${rel}/index.ts`, import.meta.url))
          ? `${rel}/index.ts`
          : rel
      return loadTsModule(resolved, stubs)
    }
    if (spec.startsWith('.')) {
      return loadTsModule(resolveRelative(relativePath, spec), stubs)
    }
    throw new Error(`Unexpected import "${spec}" from ${relativePath}`)
  }

  new Function('require', 'exports', outputText)(req, exports)
  return exports
}

const stubs = {
  '@/i18n': {
    t: (key) => key,
  },
}

const contract = loadTsModule('src/contract/index.ts', stubs)
const {
  CONTRACT_VERSION,
  DEFAULT_AUDIO_CONTRACT,
  DEFAULT_IMAGE_CONTRACT,
  DEFAULT_VIDEO_CONTRACT,
  applyMergePatch,
  applyOneShotContractOverrides,
  contractToPreset,
  getContractCapabilities,
  getContractJsonSchema,
  presetToContract,
  validateAndNormalizeContract,
  videoConfigToContract,
} = contract

test('round-trips Standard defaults for video, image, and audio presets', () => {
  for (const [mediaType, def] of [
    ['video', DEFAULT_VIDEO_CONTRACT],
    ['image', DEFAULT_IMAGE_CONTRACT],
    ['audio', DEFAULT_AUDIO_CONTRACT],
  ]) {
    const validated = validateAndNormalizeContract(
      { ...def, name: 'My Preset' },
      { mode: 'preset', requireName: true },
    )
    assert.equal(validated.ok, true, `${mediaType} default should validate`)
    const preset = contractToPreset('id-1', validated.contract)
    const back = presetToContract(preset)
    assert.deepEqual(back, validated.contract)
  }
})

test('round-trips full custom video, image, and audio preset contracts', () => {
  const videoRes = validateAndNormalizeContract(
    {
      version: 1,
      mediaType: 'video',
      name: 'Web 720p',
      settings: {
        format: 'mp4',
        compression: { mode: 'targetSize', targetSizeMB: 25 },
        speed: 1.5,
        metadata: { mode: 'keep' },
        video: {
          codec: 'h264',
          resolution: '720p',
          fps: 30,
          transform: {
            rotate: 90,
            flipHorizontal: true,
            flipVertical: false,
            crop: '16:9',
          },
          hdr: { mode: 'remove' },
        },
        audio: {
          volumePercent: 120,
          codec: 'aac',
          channels: { layout: 'mono', source: 'left' },
          bitrateKbps: 128,
        },
        clips: { mode: 'duration', seconds: 45 },
      },
      output: {
        saveTo: 'folder',
        folder: '/Users/me/Videos/Out',
        fileNameTemplate: '{name}-{preset}',
      },
    },
    { mode: 'preset', requireName: true },
  )
  assert.equal(videoRes.ok, true)
  const videoPreset = contractToPreset('v1', videoRes.contract)
  assert.equal(videoPreset.settings.customVideoCodec, 'libx264')
  assert.equal(videoPreset.settings.resolution, 1280)
  assert.deepEqual(presetToContract(videoPreset), videoRes.contract)

  const imageRes = validateAndNormalizeContract(
    {
      version: 1,
      mediaType: 'image',
      name: 'SVG & WebP',
      settings: {
        format: 'webp',
        compression: { mode: 'targetSize', targetSizeMB: 0.5 },
        stripMetadata: false,
        image: {
          resolution: 1600,
          transform: {
            rotate: 180,
            flipHorizontal: false,
            flipVertical: true,
            crop: '1:1',
          },
          hdr: { mode: 'boost', intensity: 3.5 },
        },
        svg: {
          scale: 3,
          tracing: {
            filterSpeckle: 8,
            colorPrecision: 5,
            layerDifference: 12,
            cornerThreshold: 45,
            lengthThreshold: 3.5,
            spliceThreshold: 30,
            blackAndWhite: true,
          },
        },
      },
      output: {
        saveTo: 'sameFolder',
        folder: null,
        fileNameTemplate: '{name}_small',
      },
    },
    { mode: 'preset', requireName: true },
  )
  assert.equal(imageRes.ok, true)
  const imagePreset = contractToPreset('i1', imageRes.contract)
  assert.equal(imagePreset.settings.targetSizeInKB, 500)
  assert.deepEqual(presetToContract(imagePreset), imageRes.contract)

  const audioRes = validateAndNormalizeContract(
    {
      version: 1,
      mediaType: 'audio',
      name: 'Podcast MP3',
      settings: {
        format: 'mp3',
        compression: { mode: 'quality', quality: 75 },
        speed: 1.25,
        metadata: { mode: 'keep' },
        audio: {
          volumePercent: 90,
          codec: 'mp3',
          channels: { layout: 'stereo', swapChannels: true },
          bitrateKbps: 192,
        },
      },
    },
    { mode: 'preset', requireName: true },
  )
  assert.equal(audioRes.ok, true)
  const audioPreset = contractToPreset('a1', audioRes.contract)
  assert.equal(audioPreset.settings.audioConfig.audioCodec, 'libmp3lame')
  assert.deepEqual(presetToContract(audioPreset), audioRes.contract)
})

test('fills defaults from partial contract input', () => {
  const res = validateAndNormalizeContract(
    {
      version: CONTRACT_VERSION,
      mediaType: 'video',
      name: 'Quick 1080p',
      settings: {
        format: 'mp4',
        video: { resolution: '1080p' },
      },
    },
    { mode: 'preset', requireName: true },
  )
  assert.equal(res.ok, true)
  assert.equal(res.contract.settings.format, 'mp4')
  assert.equal(res.contract.settings.video.resolution, '1080p')
  assert.deepEqual(res.contract.settings.compression, {
    mode: 'quality',
    quality: 50,
  })
  assert.equal(res.contract.settings.audio.volumePercent, 100)
})

test('rejects unknown fields, out-of-range values, odd pixels, and bad tokens', () => {
  const unknown = validateAndNormalizeContract({
    version: 1,
    mediaType: 'video',
    extraField: 123,
    settings: { video: { bitrate: 500 } },
  })
  assert.equal(unknown.ok, false)
  assert.ok(
    unknown.errors.some(
      (e) => e.path === '/extraField' && e.code === 'unknownField',
    ),
  )
  assert.ok(unknown.errors.some((e) => e.path === '/settings/video/bitrate'))

  const badValues = validateAndNormalizeContract(
    {
      version: 1,
      mediaType: 'video',
      name: 'Standard',
      settings: {
        video: { resolution: 1081, fps: 120 },
        compression: { mode: 'quality', quality: 105 },
      },
      output: { saveTo: 'folder', fileNameTemplate: '{badToken}' },
    },
    { mode: 'preset', requireName: true },
  )
  assert.equal(badValues.ok, false)
  const codes = new Set(badValues.errors.map((e) => e.code))
  assert.ok(codes.has('reservedName'))
  assert.ok(codes.has('invalidResolution'))
  assert.ok(codes.has('outOfRange'))
  assert.ok(codes.has('required'))
  assert.ok(codes.has('invalidTemplateToken'))
})

test('enforces codec/container compatibility and GIF constraints', () => {
  const badCodec = validateAndNormalizeContract({
    version: 1,
    mediaType: 'video',
    settings: {
      format: 'webm',
      video: { codec: 'h264' },
      audio: { codec: 'aac' },
    },
  })
  assert.equal(badCodec.ok, false)
  assert.equal(
    badCodec.errors.filter((e) => e.code === 'incompatibleCodec').length,
    2,
  )

  const badGif = validateAndNormalizeContract({
    version: 1,
    mediaType: 'video',
    settings: {
      format: 'gif',
      compression: { mode: 'targetSize', targetSizeMB: 5 },
      clips: { mode: 'count', count: 2 },
      audio: { volumePercent: 50 },
    },
  })
  assert.equal(badGif.ok, false)
  assert.ok(
    badGif.errors.some((e) => e.code === 'targetSizeNotSupportedForGif'),
  )
  assert.ok(badGif.errors.some((e) => e.code === 'clipsNotSupportedForGif'))
  assert.ok(badGif.errors.some((e) => e.code === 'audioNotSupportedForGif'))
})

test('rejects one-shot-only fields in preset mode, allows them in oneShot mode', () => {
  const payload = {
    version: 1,
    mediaType: 'video',
    name: 'With One-Shot Fields',
    settings: {
      format: 'mp4',
      metadata: { mode: 'keep', set: { title: 'My Movie', artist: 'Me' } },
      video: { thumbnail: '/Users/me/cover.jpg' },
      subtitles: {
        preserveExisting: true,
        tracks: [{ path: '/Users/me/subs.srt', language: 'eng' }],
      },
    },
  }

  const presetAttempt = validateAndNormalizeContract(payload, {
    mode: 'preset',
    requireName: true,
  })
  assert.equal(presetAttempt.ok, false)
  assert.equal(
    presetAttempt.errors.filter((e) => e.code === 'presetDisallowedField')
      .length,
    3,
  )

  const oneShotAttempt = validateAndNormalizeContract(payload, {
    mode: 'oneShot',
  })
  assert.equal(oneShotAttempt.ok, true)
  assert.equal(oneShotAttempt.contract.settings.metadata.set.title, 'My Movie')
  assert.equal(
    oneShotAttempt.contract.settings.video.thumbnail,
    '/Users/me/cover.jpg',
  )
  assert.equal(oneShotAttempt.contract.settings.subtitles.tracks.length, 1)

  // Applies one-shot overrides cleanly to VideoConfig and converts back
  const applied = applyOneShotContractOverrides(
    {
      convertToExtension: 'mp4',
      shouldDisableCompression: false,
      audioConfig: { volume: 100 },
      shouldStripMetadata: true,
    },
    oneShotAttempt.contract,
  )
  assert.equal(applied.shouldStripMetadata, false)
  assert.equal(applied.metadataConfig.title, 'My Movie')
  assert.equal(applied.customThumbnailPath, '/Users/me/cover.jpg')
  assert.equal(applied.subtitlesConfig.preserveExistingSubtitles, true)
  assert.equal(
    applied.subtitlesConfig.subtitles[0].subtitlePath,
    '/Users/me/subs.srt',
  )

  const exported = videoConfigToContract(applied, {
    mediaType: 'video',
    resolution: null,
    includeOneShot: true,
  })
  assert.equal(exported.settings.metadata.set.title, 'My Movie')
  assert.equal(exported.settings.video.thumbnail, '/Users/me/cover.jpg')
  assert.equal(exported.settings.subtitles.tracks[0].path, '/Users/me/subs.srt')
})

test('emits non-fatal warnings for same-as-input codecs, audio extraction, SVG, and ask output', () => {
  const warnRes = validateAndNormalizeContract({
    version: 1,
    mediaType: 'video',
    settings: {
      format: 'mp3',
      video: { resolution: '720p' },
    },
    output: { saveTo: 'ask', fileNameTemplate: '{name}' },
  })
  assert.equal(warnRes.ok, true)
  const codes = new Set(warnRes.warnings.map((w) => w.code))
  assert.ok(codes.has('ignoredForAudioFormat'))
  assert.ok(codes.has('requiresOutputOption'))
})

test('merge-patches nested contract fields cleanly', () => {
  const base = DEFAULT_VIDEO_CONTRACT
  const patched = applyMergePatch(base, {
    name: 'Patched',
    settings: {
      format: 'mp4',
      video: { resolution: '1080p' },
    },
  })
  const res = validateAndNormalizeContract(patched, {
    mode: 'preset',
    requireName: true,
  })
  assert.equal(res.ok, true)
  assert.equal(res.contract.name, 'Patched')
  assert.equal(res.contract.settings.format, 'mp4')
  assert.equal(res.contract.settings.video.resolution, '1080p')
  assert.equal(res.contract.settings.audio.volumePercent, 100)
})

test('generates schemas with x-compresso-scope annotations and capabilities', () => {
  const videoOneShot = getContractJsonSchema('video', { mode: 'oneShot' })
  const videoPreset = getContractJsonSchema('video', { mode: 'preset' })
  assert.equal(
    videoOneShot.properties.settings.properties.subtitles['x-compresso-scope'],
    'oneShot',
  )
  assert.equal(videoPreset.properties.settings.properties.subtitles, undefined)
  assert.equal(
    videoPreset.properties.settings.properties.video.properties.thumbnail,
    undefined,
  )

  const caps = getContractCapabilities()
  assert.ok(caps.videoCodecs.h264.includes('mp4'))
  assert.ok(caps.audioCodecs.opus.includes('webm'))
  assert.deepEqual(caps.audioBitratesKbps, [64, 96, 128, 160, 192, 256, 320])
})

const presetStubs = {
  ...stubs,
  '@/types/preset': { STANDARD_PRESET_ID: 'standard' },
}
const { loadPresetsWithMigration, serializePresetContracts } = loadTsModule(
  'src/stores/presetMigration.ts',
  presetStubs,
)
const {
  createPresetInState,
  deletePresetInState,
  setDefaultPresetInState,
  updatePresetInState,
} = loadTsModule('src/stores/presetOperations.ts', presetStubs)

test('migrates v1 presets to v2 contracts preserving ids, defaults, and corrupt-entry safety', () => {
  const legacyJson = JSON.stringify({
    schemaVersion: 1,
    presets: [
      {
        id: 'p-vid',
        name: 'Web MP4',
        mediaType: 'video',
        settings: {
          convertToExtension: 'mp4',
          shouldDisableCompression: false,
          quality: 65,
          shouldUseTargetSize: false,
          targetSizeInMB: 10,
          shouldEnableCustomVideoCodec: true,
          customVideoCodec: 'libx264',
          shouldEnableCustomFPS: true,
          customFPS: 30,
          shouldEnableCustomSpeed: false,
          shouldStripMetadata: true,
          shouldEnableCustomAudioCodec: true,
          shouldEnableCustomChannel: false,
          shouldEnableCustomBitrate: true,
          audioConfig: {
            volume: 100,
            audioCodec: 'aac',
            audioChannelConfig: null,
            bitrate: 128,
          },
          dynamicRange: { mode: 'original', intensity: 2 },
          shouldEnableClips: false,
          clipsMode: 'count',
          clipLengthInSeconds: 60,
          clipCount: 2,
          resolution: 1280,
          transform: null,
        },
        output: {
          saveLocation: 'sameFolder',
          saveFolder: null,
          filePrefix: 'web-',
        },
      },
      { id: 'bad', name: 123, mediaType: 'video' },
    ],
    defaultPresetIds: { video: 'p-vid', image: 'missing', audio: 'standard' },
  })

  const migrated = loadPresetsWithMigration(null, legacyJson)
  assert.equal(migrated.migratedFromLegacy, true)
  assert.equal(migrated.state.presets.length, 1)
  assert.equal(migrated.state.presets[0].id, 'p-vid')
  assert.equal(migrated.state.presets[0].output.fileNameTemplate, 'web-{name}')
  assert.equal(migrated.state.defaultPresetIds.video, 'p-vid')
  assert.equal(migrated.state.defaultPresetIds.image, 'standard')

  const serialized = JSON.stringify(serializePresetContracts(migrated.state))
  const reloaded = loadPresetsWithMigration(serialized, legacyJson)
  assert.equal(reloaded.migratedFromLegacy, false)
  assert.equal(reloaded.state.presets[0].name, 'Web MP4')
  assert.equal(reloaded.state.presets[0].settings.customVideoCodec, 'libx264')
})

test('performs preset CRUD, conflict policies, revisions, and Standard protection', () => {
  const state = {
    presets: [],
    defaultPresetIds: {
      video: 'standard',
      image: 'standard',
      audio: 'standard',
    },
  }

  const created = createPresetInState(state, {
    version: 1,
    mediaType: 'video',
    name: 'Web',
    settings: { format: 'mp4', video: { resolution: '720p' } },
  })
  assert.equal(created.ok, true)
  assert.equal(state.presets.length, 1)
  const id = created.preset.id

  const clash = createPresetInState(state, {
    version: 1,
    mediaType: 'video',
    name: 'web',
    settings: { format: 'mp4' },
  })
  assert.equal(clash.ok, false)
  assert.equal(clash.code, 'presetExists')

  const renamed = createPresetInState(
    state,
    {
      version: 1,
      mediaType: 'video',
      name: 'Web',
      settings: { format: 'mkv' },
    },
    { onConflict: 'rename' },
  )
  assert.equal(renamed.ok, true)
  assert.equal(renamed.preset.name, 'Web (2)')

  const updated = updatePresetInState(
    state,
    'Web',
    { settings: { video: { resolution: '1080p' } } },
    { mediaType: 'video', ifRevision: 1 },
  )
  assert.equal(updated.ok, true)
  assert.equal(updated.preset.id, id)
  assert.equal(updated.preset.revision, 2)
  assert.equal(updated.contract.settings.video.resolution, '1080p')

  const stale = updatePresetInState(
    state,
    id,
    { name: 'Stale' },
    { ifRevision: 1 },
  )
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'revisionConflict')

  const stdEdit = updatePresetInState(state, 'standard', { name: 'Hack' })
  assert.equal(stdEdit.ok, false)
  assert.equal(stdEdit.code, 'standardPresetReadOnly')

  const setDef = setDefaultPresetInState(state, 'Web', 'video')
  assert.equal(setDef.ok, true)
  assert.equal(state.defaultPresetIds.video, id)

  const del = deletePresetInState(state, id, {
    watchedFolders: [{ id: 'wf-1', path: '/tmp/wf', presetIds: { video: id } }],
  })
  assert.equal(del.ok, true)
  assert.equal(del.defaultResetToStandard, true)
  assert.equal(state.defaultPresetIds.video, 'standard')
  assert.deepEqual(del.affectedWatchedFolders, [
    { id: 'wf-1', path: '/tmp/wf' },
  ])
})
