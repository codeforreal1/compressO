# Dependency source releases

Each release publishes `CompressO_<version>_dependency-sources.tar.gz`, linked as
**Dependency sources** in its description. It replaces the separate source-archive
release assets. Installers, macOS `.app.tar.gz` update packages, signatures, and
`latest.json` stay separate.

The combined download preserves the existing source archives byte-for-byte:

- `image-codecs/`: the source offers declared in each target's `SOURCES.json`.
- `toolchains/`: generated macOS/Linux LRZIP source offers and the pinned Windows offer.
- `jpegoptim/`: the pinned Intel macOS jpegoptim source offer.
- `LICENSES/`, `LICENSE`, `docs/`, and `scripts/`: notices, provenance, and build guidance.
- `README.md` and `manifest.json`: release revision, targets, sizes, and SHA-256 checksums.

After building, each matrix runner collects its required source offers with
`scripts/package-dependency-sources.mjs collect <target> <output>`. Missing source
archives or mismatched pinned checksums fail the job. Sources travel through
temporary Actions artifacts with one-day retention, rather than individual release
uploads.

After all four platform jobs succeed, the dependency-sources job downloads those
artifacts, checks that every expected platform/archive is present and unmodified,
then creates and extracts the combined archive to verify its contents. Unexpected
files, including accidentally collected updater packages, are rejected. Only the
combined source archive is uploaded. The `latest-json` job waits for this upload too.

The source download is a permanent release asset; artifact expiration removes only
the intermediate Actions copies. Existing published releases are unaffected.

Run packaging regression tests without dependencies or network access:

```sh
node --test scripts/test-dependency-sources.mjs
```
