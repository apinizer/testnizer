// Stamp the macOS floor into latest-mac.yml so installed builds on an older
// macOS never auto-update into an app they cannot launch (issue #291).
//
// Electron 44 dropped macOS 11 and 12: the 1.6.0 bundle declares
// LSMinimumSystemVersion 13.0 and will not start on Monterey or Big Sur. Every
// Testnizer release since v1.4.10 ships electron-updater 6.8.3+, whose
// `isUpdateAvailable()` skips an update when the manifest's
// `minimumSystemVersion` is above `os.release()`. On macOS `os.release()` is
// the DARWIN kernel version (macOS 13 Ventura = Darwin 22), so the manifest
// must carry the Darwin number, not the marketing one. Without this field a
// Monterey user's app downloads 1.6.0, installs it on quit and is left with an
// app that refuses to open. Their data stays where it is, but they are stuck
// until they reinstall the old build by hand.
//
// electron-builder has no option that writes this field: `releaseInfo` is
// schema-locked, and `mac.minimumSystemVersion` only reaches Info.plist. So CI
// patches the generated manifest after packaging and re-uploads it.
//
// Usage: node scripts/patch-latest-mac-yml.mjs <path-to-latest-mac.yml>
// The macOS floor is read from package.json build.mac.minimumSystemVersion.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import yaml from 'js-yaml'

/** macOS 11 Big Sur is Darwin 20; every major since adds one to both. */
export function darwinVersionForMacOS(macOSVersion) {
  const major = Number.parseInt(String(macOSVersion).split('.')[0], 10)
  if (!Number.isInteger(major) || major < 11) {
    throw new Error(`Unsupported macOS minimum "${macOSVersion}" — expected 11 or later`)
  }
  return `${major + 9}.0.0`
}

/**
 * Returns the manifest text with `minimumSystemVersion` set to the Darwin
 * version for `macOSMinimum`. Everything else (files, sha512, size, path,
 * releaseDate) is kept as parsed.
 */
export function withMinimumSystemVersion(ymlText, macOSMinimum) {
  const doc = yaml.load(ymlText)
  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('latest-mac.yml is not a YAML mapping')
  }
  if (!Array.isArray(doc.files) || doc.files.length === 0) {
    throw new Error('latest-mac.yml lists no files — refusing to patch a broken manifest')
  }
  doc.minimumSystemVersion = darwinVersionForMacOS(macOSMinimum)
  return yaml.dump(doc, { lineWidth: -1 })
}

function main() {
  const [, , ymlPath] = process.argv
  if (!ymlPath) {
    console.error('Usage: node scripts/patch-latest-mac-yml.mjs <latest-mac.yml>')
    process.exit(1)
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const macOSMinimum = pkg.build?.mac?.minimumSystemVersion
  if (!macOSMinimum) {
    console.error('package.json build.mac.minimumSystemVersion is not set')
    process.exit(1)
  }
  const out = withMinimumSystemVersion(fs.readFileSync(ymlPath, 'utf8'), macOSMinimum)
  fs.writeFileSync(ymlPath, out)
  console.log(
    `[patch-latest-mac-yml] ${ymlPath}: minimumSystemVersion ${darwinVersionForMacOS(macOSMinimum)} (macOS ${macOSMinimum})`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
}
