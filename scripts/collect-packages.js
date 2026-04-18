#!/usr/bin/env node
/**
 * collect-packages.js
 *
 * After electron-builder finishes, copy the final distributable files
 * (dmg/zip/exe/AppImage/deb/...) from dist/ into dist/ready-packages/.
 * Skips blockmap files, YAML metadata, builder-debug logs and the
 * *-unpacked / mac[-arch] staging directories.
 *
 * Usage:
 *   - Auto: wired as `afterAllArtifactBuild` hook in package.json build config
 *   - Manual: `npm run pack:collect`
 */
const fs = require('fs')
const path = require('path')

const DIST_DIR = path.resolve(__dirname, '..', 'dist')
const OUT_DIR = path.join(DIST_DIR, 'ready-packages')

const ALLOWED_EXTS = new Set([
  '.dmg', '.zip', '.exe', '.msi',
  '.appimage', '.deb', '.rpm', '.snap', '.pkg',
])

function shouldInclude(fileName) {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.blockmap')) return false
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return false
  const ext = path.extname(lower)
  return ALLOWED_EXTS.has(ext)
}

/**
 * Rename electron-builder's multi-arch nsis combined installer from the
 * double-dot form "Apinizer.1.0..exe" (blank ${arch}) to a clearer name.
 */
function normalizeName(name) {
  return name.replace(/^Apinizer\.1\.0\.\.exe$/, 'Apinizer.1.0.win.universal.exe')
}

function collect() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`[collect-packages] dist/ does not exist at ${DIST_DIR}`)
    return []
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const entries = fs.readdirSync(DIST_DIR, { withFileTypes: true })
  const copiedPaths = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!shouldInclude(entry.name)) continue
    const src = path.join(DIST_DIR, entry.name)
    const outName = normalizeName(entry.name)
    const dest = path.join(OUT_DIR, outName)
    fs.copyFileSync(src, dest)
    copiedPaths.push(dest)
    console.log(`[collect-packages] ${outName}`)
  }
  console.log(`[collect-packages] copied ${copiedPaths.length} file(s) -> ${OUT_DIR}`)
  return copiedPaths
}

/**
 * electron-builder afterAllArtifactBuild hook.
 * Returning [] keeps electron-builder from re-publishing these files.
 */
module.exports = async function afterAllArtifactBuild() {
  collect()
  return []
}

// Allow direct CLI execution: `node scripts/collect-packages.js`
if (require.main === module) {
  collect()
}
